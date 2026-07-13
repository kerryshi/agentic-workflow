import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { AgentId, RunRecord, TemplateName } from './types.js';
import { ensureDir, writeJsonAtomic, writeFileAtomic, readJson, appendJsonl } from './fsx.js';
import { runId, localIso } from './ids.js';

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
    return execFileSync('git', ['-C', repo, 'branch', '--show-current'], {
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

export function createRun(opts: CreateRunOpts): RunHandle {
  const now = opts.now ?? new Date();
  let id = runId(opts.task, now);
  // Same-minute same-slug runs must not clobber an existing record.
  if (existsSync(join(opts.root, 'runs', id))) {
    let n = 2;
    while (existsSync(join(opts.root, 'runs', `${id}-${n}`))) n++;
    id = `${id}-${n}`;
  }
  const runDir = join(opts.root, 'runs', id);
  ensureDir(runDir);

  const record: RunRecord = {
    run_id: id,
    created_at: localIso(now),
    completed_at: null,
    machine: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'wsl',
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

export function completeRun(handle: RunHandle, opts: CompleteRunOpts = {}): RunRecord {
  const path = join(handle.runDir, 'run.json');
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
export function updateRunValidationPlan(handle: RunHandle, commands: string[]): void {
  const path = join(handle.runDir, 'run.json');
  const record = readJson<RunRecord>(path);
  record.validation_plan = commands;
  writeJsonAtomic(path, record);
}

/** One event per stage transition / agent invocation, into the run's commands.jsonl. */
export function logRunEvent(handle: RunHandle, event: Record<string, unknown>): void {
  appendJsonl(join(handle.runDir, 'commands.jsonl'), {
    at: localIso(),
    ...event,
  });
}
