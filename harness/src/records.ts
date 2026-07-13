import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import type { AgentId, RunRecord, TemplateName } from './types.js';
import { ensureDir, writeJsonAtomic, writeFileAtomic, readJson, appendJsonl } from './fsx.js';
import { runId, localIso } from './ids.js';
import { claimDir } from './claim.js';
import { withDirLock } from './lock.js';

export const AGENT_ID_MAP: Record<AgentId, string> = {
  claude: 'claude-code',
  codex: 'codex',
};

export interface CreateRunOpts {
  root: string; // agentic-workflow data root (holds runs/, metrics/)
  repo: string; // target repo the task runs against
  task: string;
  template: TemplateName;
  builder: AgentId;
  reviewer: AgentId;
  model: string | null;
  riskLevel?: 'low' | 'medium' | 'high';
  validationPlan?: string[];
  promptSummary?: string;
  now?: Date;
}

export interface RunHandle {
  runId: string;
  runDir: string;
  root: string;
}

function gitBranch(repo: string): string {
  try {
    // abbrev-ref: detached HEAD reports 'HEAD' instead of empty (PS parity)
    return execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Forward slashes, matching the v1 scripts' repo field convention. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** The machine this process actually runs on (Kerry's linux = WSL). */
export function machineName(): 'windows' | 'wsl' | 'mac' {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'wsl';
}

export function createRun(opts: CreateRunOpts): RunHandle {
  const now = opts.now ?? new Date();
  // Claim the id atomically. This was existsSync() -> pick a suffix -> ensureDir(), which is
  // check-then-act: ensureDir is mkdir -p and SUCCEEDS on an existing directory, so two
  // processes starting the same task in the same minute both saw "free", both took the same
  // id, and the second overwrote the first's run.json. Measured on the reconstructed code:
  // 4 processes x 150 contended ids lost 17-105 runs per run (CASE-0005 class; CASE-0018
  // records the same bug reintroduced in the case port). Regression: tests/run-claim.test.ts.
  const id = claimDir(join(opts.root, 'runs'), runId(opts.task, now));
  const runDir = join(opts.root, 'runs', id);

  const record: RunRecord = {
    run_id: id,
    created_at: localIso(now),
    completed_at: null,
    machine: machineName(),
    repo: normalizePath(opts.repo),
    repo_name: basename(opts.repo),
    branch: gitBranch(opts.repo),
    worktree: null,
    objective: opts.task,
    user_prompt_summary: opts.promptSummary ?? '',
    status_path: '',
    risk_level: opts.riskLevel ?? 'medium',
    agent: {
      agent_id: AGENT_ID_MAP[opts.builder],
      agent_role: 'executor',
      surface: 'harness',
      model: opts.model,
      adapter_version: 'v2-harness',
    },
    status: 'in_progress',
    validation_plan: opts.validationPlan ?? [],
    files_changed: [],
    linked_failures: [],
    evidence_links: [],
    reviewer_result: null,
    final_outcome: null,
  };
  writeJsonAtomic(join(runDir, 'run.json'), record);

  writeFileAtomic(
    join(runDir, 'task.md'),
    [
      `# Task — ${id}`,
      '',
      `## Objective`,
      opts.task,
      '',
      `## Repo`,
      `${normalizePath(opts.repo)} (branch: ${record.branch || 'unknown'})`,
      '',
      `## Risk`,
      record.risk_level,
      '',
      `## Validation plan`,
      ...(record.validation_plan.length
        ? record.validation_plan.map((v) => `- ${v}`)
        : ['- TBD']),
      '',
      `## Agent Adapter`,
      `- pipeline template: ${opts.template}`,
      `- builder: ${AGENT_ID_MAP[opts.builder]}`,
      `- reviewer: ${AGENT_ID_MAP[opts.reviewer]}`,
      `- surface: harness (v2)`,
      '',
    ].join('\n'),
  );

  appendJsonl(join(opts.root, 'metrics', 'runs.jsonl'), {
    type: 'run_started',
    at: record.created_at,
    run_id: id,
    repo: record.repo,
    objective: opts.task,
    risk_level: record.risk_level,
  });

  return { runId: id, runDir, root: opts.root };
}

export interface CompleteRunOpts {
  status?: 'shipped' | 'complete' | 'blocked' | 'abandoned';
  finalOutcome?: string;
  reviewerResult?: string;
  evidenceLinks?: string[];
  filesChanged?: string[];
  now?: Date;
}

export async function completeRun(handle: RunHandle, opts: CompleteRunOpts = {}): Promise<RunRecord> {
  const path = join(handle.runDir, 'run.json');
  // Locked RMW: `harness case new --linked-run` in another process writes
  // linked_failures into this same file (CASE-0004 class).
  const record = await withDirLock(path, () => {
    const record = readJson<RunRecord>(path);
    if (record.completed_at !== null) {
      // Re-completing would append a duplicate run_completed event and skew
      // metrics (the v1 scripts refuse this without -Force; the harness never
      // re-completes). CASE-0003 class.
      throw new Error(`run ${record.run_id} is already completed (${record.completed_at})`);
    }
    record.status = opts.status ?? 'complete';
    record.completed_at = localIso(opts.now ?? new Date());
    if (opts.finalOutcome !== undefined) record.final_outcome = opts.finalOutcome;
    if (opts.reviewerResult !== undefined) record.reviewer_result = opts.reviewerResult;
    if (opts.evidenceLinks)
      record.evidence_links = [...new Set([...record.evidence_links, ...opts.evidenceLinks])];
    if (opts.filesChanged)
      record.files_changed = [...new Set([...record.files_changed, ...opts.filesChanged])];
    writeJsonAtomic(path, record);
    return record;
  });

  appendJsonl(join(handle.root, 'metrics', 'runs.jsonl'), {
    type: 'run_completed',
    at: record.completed_at,
    run_id: record.run_id,
    status: record.status,
    repo: record.repo,
  });
  return record;
}

/** Sync the plan stage's validation commands into run.json (FR1 field). */
export async function updateRunValidationPlan(handle: RunHandle, commands: string[]): Promise<void> {
  const path = join(handle.runDir, 'run.json');
  await withDirLock(path, () => {
    const record = readJson<RunRecord>(path);
    record.validation_plan = commands;
    writeJsonAtomic(path, record);
  });
}

/** One event per stage transition / agent invocation, into the run's commands.jsonl. */
export function logRunEvent(handle: RunHandle, event: Record<string, unknown>): void {
  appendJsonl(join(handle.runDir, 'commands.jsonl'), {
    at: localIso(),
    ...event,
  });
}
