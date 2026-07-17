import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentDriver, StageResult } from './adapters/types.js';
import type {
  AgentId,
  Finding,
  Pipeline,
  StageAttempt,
  StageName,
  StageState,
  TemplateName,
} from './types.js';
import { buildBrief, type BriefContext } from './brief.js';
import { classifyTask, STAGE_MAX_TURNS, STAGE_TIMEOUT_MS, TEMPLATE_STAGES } from './templates.js';
import {
  completeRun,
  createRun,
  logRunEvent,
  updateRunValidationPlan,
  type RunHandle,
} from './records.js';
import { readJson, writeFileAtomic, writeJsonAtomic } from './fsx.js';
import { localIso } from './ids.js';
import { redactSecrets } from './secrets.js';
import { nativeVerify } from './verify.js';
import { capDiff, snapshotDiff } from './diff.js';

const sha1 = (text: string) => createHash('sha1').update(text, 'utf8').digest('hex');

/**
 * Stages that continue the builder's one session. Review and verify are
 * deliberately absent: a fresh reviewer context is the quality gate that
 * caught what the builder's own tests missed (run 1617) — never weaken it.
 */
const BUILDER_LINEAGE: ReadonlySet<StageName> = new Set(['grill', 'repro', 'plan', 'build']);

const CONVENTIONS_CAP = 8000;

/** Cross-platform since v2.2 — the Node case port replaced the PS-only hint. */
function captureFailureHint(runId: string): string {
  return `If a finding is a serious workflow miss, capture it: harness case new --summary "..." --class <class> --linked-run ${runId}`;
}

/**
 * Isolated workers don't auto-load repo docs — read AGENTS.md / CLAUDE.md
 * natively (zero agent tokens) so briefs carry the conventions instead.
 */
export function readRepoConventions(repo: string): string | undefined {
  const parts: string[] = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const p = join(repo, name);
    if (!existsSync(p)) continue;
    try {
      parts.push(`--- ${name} ---\n${readFileSync(p, 'utf8').trim()}`);
    } catch {
      /* unreadable file — workers just go without it */
    }
  }
  if (!parts.length) return undefined;
  const joined = parts.join('\n\n');
  return joined.length > CONVENTIONS_CAP
    ? `${joined.slice(0, CONVENTIONS_CAP)}\n[conventions truncated at ${CONVENTIONS_CAP} chars]`
    : joined;
}

export type OutcomeState = 'completed' | 'parked' | 'failed';

export interface EngineOutcome {
  state: OutcomeState;
  runId: string;
  message: string;
}

export interface StartOpts {
  task: string;
  repo: string;
  template?: TemplateName;
  builder?: AgentId;
  reviewer?: AgentId;
  model?: string | null;
  riskLevel?: 'low' | 'medium' | 'high';
  skipStages?: StageName[];
  /** false = keep the agent's permission prompts (--safe-perms). Default true. */
  skipPermissions?: boolean;
  /** false = workers load user-level config again (--no-isolation). Default true. */
  isolated?: boolean;
  /** true = verify runs as an agent for judgment-needed validation. Default: native. */
  agentVerify?: boolean;
  /** true = every re-review is a full review (--full-rereview). */
  fullRereview?: boolean;
  /** true = start even when an identical task is already active on this repo. */
  forceNew?: boolean;
  /** Hard per-stage spend cap in USD (--stage-budget-usd). */
  stageBudgetUsd?: number;
  promptSummary?: string;
}

export interface EngineOpts {
  root: string;
  drivers: Partial<Record<AgentId, AgentDriver>>;
  log?: (msg: string) => void;
}

// ---- stage output shapes -------------------------------------------------

interface GrillOut {
  ambiguous: boolean;
  questions: string[];
}
interface ReproOut {
  reproduced: boolean;
  repro_command: string;
  notes: string;
}
interface PlanOut {
  plan_markdown: string;
  validation_commands: string[];
  files: string[];
}
interface BuildOut {
  summary: string;
  files_changed: string[];
  commands_run: string[];
  tests_passed: boolean;
  test_output_tail: string;
}
interface ReviewOut {
  verdict: 'approve' | 'must_fix';
  must_fix: Finding[];
  should_fix: Finding[];
  notes: string;
}
interface VerifyOut {
  passed: boolean;
  results: { command: string; passed: boolean; output_tail: string }[];
  git_status_clean_of_surprises: boolean;
}

/**
 * Upgrade a v1 pipeline (no attempts arrays) in memory: each stage's mirror
 * fields become its single synthesized attempt. Idempotent; persisted on the
 * next savePipeline.
 */
