import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { appendJsonl, writeFileAtomic, writeJsonAtomic } from './fsx.js';
import { localIso, runId } from './ids.js';
import { claimDir } from './claim.js';
import { machineName } from './records.js';

/**
 * Port of scripts/new_run.ps1 (retired 2026-07-13) — a run record for work the HARNESS is not
 * driving: a manual task, or another agent under adapters/adapter-contract.md.
 * (Harness-driven runs come from records.createRun.)
 *
 * Regressions carried over from the PS original — each one is a bug that already bit:
 *   - Validate BEFORE claiming the id, so a bad call cannot leave an orphaned run directory.
 *   - agentId defaults to `manual`. An unknown agent must be recorded honestly, never guessed
 *     as claude-code (CASE-0008).
 *   - agentSurface inherits agentId when omitted, rather than defaulting to a wrong surface
 *     (CASE-0008).
 *   - The validation plan is NEVER comma-split: real commands contain commas, e.g.
 *     `pytest -k "a,b"`.
 * Regressions: tests/newrun.test.ts.
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export type AgentRole =
  | 'planner'
  | 'executor'
  | 'reviewer'
  | 'verifier'
  | 'classifier'
  | 'helper'
  | 'mixed';

export interface NewRunOpts {
  root: string;
  objective: string;
  repo: string;
  branch?: string;
  worktree?: string;
  riskLevel?: RiskLevel;
  validationPlan?: string[];
  machine?: 'windows' | 'wsl' | 'mac';
  agentId?: string;
  agentRole?: AgentRole;
  agentSurface?: string;
  agentModel?: string;
  promptSummary?: string;
  statusPath?: string;
  now?: Date;
}

function gitBranch(repo: string): string {
  try {
    return execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

const blank = (s: string | undefined): boolean => !s || s.trim() === '';

export function newRun(opts: NewRunOpts): { runId: string; runDir: string } {
  // Validate BEFORE claiming a directory: the original crashed AFTER the claim and left an
  // orphaned, id-consuming run folder behind.
  if (blank(opts.objective)) throw new Error('objective must not be empty or whitespace.');
  if (blank(opts.repo)) throw new Error('repo must not be empty or whitespace.');
  if (opts.agentId !== undefined && blank(opts.agentId)) {
    throw new Error('agentId must not be empty or whitespace.');
  }

  const now = opts.now ?? new Date();
  const createdAt = localIso(now);

  // Honest default: an unrecorded agent is `manual`, never a guess (CASE-0008).
  const agentId = opts.agentId?.trim() || 'manual';
  // Surface inherits the agent when unset — a selected adapter brings its own surface.
  const agentSurface = blank(opts.agentSurface) ? agentId : opts.agentSurface!.trim();

  // Trim blanks; NEVER comma-split — `pytest -k "a,b"` is one command.
  const validationPlan = (opts.validationPlan ?? [])
    .map((v) => String(v).trim())
    .filter((v) => v !== '');

  const repo = opts.repo.replace(/\\/g, '/');
  const branch = (blank(opts.branch) ? gitBranch(opts.repo) : opts.branch!) || 'unknown';

  const id = claimDir(join(opts.root, 'runs'), runId(opts.objective, now));
  const runDir = join(opts.root, 'runs', id);

  const validationMd = validationPlan.length
    ? validationPlan.map((v) => `- ${v}`).join('\n')
    : '- TBD';

  writeJsonAtomic(join(runDir, 'run.json'), {
    run_id: id,
    created_at: createdAt,
    completed_at: null,
    machine: opts.machine ?? machineName(),
    repo,
    repo_name: basename(opts.repo),
    branch,
    worktree: blank(opts.worktree) ? null : opts.worktree,
    objective: opts.objective,
    user_prompt_summary: opts.promptSummary ?? '',
    status_path: opts.statusPath ?? '',
    risk_level: opts.riskLevel ?? 'medium',
    agent: {
      agent_id: agentId,
      agent_role: opts.agentRole ?? 'mixed',
      surface: agentSurface,
      model: blank(opts.agentModel) ? null : opts.agentModel,
      adapter_version: 'v1',
    },
    status: 'in_progress',
    validation_plan: validationPlan,
    files_changed: [],
    linked_failures: [],
    evidence_links: [],
    reviewer_result: null,
    final_outcome: null,
  });

  writeFileAtomic(
    join(runDir, 'task.md'),
    `# ${id}

## Objective
${opts.objective}

## User Prompt Summary
${opts.promptSummary ?? ''}

## Repo
- Machine: ${opts.machine ?? machineName()}
- Path: ${repo}
- Branch/worktree: ${branch}
- Status path: ${opts.statusPath ?? ''}
- Risk level: ${opts.riskLevel ?? 'medium'}

## Agent Adapter
- Agent ID: ${agentId}
- Role: ${opts.agentRole ?? 'mixed'}
- Surface: ${agentSurface}
- Model: ${opts.agentModel ?? ''}
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
${validationMd}
`,
  );

  writeFileAtomic(
    join(runDir, 'plan.md'),
    `# Plan

## Approach
- TBD

## Constraints
- Preserve surrounding code style.
- Keep the diff scoped to the stated objective.
- Escalate product, API, data model, security, and irreversible decisions.

## Validation
${validationMd}
`,
  );

  // evidence.md / review.md are filled DURING the run (by hand or by /ship); completion
  // APPENDS rather than overwriting, so nothing scaffolded here is thrown away.
  writeFileAtomic(
    join(runDir, 'evidence.md'),
    `# Evidence

## Commands
| Command | Result | Notes |
|---|---|---|

## Proof
- TBD

## Artifacts
- TBD
`,
  );

  writeFileAtomic(
    join(runDir, 'review.md'),
    `# Review

## Independent Reviewer

## Must-fix
- TBD

## Should-fix / Nits
- TBD

## Resolution
- TBD
`,
  );

  writeFileAtomic(
    join(runDir, 'final.md'),
    `# Final

## Outcome
TBD

## What Changed
- TBD

## Validation
- TBD

## Risks
- TBD

## Follow-ups
- TBD
`,
  );

  writeFileAtomic(join(runDir, 'commands.jsonl'), '');
  writeFileAtomic(join(runDir, 'diff.patch'), '');

  appendJsonl(join(opts.root, 'metrics', 'runs.jsonl'), {
    type: 'run_started',
    at: createdAt,
    run_id: id,
    repo,
    objective: opts.objective,
    risk_level: opts.riskLevel ?? 'medium',
    agent_id: agentId,
    agent_role: opts.agentRole ?? 'mixed',
  });

  return { runId: id, runDir };
}