export function migratePipeline(pipeline: Pipeline): Pipeline {
  if ((pipeline.schema_version ?? 1) >= 2) return pipeline;
  for (const s of pipeline.stages) {
    if (s.attempts?.length) continue;
    s.attempts = [];
    const ran = s.agent !== undefined || s.tokens !== undefined || s.cost_usd !== undefined;
    if (!ran) continue;
    const attempt: StageAttempt = {
      // v1 kept only the LAST run's numbers; earlier attempts are gone — this
      // is a floor, not the truth (the truth lives in commands.jsonl events).
      status: s.status === 'failed' ? 'failed' : s.status === 'parked' ? 'parked' : 'done',
      agent: s.agent ?? 'claude',
    };
    if (s.model !== undefined) attempt.model = s.model;
    if (s.tokens !== undefined) attempt.tokens = s.tokens;
    if (s.cost_usd !== undefined) attempt.cost_usd = s.cost_usd;
    if (s.duration_ms !== undefined) attempt.duration_ms = s.duration_ms;
    if (s.num_turns !== undefined) attempt.num_turns = s.num_turns;
    if (s.started_at !== undefined) attempt.started_at = s.started_at;
    if (s.ended_at !== undefined) attempt.ended_at = s.ended_at;
    if (s.error !== undefined) attempt.error = s.error;
    if (s.park_reason !== undefined) attempt.park_reason = s.park_reason;
    s.attempts.push(attempt);
  }
  pipeline.review_round =
    pipeline.review_round ??
    pipeline.stages.filter((s) => s.name === 'review' && s.attempts?.length).length;
  pipeline.schema_version = 2;
  return pipeline;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isFindings = (v: unknown): v is Finding[] =>
  Array.isArray(v) && v.every((x) => isObj(x) && typeof x['issue'] === 'string');

function parseStage(stage: StageName, parsed: unknown): unknown | undefined {
  if (!isObj(parsed)) return undefined;
  switch (stage) {
    case 'grill':
      return typeof parsed['ambiguous'] === 'boolean' && isStrArray(parsed['questions'])
        ? (parsed as unknown as GrillOut)
        : undefined;
    case 'repro':
      return typeof parsed['reproduced'] === 'boolean' ? (parsed as unknown as ReproOut) : undefined;
    case 'plan':
      return typeof parsed['plan_markdown'] === 'string' &&
        isStrArray(parsed['validation_commands'])
        ? (parsed as unknown as PlanOut)
        : undefined;
    case 'build':
      return typeof parsed['summary'] === 'string' && typeof parsed['tests_passed'] === 'boolean'
        ? (parsed as unknown as BuildOut)
        : undefined;
    case 'review':
      return (parsed['verdict'] === 'approve' || parsed['verdict'] === 'must_fix') &&
        isFindings(parsed['must_fix'] ?? []) &&
        isFindings(parsed['should_fix'] ?? [])
        ? (parsed as unknown as ReviewOut)
        : undefined;
    case 'verify':
      return typeof parsed['passed'] === 'boolean' && Array.isArray(parsed['results'])
        ? (parsed as unknown as VerifyOut)
        : undefined;
    case 'approval':
      return undefined;
  }
}

// ---- engine ---------------------------------------------------------------

export class Engine {
  private availability = new Map<AgentId, boolean>();

  constructor(private readonly opts: EngineOpts) {}

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  private driver(id: AgentId): AgentDriver {
    const d = this.opts.drivers[id];
    if (!d) throw new Error(`no driver registered for agent "${id}"`);
    return d;
  }

  private async isAvailable(id: AgentId): Promise<boolean> {
    const cached = this.availability.get(id);
    if (cached !== undefined) return cached;
    const d = this.opts.drivers[id];
    let ok = false;
    if (d) {
      try {
        ok = await d.available();
      } catch {
        // drivers must not throw, but a probe crash must never take down
        // `harness run` before a run record exists (review finding, 2026-07-11)
        ok = false;
      }
    }
    this.availability.set(id, ok);
    return ok;
  }

  /** Build the stage plan + briefs without creating a run or invoking agents. */
  dryRun(opts: StartOpts): string {
    const template = opts.template ?? classifyTask(opts.task);
    const stages = TEMPLATE_STAGES[template].filter(
      (s) => !(opts.skipStages ?? []).includes(s),
    );
    const ctx: BriefContext = {
      task: opts.task,
      answers: null,
      planMd: '(plan.md from the plan stage)',
      validationCommands: ['(from the plan stage)'],
      independentReviewer: (opts.reviewer ?? 'claude') !== (opts.builder ?? 'claude'),
    };
    const parts = [`template: ${template}`, `stages: ${stages.join(' -> ')}`, ''];
    for (const s of stages) {
      parts.push(`${'='.repeat(70)}`, `STAGE ${s}`, `${'='.repeat(70)}`);
      parts.push(
        s === 'approval'
          ? '(human gate: resume --approve)'
          : s === 'verify' && opts.agentVerify !== true
            ? '(native: the harness executes the plan validation commands directly — no agent, zero tokens)'
            : buildBrief(s, ctx),
        '',
      );
    }
    return parts.join('\n');
  }

  async start(opts: StartOpts): Promise<EngineOutcome> {
    // Field finding (desktop instance, 2026-07-11): `harness run "/plan"`
    // burned a grill stage on a non-task. Reject pre-spend, before any
    // record or agent exists.
    const task = opts.task.trim();
    if (task.startsWith('/') || task.length < 10 || !/\s/.test(task)) {
      throw new Error(
        `task ${JSON.stringify(task)} looks like a slash command or is too short — ` +
          `describe the outcome in a full sentence (goal + context + constraints). ` +
          `Skills like /plan run inside Claude Code, not as harness tasks.`,
      );
    }

    const template = opts.template ?? classifyTask(opts.task);
    const skip = opts.skipStages ?? [];
    if (skip.includes('approval')) {
      // The only human gate in the pipeline is not silently skippable.
      throw new Error('the approval gate cannot be skipped (--skip approval refused)');
    }

    // Field finding (same session): a parked run was duplicated a minute
    // later instead of resumed, leaving two parked twins. Same repo + same
    // task = point at resume; other active runs on the repo get a warning
    // (active runs share one working tree).
    const active = this.scanActiveRuns(opts.repo, task);
    if (active.duplicate !== undefined && opts.forceNew !== true) {
      throw new Error(
        `an active run with this exact task already exists for this repo: ${active.duplicate}. ` +
          `Resume it (harness resume ${active.duplicate} -i) instead of starting a twin, or pass --force-new.`,
      );
    }
    for (const other of active.othersOnRepo) {
      this.log(`note: run ${other} is also active on this repo — active runs share the working tree`);
    }
    const builder = opts.builder ?? 'claude';
    let reviewer = opts.reviewer;
    if (!reviewer) {
      const other: AgentId = builder === 'claude' ? 'codex' : 'claude';
      reviewer = (await this.isAvailable(other)) ? other : builder;
    }

    const handle = createRun({
      root: this.opts.root,
      repo: opts.repo,
      task: opts.task,
      template,
      builder,
      reviewer,
      model: opts.model ?? null,
      riskLevel: opts.riskLevel ?? 'medium',
      promptSummary: opts.promptSummary ?? '',
    });

    // Skipped stages stay in the record as 'skipped' — the run must show what
    // was deliberately not done, not pretend the template was shorter.
    const stages: StageState[] = TEMPLATE_STAGES[template].map((name) => ({
      name,
      status: skip.includes(name) ? 'skipped' : 'pending',
      attempts: [],
      artifacts: [],
    }));

    const pipeline: Pipeline = {
      schema_version: 2,
      review_round: 0,
      run_id: handle.runId,
      template,
      repo: opts.repo,
      task: opts.task,
      answers: null,
      builder,
      reviewer,
      model: opts.model ?? null,
      skip_permissions: opts.skipPermissions !== false,
      isolated: opts.isolated !== false,
      agent_verify: opts.agentVerify === true,
      risk_level: opts.riskLevel ?? 'medium',
      full_rereview: opts.fullRereview === true,
      stage_budget_usd: opts.stageBudgetUsd ?? null,
      current_stage: 0,
      validation_commands: [],
      files_changed: [],
      fix_cycles: 0,
      last_must_fix: null,
      stages,
    };
    this.savePipeline(handle, pipeline);
    this.log(`run ${handle.runId} started (template: ${template}, builder: ${builder}, reviewer: ${reviewer})`);
    return this.execute(handle, pipeline);
  }

  private scanActiveRuns(repo: string, task: string): { duplicate?: string; othersOnRepo: string[] } {
    const out: { duplicate?: string; othersOnRepo: string[] } = { othersOnRepo: [] };
    const runsDir = join(this.opts.root, 'runs');
    if (!existsSync(runsDir)) return out;
    // Windows paths are case-insensitive — a drive-letter case mismatch must
    // not hide an active run (review finding, 2026-07-12).
    const norm = (p: string) => {
      const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
      return process.platform === 'win32' ? n.toLowerCase() : n;
    };
    for (const id of readdirSync(runsDir)) {
      const pipelinePath = join(runsDir, id, 'pipeline.json');
      if (!existsSync(pipelinePath)) continue;
      let p: Pipeline;
      try {
        p = readJson<Pipeline>(pipelinePath);
      } catch {
        continue; // half-written or foreign file — not this guard's problem
      }
      if (p.current_stage >= p.stages.length) continue; // completed
      if (norm(p.repo) !== norm(repo)) continue;
      if (p.task.trim() === task) out.duplicate = p.run_id;
      else out.othersOnRepo.push(p.run_id);
    }
    return out;
  }

  loadRun(runId: string): { handle: RunHandle; pipeline: Pipeline } {
    const runDir = join(this.opts.root, 'runs', runId);
    const pipelinePath = join(runDir, 'pipeline.json');
    if (!existsSync(pipelinePath)) {
      throw new Error(`no pipeline.json under ${runDir} — not a harness run?`);
    }
    return {
      handle: { runId, runDir, root: this.opts.root },
      pipeline: migratePipeline(readJson<Pipeline>(pipelinePath)),
    };
  }

  async resume(runId: string, flags: { approve?: boolean } = {}): Promise<EngineOutcome> {
    const { handle, pipeline } = this.loadRun(runId);
    const stage = pipeline.stages[pipeline.current_stage];
    if (!stage) {
      return { state: 'completed', runId, message: 'run already completed' };
    }

    if (stage.status === 'parked' || stage.status === 'failed') {
      if (stage.name === 'approval') {
        if (!flags.approve) {
          return this.park(handle, pipeline, 'plan approval required: rerun with --approve');
        }
        stage.status = 'done';
        stage.ended_at = localIso();
        delete stage.park_reason;
        pipeline.current_stage++;
        logRunEvent(handle, { event: 'plan_approved', by: 'kerry' });
      } else if (stage.name === 'grill' && stage.status === 'parked') {
        const questionsPath = join(handle.runDir, 'questions.md');
        const content = existsSync(questionsPath) ? readFileSync(questionsPath, 'utf8') : '';
        const unchanged = stage.parked_file_hash
          ? sha1(content) === stage.parked_file_hash
          : content.length <= (stage.parked_file_bytes ?? 0);
        if (unchanged) {
          return this.park(
            handle,
            pipeline,
            'questions.md has no added answers yet — edit it inline, then resume',
          );
        }
        pipeline.answers = content;
        stage.status = 'done';
        stage.ended_at = localIso();
        delete stage.park_reason;
        delete stage.parked_file_bytes;
        delete stage.parked_file_hash;
        pipeline.current_stage++;
        logRunEvent(handle, { event: 'grill_answered' });
      } else {
        // Any other park/failure: Kerry has intervened (edited plan.md, fixed the
        // environment, adjusted the repo) — re-run the stage fresh.
        stage.status = 'pending';
        delete stage.error;
        delete stage.park_reason;
        logRunEvent(handle, { event: 'stage_reset_for_resume', stage: stage.name });
      }
    }

    const parked = join(handle.runDir, 'PARKED.md');
    if (existsSync(parked)) rmSync(parked);
    this.savePipeline(handle, pipeline);
    return this.execute(handle, pipeline);
  }

  private async execute(handle: RunHandle, pipeline: Pipeline): Promise<EngineOutcome> {
    while (pipeline.current_stage < pipeline.stages.length) {
      const stage = pipeline.stages[pipeline.current_stage]!;

      if (stage.status === 'running') {
        // Crash recovery: a stage marked running in a fresh process never finished.
        stage.status = 'pending';
        logRunEvent(handle, { event: 'stage_recovered_after_crash', stage: stage.name });
      }
      if (stage.status === 'done' || stage.status === 'skipped') {
        pipeline.current_stage++;
        continue;
      }

      if (stage.name === 'approval') {
        stage.status = 'parked';
        stage.park_reason = 'awaiting plan approval';
        return this.park(
          handle,
          pipeline,
          `plan ready — read plan.md, then: harness resume ${pipeline.run_id} --approve`,
        );
      }

      // The park contract is absolute: an unexpected exception must still end
      // in a parked run with PARKED.md, never a crash that strands the stage
      // as 'running' (CASE class: crash-not-park, review 2026-07-10).
      let outcome: EngineOutcome | undefined;
      try {
        outcome =
          stage.name === 'verify' && pipeline.agent_verify !== true
            ? await this.runNativeVerify(handle, pipeline, stage)
            : await this.runAgentStage(handle, pipeline, stage);
      } catch (err) {
        stage.status = 'failed';
        stage.error = `internal error: ${err instanceof Error ? err.message : String(err)}`;
        outcome = this.park(
          handle,
          pipeline,
          `stage ${stage.name} hit an internal harness error (${stage.error}) — parked, not crashed; resume re-runs the stage`,
        );
      }
      if (outcome) return outcome; // parked or failed
      pipeline.current_stage++;
      this.savePipeline(handle, pipeline);
    }

    const review = [...pipeline.stages].reverse().find((s) => s.name === 'review');
    const evidenceLinks = existsSync(join(handle.runDir, 'evidence.md')) ? ['evidence.md'] : [];
    await completeRun(handle, {
      status: 'complete',
      finalOutcome: `pipeline ${pipeline.template} completed (${pipeline.stages.length} stages)`,
      ...(review?.error === undefined && review
        ? { reviewerResult: `review stage: see review.md` }
        : {}),
      evidenceLinks,
      filesChanged: pipeline.files_changed,
    });
    this.log(`run ${pipeline.run_id} completed`);
    return { state: 'completed', runId: pipeline.run_id, message: 'pipeline completed' };
  }

  private async runAgentStage(
    handle: RunHandle,
    pipeline: Pipeline,
    stage: StageState,
  ): Promise<EngineOutcome | undefined> {
    const agentId = stage.name === 'review' ? pipeline.reviewer : pipeline.builder;
    const driver = this.driver(agentId);

    const planPath = join(handle.runDir, 'plan.md');
    const ctx: BriefContext = {
      task: pipeline.task,
      answers: pipeline.answers,
      independentReviewer: pipeline.reviewer !== pipeline.builder,
    };
    if (pipeline.isolated !== false) {
      const conventions = readRepoConventions(pipeline.repo);
      if (conventions !== undefined) ctx.repoConventions = conventions;
    }
    if (existsSync(planPath)) ctx.planMd = readFileSync(planPath, 'utf8');
    if (pipeline.validation_commands.length) ctx.validationCommands = pipeline.validation_commands;
    if (stage.variant === 'fix') {
      ctx.variant = 'fix';
      if (pipeline.last_must_fix) ctx.reviewFindings = pipeline.last_must_fix;
    }

    if (stage.name === 'review') {
      // Snapshot the tree the reviewer is judging (zero tokens, includes
      // untracked files) — both an honest record and the delta-review input.
      const round = (pipeline.review_round ?? 0) + 1;
      const diff = await snapshotDiff(pipeline.repo);
      if (diff !== undefined && diff.trim()) {
        writeFileAtomic(join(handle.runDir, `review-${round}.diff`), diff);
        if (!stage.artifacts.includes(`review-${round}.diff`)) {
          stage.artifacts.push(`review-${round}.diff`);
        }
        ctx.currentDiff = capDiff(diff, 40_000);
      }
      // Delta re-review: fresh context, but scoped to prior findings + what
      // changed since. risk=high and --full-rereview force full rounds.
      const prior = pipeline.stages
        .flatMap((s) => s.attempts ?? [])
        .filter((a) => a.review !== undefined)
        .at(-1);
      if (prior?.review && pipeline.risk_level !== 'high' && pipeline.full_rereview !== true) {
        const priorDiffPath = join(handle.runDir, `review-${prior.review.round ?? 0}.diff`);
        ctx.deltaReview = {
          priorMustFix: prior.review.must_fix.length
            ? prior.review.must_fix.map((f) => `- ${f.file ?? '?'}: ${f.issue}`).join('\n')
            : '- none recorded',
          ...(existsSync(priorDiffPath)
            ? { priorDiff: capDiff(readFileSync(priorDiffPath, 'utf8'), 25_000) }
            : {}),
        };
      }
    }

    // The run's --model names a model for the BUILDER's CLI; another agent's
    // CLI would reject it (`codex exec -m sonnet` exits 1), so cross-agent
    // stages run on that agent's own default model — announced, never silent.
    const stageModel = agentId === pipeline.builder ? pipeline.model : null;
    if (pipeline.model && stageModel === null) {
      this.log(
        `stage ${stage.name}: --model '${pipeline.model}' targets the builder (${pipeline.builder}); ${agentId} uses its own default model`,
      );
    }

    // Builder-lineage stages resume the one builder session; the reviewer
    // firewall is structural — review/verify are not in the lineage set, so
    // no code path can hand them a session.
    const resumable = BUILDER_LINEAGE.has(stage.name) && driver.supportsResume === true;
    let resumeId = resumable ? (pipeline.builder_session_id ?? undefined) : undefined;
    if ((stage.attempts?.length ?? 0) > 0) ctx.retry = true;
    if (resumeId !== undefined) ctx.resumedSession = true;

    stage.status = 'running';
    stage.agent = agentId;
    stage.model = stageModel;
    stage.started_at = localIso();
    this.savePipeline(handle, pipeline);
    logRunEvent(handle, { event: 'stage_started', stage: stage.name, agent: agentId });
    this.log(`stage ${stage.name} -> ${agentId}${resumeId !== undefined ? ' (resuming builder session)' : ''}...`);

    const drive = (resume: string | undefined) =>
      driver.run(
        { stage: stage.name, prompt: buildBrief(stage.name, ctx), cwd: pipeline.repo },
        {
          model: stageModel,
          maxTurns: STAGE_MAX_TURNS[stage.name],
          timeoutMs: STAGE_TIMEOUT_MS[stage.name],
          skipPermissions: pipeline.skip_permissions,
          isolated: pipeline.isolated !== false,
          ...(pipeline.stage_budget_usd ? { budgetUsd: pipeline.stage_budget_usd } : {}),
          ...(resume !== undefined ? { resumeSession: resume } : {}),
        },
      );

    let result = await drive(resumeId);
    if (
      !result.ok &&
      resumeId !== undefined &&
      /no conversation found/i.test(`${result.error ?? ''} ${result.raw ?? ''}`)
    ) {
      // The session was GC'd/aged out between park and resume — fall back to a
      // fresh context, recording the dead resume as its own honest attempt.
      this.log(`stage ${stage.name}: builder session not found — falling back to a fresh context`);
      logRunEvent(handle, { event: 'session_resume_failed', stage: stage.name, session_id: resumeId });
      (stage.attempts ??= []).push({
        status: 'failed',
        agent: agentId,
        model: stageModel,
        resumed: true,
        error: 'builder session not found on resume',
        started_at: stage.started_at,
        ended_at: localIso(),
      });
      pipeline.builder_session_id = null;
      resumeId = undefined;
      delete ctx.resumedSession;
      result = await drive(undefined);
    }

    if (result.resume_unsupported) {
      // We offered a session (supportsResume gate) but THIS installed CLI has no
      // resume subcommand; the driver ran a fresh context — record it, don't hide it.
      this.log(`stage ${stage.name}: installed ${agentId} CLI cannot resume — ran a fresh context`);
      logRunEvent(handle, {
        event: 'session_resume_unsupported',
        stage: stage.name,
        agent: agentId,
        session_id: resumeId,
      });
    }

    // Append-only: every execution becomes its own attempt; the stage's
    // top-level fields mirror the latest one for convenience.
    const attempt: StageAttempt = {
      status: 'done', // provisional — synced from the stage outcome below
      agent: agentId,
      model: stageModel,
      resumed: resumeId !== undefined,
      tokens: result.tokens,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
      num_turns: result.num_turns,
      started_at: stage.started_at!,
      ended_at: localIso(),
    };
    if (result.session_id !== undefined) attempt.session_id = result.session_id;
    (stage.attempts ??= []).push(attempt);
    // Chain the builder session forward (ids stayed stable in the probe, but
    // always trust the latest envelope).
    if (resumable && result.session_id) pipeline.builder_session_id = result.session_id;

    stage.tokens = result.tokens;
    stage.cost_usd = result.cost_usd;
    stage.duration_ms = result.duration_ms;
    stage.num_turns = result.num_turns;
    stage.ended_at = attempt.ended_at!;
    logRunEvent(handle, {
      event: 'stage_finished',
      stage: stage.name,
      agent: agentId,
      ok: result.ok,
      tokens: result.tokens,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
    });

    let outcome: EngineOutcome | undefined;
    if (!result.ok) {
      outcome = this.failStage(handle, pipeline, stage, result, result.error ?? 'agent failed');
    } else {
      const parsed = parseStage(stage.name, result.parsed);
      outcome =
        parsed === undefined
          ? this.failStage(handle, pipeline, stage, result, 'output contract violated')
          : await this.handleStageOutput(handle, pipeline, stage, parsed);
    }
    // read through a call boundary: TS otherwise keeps stage.status narrowed
    // to 'running' — the outcome handlers above mutate it out of band
    const statusNow = ((s: StageState) => s.status)(stage);
    attempt.status = statusNow === 'failed' ? 'failed' : statusNow === 'parked' ? 'parked' : 'done';
    if (stage.park_reason !== undefined) attempt.park_reason = stage.park_reason;
    if (stage.error !== undefined) attempt.error = stage.error;
    // park()/failStage saved before the attempt status was known — persist it.
    if (outcome) this.savePipeline(handle, pipeline);
    return outcome;
  }

  private async handleStageOutput(
    handle: RunHandle,
    pipeline: Pipeline,
    stage: StageState,
    parsed: unknown,
  ): Promise<EngineOutcome | undefined> {
    switch (stage.name) {
      case 'grill': {
        const out = parsed as GrillOut;
        if (out.ambiguous && out.questions.length) {
          const questionsPath = join(handle.runDir, 'questions.md');
          writeFileAtomic(
            questionsPath,
            [
              '# Grill questions',
              '',
              'Answer inline under each question, then resume the run.',
              '',
              ...out.questions.flatMap((q, i) => [`${i + 1}. ${q}`, '   A:', '']),
            ].join('\n'),
          );
          stage.status = 'parked';
          stage.park_reason = 'awaiting grill answers';
          stage.parked_file_bytes = statSync(questionsPath).size;
          stage.parked_file_hash = sha1(readFileSync(questionsPath, 'utf8'));
          stage.artifacts.push('questions.md');
          return this.park(
            handle,
            pipeline,
            `task is ambiguous — answer questions.md, then: harness resume ${pipeline.run_id}`,
          );
        }
        stage.status = 'done';
        return undefined;
      }

      case 'repro': {
        const out = parsed as ReproOut;
        writeFileAtomic(
          join(handle.runDir, 'repro.md'),
          `# Repro\n\nreproduced: ${out.reproduced}\ncommand: ${out.repro_command}\n\n${out.notes}\n`,
        );
        stage.artifacts.push('repro.md');
        if (!out.reproduced) {
          stage.status = 'parked';
          stage.park_reason = 'could not reproduce';
          return this.park(
            handle,
            pipeline,
            'bug did not reproduce — see repro.md; adjust the task or environment, then resume',
          );
        }
        stage.status = 'done';
        return undefined;
      }

      case 'plan': {
        const out = parsed as PlanOut;
        // Agents often already include a validation section in plan_markdown;
        // only append ours when they didn't (avoids the double heading).
        const hasValidationSection = /^#{2,}\s*validation commands/im.test(out.plan_markdown);
        const validationSection = hasValidationSection
          ? ''
          : `\n\n## Validation commands\n${out.validation_commands.map((c) => `- ${c}`).join('\n')}`;
        writeFileAtomic(
          join(handle.runDir, 'plan.md'),
          `${out.plan_markdown.trim()}${validationSection}\n`,
        );
        pipeline.validation_commands = out.validation_commands;
        await updateRunValidationPlan(handle, out.validation_commands);
        stage.artifacts.push('plan.md');
        stage.status = 'done';
        return undefined;
      }

      case 'build': {
        const out = parsed as BuildOut;
        const changed = Array.isArray(out.files_changed)
          ? out.files_changed.filter((f): f is string => typeof f === 'string')
          : [];
        pipeline.files_changed = [...new Set([...pipeline.files_changed, ...changed])];
        logRunEvent(handle, {
          event: 'build_summary',
          summary: out.summary,
          commands_run: out.commands_run ?? [],
          tests_passed: out.tests_passed,
        });
        if (!out.tests_passed) {
          stage.status = 'parked';
          stage.park_reason = 'build reports failing validation';
          writeFileAtomic(
            join(handle.runDir, 'build-failure.md'),
            `# Build reported failing validation\n\n${out.summary}\n\n\`\`\`\n${redactSecrets(out.test_output_tail ?? '')}\n\`\`\`\n`,
          );
          stage.artifacts.push('build-failure.md');
          return this.park(
            handle,
            pipeline,
            'build finished with failing validation (honest incomplete) — see build-failure.md, then resume to retry',
          );
        }
        stage.status = 'done';
        return undefined;
      }

      case 'review': {
        const out = parsed as ReviewOut;
        // Never dereference the arrays raw: a schema-tolerated `{"verdict":"must_fix"}`
        // with no arrays crashed the engine pre-fix (crash-not-park, review 2026-07-10).
        const mustFix = out.must_fix ?? [];
        const shouldFix = out.should_fix ?? [];
        const render = (f: Finding[]) =>
          f.length ? f.map((x) => `- ${x.file ?? '?'}: ${x.issue}`).join('\n') : '- none';
        const independence =
          pipeline.reviewer !== pipeline.builder
            ? `independent agent (${pipeline.reviewer}) — different from builder (${pipeline.builder})`
            : `fresh ${pipeline.builder} process — same agent as builder, no shared context (honest fallback)`;
        // Rounds are numbered across the whole run; review.md stays the
        // latest for humans, review-N.md preserves every round (a re-run
        // used to clobber the only copy).
        pipeline.review_round = (pipeline.review_round ?? 0) + 1;
        const round = pipeline.review_round;
        const reviewDoc = [
          `# Review — ${pipeline.run_id} (round ${round})`,
          '',
          `Reviewer: ${independence}`,
          `Verdict: ${out.verdict}`,
          '',
          `## Must fix`,
          render(mustFix),
          '',
          `## Should fix`,
          render(shouldFix),
          '',
          `## Notes`,
          out.notes ?? '',
          '',
        ].join('\n');
        writeFileAtomic(join(handle.runDir, 'review.md'), reviewDoc);
        writeFileAtomic(join(handle.runDir, `review-${round}.md`), reviewDoc);
        const attempt = stage.attempts?.at(-1);
        if (attempt) {
          attempt.review = { verdict: out.verdict, must_fix: mustFix, should_fix: shouldFix, round };
        }
        for (const a of ['review.md', `review-${round}.md`]) {
          if (!stage.artifacts.includes(a)) stage.artifacts.push(a);
        }

        if (out.verdict === 'must_fix') {
          // A fix build may only run against a Kerry-approved plan. Without one
          // (review-only template), auto-building on findings would be an
          // ungated repo-mutating run — park for Kerry instead.
          const hadApprovedPlan = pipeline.stages.some(
            (s) => s.name === 'approval' && s.status === 'done',
          );
          const captureHint = captureFailureHint(pipeline.run_id);
          if (!hadApprovedPlan) {
            stage.status = 'parked';
            stage.park_reason = 'must-fix findings; no approved plan to auto-fix against';
            return this.park(
              handle,
              pipeline,
              `review found must-fix issues and this pipeline has no approved plan — ` +
                `see review.md and decide the fix yourself. ${captureHint}`,
            );
          }
          if (mustFix.length === 0) {
            stage.status = 'parked';
            stage.park_reason = 'must_fix verdict without findings';
            return this.park(
              handle,
              pipeline,
              'review returned a must_fix verdict but listed no findings — inconsistent output; see review.md, then resume to re-review',
            );
          }
          if (pipeline.fix_cycles < 1) {
            pipeline.fix_cycles++;
            pipeline.last_must_fix = render(mustFix);
            const insertAt = pipeline.current_stage + 1;
            pipeline.stages.splice(
              insertAt,
              0,
              { name: 'build', variant: 'fix', status: 'pending', artifacts: [] },
              { name: 'review', status: 'pending', artifacts: [] },
            );
            // If verify already ran (refactor puts it before review), the fix
            // build invalidates its evidence — re-verify the final state.
            const verifyStillComing = pipeline.stages.some(
              (s, i) => i > insertAt + 1 && s.name === 'verify' && s.status === 'pending',
            );
            const verifyAlreadyRan = pipeline.stages.some(
              (s, i) => i < pipeline.current_stage && s.name === 'verify' && s.status === 'done',
            );
            if (verifyAlreadyRan && !verifyStillComing) {
              pipeline.stages.splice(insertAt + 2, 0, {
                name: 'verify',
                status: 'pending',
                artifacts: [],
              });
            }
            logRunEvent(handle, { event: 'fix_cycle_inserted', findings: mustFix.length });
            stage.status = 'done';
            return undefined;
          }
          stage.status = 'parked';
          stage.park_reason = 'must-fix findings remain after one fix cycle';
          return this.park(
            handle,
            pipeline,
            `review still has must-fix findings after one automated fix cycle — see review.md; intervene, then resume. ${captureHint}`,
          );
        }
        stage.status = 'done';
        return undefined;
      }

      case 'verify': {
        const out = parsed as VerifyOut;
        writeFileAtomic(
          join(handle.runDir, 'evidence.md'),
          [
            `# Evidence — ${pipeline.run_id}`,
            '',
            `Verify stage ran ${out.results.length} validation command(s) at ${localIso()}:`,
            '',
            ...out.results.flatMap((r) => [
              `## \`${r.command}\` — ${r.passed ? 'PASS' : 'FAIL'}`,
              '```',
              redactSecrets(r.output_tail ?? ''),
              '```',
              '',
            ]),
            `Overall: ${out.passed ? 'PASS' : 'FAIL'}; working tree surprises: ${
              out.git_status_clean_of_surprises ? 'none' : 'YES — check git status'
            }`,
            '',
          ].join('\n'),
        );
        stage.artifacts.push('evidence.md');
        if (!out.passed) {
          stage.status = 'parked';
          stage.park_reason = 'verification failed';
          return this.park(
            handle,
            pipeline,
            'verification failed — see evidence.md; intervene, then resume to re-verify',
          );
        }
        // "Tests pass" without output is not evidence (PRD 4.2.4): a pass
        // claim needs at least one command AND real output for every result.
        const vacuous =
          out.results.length === 0 ||
          out.results.some((r) => !(typeof r.output_tail === 'string' && r.output_tail.trim()));
        if (vacuous) {
          stage.status = 'parked';
          stage.park_reason = 'pass claimed without command output evidence';
          return this.park(
            handle,
            pipeline,
            'verify claimed PASS without command output evidence — rejected; see evidence.md, then resume to re-verify',
          );
        }
        stage.status = 'done';
        return undefined;
      }

      case 'approval':
        return undefined; // unreachable — approval never reaches runAgentStage
    }
  }

  /**
   * Verify without an agent: execute the plan's validation commands directly.
   * Exit codes are the evidence — a vacuous PASS is structurally impossible.
   */
  private async runNativeVerify(
    handle: RunHandle,
    pipeline: Pipeline,
    stage: StageState,
  ): Promise<EngineOutcome | undefined> {
    stage.status = 'running';
    stage.started_at = localIso();
    this.savePipeline(handle, pipeline);
    logRunEvent(handle, { event: 'stage_started', stage: 'verify', agent: 'harness' });
    this.log(`stage verify -> harness (native command execution)...`);

    const attempt: StageAttempt = {
      status: 'done', // provisional
      agent: 'harness',
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      num_turns: 0,
      started_at: stage.started_at,
    };
    (stage.attempts ??= []).push(attempt);

    if (!pipeline.validation_commands.length) {
      stage.status = 'parked';
      stage.park_reason = 'no validation commands recorded';
      attempt.status = 'parked';
      attempt.park_reason = stage.park_reason;
      attempt.ended_at = localIso();
      return this.park(
        handle,
        pipeline,
        'native verify has no validation commands to run (plan recorded none) — add commands to the plan and resume, or re-run with --agent-verify',
      );
    }

    const res = await nativeVerify(pipeline.repo, pipeline.validation_commands, pipeline.files_changed);
    attempt.duration_ms = res.duration_ms;
    attempt.ended_at = localIso();
    stage.tokens = { input: 0, output: 0 };
    stage.cost_usd = 0;
    stage.duration_ms = res.duration_ms;
    stage.num_turns = 0;
    stage.ended_at = attempt.ended_at;
    logRunEvent(handle, {
      event: 'stage_finished',
      stage: 'verify',
      agent: 'harness',
      ok: res.passed,
      cost_usd: 0,
      duration_ms: res.duration_ms,
    });

    writeFileAtomic(
      join(handle.runDir, 'evidence.md'),
      [
        `# Evidence — ${pipeline.run_id}`,
        '',
        `Native verify (harness-executed, no agent) ran ${res.results.length} validation command(s) at ${localIso()}:`,
        '',
        ...res.results.flatMap((r) => [
          `## \`${r.command}\` — ${r.passed ? 'PASS' : 'FAIL'} (exit ${r.timed_out ? 'TIMED OUT' : String(r.exit_code)})`,
          ...(r.normalized_command
            ? [`_ran as \`${r.normalized_command}\` (backslash paths normalized for bash — CASE-0022)_`]
            : []),
          '```',
          redactSecrets(r.output_tail),
          '```',
          '',
        ]),
        `Overall: ${res.passed ? 'PASS' : 'FAIL'}; working tree surprises: ${
          !res.git_status_available
            ? 'unknown (not a git repository)'
            : res.surprises.length
              ? `YES — paths changed but never reported by build: ${res.surprises.join(', ')}`
              : 'none'
        }`,
        '',
      ].join('\n'),
    );
    if (!stage.artifacts.includes('evidence.md')) stage.artifacts.push('evidence.md');

    if (!res.passed) {
      stage.status = 'parked';
      stage.park_reason = 'verification failed';
      attempt.status = 'parked';
      attempt.park_reason = stage.park_reason;
      return this.park(
        handle,
        pipeline,
        'verification failed — see evidence.md; intervene, then resume to re-verify',
      );
    }
    stage.status = 'done';
    return undefined;
  }

  private failStage(
    handle: RunHandle,
    pipeline: Pipeline,
    stage: StageState,
    result: StageResult,
    error: string,
  ): EngineOutcome {
    stage.status = 'failed';
    stage.error = error;
    if (result.raw ?? result.resultText) {
      const rawPath = `stage-${stage.name}-raw.txt`;
      writeFileAtomic(
        join(handle.runDir, rawPath),
        redactSecrets(result.raw ?? result.resultText),
      );
      stage.artifacts.push(rawPath);
    }
    return this.park(
      handle,
      pipeline,
      `stage ${stage.name} failed: ${error} — raw output preserved; fix the cause, then resume. ` +
        captureFailureHint(pipeline.run_id),
    );
  }

  private park(handle: RunHandle, pipeline: Pipeline, message: string): EngineOutcome {
    this.savePipeline(handle, pipeline);
    writeFileAtomic(
      join(handle.runDir, 'PARKED.md'),
      [
        `# PARKED — ${pipeline.run_id}`,
        '',
        `at: ${localIso()}`,
        `stage: ${pipeline.stages[pipeline.current_stage]?.name ?? 'unknown'}`,
        '',
        message,
        '',
        `Resume with: node harness/dist/cli.js resume ${pipeline.run_id}` +
          (pipeline.stages[pipeline.current_stage]?.name === 'approval' ? ' --approve' : ''),
        '',
      ].join('\n'),
    );
    logRunEvent(handle, { event: 'run_parked', message });
    this.log(`run ${pipeline.run_id} parked: ${message}`);
    return { state: 'parked', runId: pipeline.run_id, message };
  }

  private savePipeline(handle: RunHandle, pipeline: Pipeline): void {
    writeJsonAtomic(join(handle.runDir, 'pipeline.json'), pipeline);
  }
}
