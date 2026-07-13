import { existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { appendJsonl, readJson, writeFileAtomic, writeJsonAtomic } from './fsx.js';
import { localIso } from './ids.js';
import { withDirLock } from './lock.js';
import { machineName } from './records.js';
import type { RunRecord } from './types.js';

/**
 * Node port of scripts/capture_failure.ps1 + resolve_failure.ps1 — the
 * failure-capture loop finally closes on the Mac (the PS scripts are
 * Windows-only; park messages used to say "note it for a desktop-side run").
 * Field order, file set, and metrics events match the PS scripts; the
 * cross-check test compares against a real PS-written case.
 */

export const FAILURE_CLASSES = [
  'bad_context',
  'bad_plan',
  'wrong_file_edited',
  'syntax_type_error',
  'test_failure',
  'hallucinated_api',
  'unsafe_command',
  'weak_verification',
  'user_intent_misunderstood',
  'tool_error',
  'environment_platform_issue',
  'permission_issue',
  'shortcut_gamed_check',
  'regression_introduced',
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const SEVERITIES = ['must_fix', 'should_fix', 'escaped_bug', 'blocker', 'note'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const RESOLVE_STATUSES = ['fixed', 'wont_fix', 'resolved'] as const;
export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

export interface CaptureOpts {
  root: string;
  summary: string;
  failureClass: FailureClass;
  severity?: Severity;
  linkedRun?: string;
  repo?: string;
  commitOrBranch?: string;
  reproCommand?: string;
  expected?: string;
  actual?: string;
  evidence?: string;
  preventionLayer?: string;
}

/** PS parity: New-Slug (_common.ps1) — 40 chars max, trimmed to a word boundary. */
export function caseSlug(text: string, fallback = 'failure'): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 40) {
    slug = slug.slice(0, 40);
    const lastDash = slug.lastIndexOf('-');
    if (lastDash >= 8) slug = slug.slice(0, lastDash);
    slug = slug.replace(/^-+|-+$/g, '');
  }
  return slug || fallback;
}

function gitBranchOf(repo: string): string {
  try {
    // PS parity (Get-GitBranch): abbrev-ref reports 'HEAD' on a detached head
    // rather than silently degrading to 'unknown'.
    return execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** Case dirs only — a stray file named CASE-… must not poison numbering (PS filters to dirs). */
function caseDirs(failuresDir: string): string[] {
  return readdirSync(failuresDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

const or = (v: string | undefined, fallback: string) => (v && v.trim() ? v : fallback);

export async function captureFailure(opts: CaptureOpts): Promise<{ caseId: string; caseDir: string }> {
  const failuresDir = join(opts.root, 'failures');
  mkdirSync(failuresDir, { recursive: true });

  const slug = caseSlug(opts.summary);
  const repo = (opts.repo ?? process.cwd()).replace(/\\/g, '/');
  const commitOrBranch = or(opts.commitOrBranch, gitBranchOf(repo) || 'unknown');
  const severity = opts.severity ?? 'must_fix';

  // Scan + claim UNDER THE LOCK, like the PS script: the review reproduced
  // CASE-0005 (14/15 duplicate ids from two racing captures) when this port
  // briefly relied on the mkdir claim alone — the claimed name embeds the
  // slug, so different summaries never collide. The mkdir loop stays as an
  // in-lock backstop; only EEXIST means collision (a real error must not
  // spin the counter to 100k).
  const { caseId, caseDir } = await withDirLock(failuresDir, () => {
    const numbers = caseDirs(failuresDir)
      .map((d) => /^CASE-(\d+)(?:_|$)/.exec(d)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    let next = numbers.length ? Math.max(...numbers) + 1 : 1;
    for (;;) {
      const id = `CASE-${String(next).padStart(4, '0')}`;
      const dir = join(failuresDir, `${id}_${slug}`);
      try {
        mkdirSync(dir); // non-recursive: EEXIST = collision, the atomic backstop
        return { caseId: id, caseDir: dir };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        next++;
        if (next > 100_000) throw new Error(`could not allocate a case id under ${failuresDir}`);
      }
    }
  });

  const createdAt = localIso();
  writeJsonAtomic(join(caseDir, 'failure.json'), {
    case_id: caseId,
    created_at: createdAt,
    resolved_at: null,
    machine: machineName(),
    linked_run: opts.linkedRun ?? '',
    repo,
    repo_name: basename(repo),
    commit_or_branch: commitOrBranch,
    summary: opts.summary,
    failure_class: opts.failureClass,
    severity,
    repro_command: opts.reproCommand ?? '',
    status: 'open',
    prevention_layer: opts.preventionLayer?.trim() ? opts.preventionLayer : null,
    regression_test: null,
  });

  // Always bash: even on Windows the harness routes users through Git Bash.
  const fenceLang = 'bash';
  const files: Record<string, string> = {
    'prompt.md': `# Prompt / Situation\n\n${opts.summary}\n\n## Linked Run\n${opts.linkedRun ?? ''}\n\n## Repo\n- Machine: ${machineName()}\n- Path: ${repo}\n- Commit/branch: ${commitOrBranch}\n`,
    'expected.md': `# Expected Behavior\n\n${or(opts.expected, 'TBD')}\n`,
    'actual.md': `# Actual Behavior\n\n${or(opts.actual, 'TBD')}\n`,
    'repro.md': `# Reproduction\n\n## Command\n\n\`\`\`${fenceLang}\n${opts.reproCommand ?? ''}\n\`\`\`\n\n## Manual Steps\n- TBD\n`,
    'evidence.md': `# Evidence\n\n${or(opts.evidence, '- TBD')}\n`,
    'classification.md': `# Classification\n\n- Failure class: ${opts.failureClass}\n- Severity: ${severity}\n- Prevention layer: ${or(opts.preventionLayer, 'TBD')}\n\n## Root Cause\nTBD\n\n## Contributing Factors\n- TBD\n`,
    'fix.md': `# Fix\n\n## Proposed Fix\nTBD\n\n## Applied Fix\nTBD\n\n## Verification\nTBD\n`,
    'regression.md': `# Regression\n\n## Regression Test\nTBD\n\n## Failing-First Evidence\nTBD\n\n## Passing Evidence\nTBD\n`,
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileAtomic(join(caseDir, name), content);
  }

  if (opts.linkedRun) {
    const runJson = join(opts.root, 'runs', opts.linkedRun, 'run.json');
    if (existsSync(runJson)) {
      // Locked RMW: an engine writing this run.json in another process must
      // not lose the link (CASE-0004 class — the PS script locks here too).
      await withDirLock(runJson, () => {
        const run = readJson<RunRecord>(runJson);
        const linked = (run.linked_failures ??= []); // older records may lack the field
        if (!linked.includes(caseId)) linked.push(caseId);
        writeJsonAtomic(runJson, run);
      });
    } else {
      console.error(`warning: --linked-run '${opts.linkedRun}' not found; case created without a run link`);
    }
  }

  appendJsonl(join(opts.root, 'metrics', 'runs.jsonl'), {
    type: 'failure_captured',
    at: createdAt,
    case_id: caseId,
    linked_run: opts.linkedRun ?? '',
    failure_class: opts.failureClass,
    severity,
    repo,
  });

  return { caseId, caseDir };
}

export interface ResolveOpts {
  root: string;
  caseId: string;
  status?: ResolveStatus;
  regressionTest?: string;
  preventionLayer?: string;
  fixSummary?: string;
}

interface FailureRecord {
  case_id: string;
  resolved_at: string | null;
  status: string;
  prevention_layer: string | null;
  regression_test: string | null;
  [k: string]: unknown;
}

export async function resolveFailure(opts: ResolveOpts): Promise<{ caseId: string; caseDir: string }> {
  const failuresDir = join(opts.root, 'failures');
  // Accept CASE-0001 or the full dir name, case-insensitively (PS -like is
  // case-insensitive; `case-0007` must keep working after the port); anchor
  // so CASE-1 can't match CASE-10.
  const key = (/^(CASE-\d+)/i.exec(opts.caseId)?.[1] ?? opts.caseId).toUpperCase();
  const dir = existsSync(failuresDir)
    ? caseDirs(failuresDir).find((d) => d.toUpperCase() === key || d.toUpperCase().startsWith(`${key}_`))
    : undefined;
  if (!dir) throw new Error(`failure case not found: ${opts.caseId}`);
  const caseDir = join(failuresDir, dir);

  const failureJson = join(caseDir, 'failure.json');
  if (!existsSync(failureJson)) throw new Error(`failure.json missing in ${caseDir}`);

  const status: ResolveStatus = opts.status ?? 'fixed';
  const resolvedAt = localIso();
  const failure = await withDirLock(failureJson, () => {
    const f = readJson<FailureRecord>(failureJson);
    f.status = status;
    f.resolved_at = resolvedAt;
    if (opts.regressionTest?.trim()) f.regression_test = opts.regressionTest;
    if (opts.preventionLayer?.trim()) f.prevention_layer = opts.preventionLayer;
    writeJsonAtomic(failureJson, f);
    return f;
  });

  const fixAppend =
    `\n\n## Resolution (${resolvedAt})\n` +
    `- Status: ${status}\n` +
    `- Regression test: ${or(opts.regressionTest, 'TBD')}\n` +
    `- Prevention layer: ${or(opts.preventionLayer, 'TBD')}\n\n` +
    `${opts.fixSummary ?? ''}\n`;
  const fixPath = join(caseDir, 'fix.md');
  if (existsSync(fixPath)) appendFileSync(fixPath, fixAppend, 'utf8');
  else writeFileAtomic(fixPath, `# Fix${fixAppend}`);

  appendJsonl(join(opts.root, 'metrics', 'runs.jsonl'), {
    type: 'failure_resolved',
    at: resolvedAt,
    case_id: failure.case_id,
    status,
    prevention_layer: String(failure.prevention_layer ?? ''),
    regression_test: String(failure.regression_test ?? ''),
  });

  return { caseId: failure.case_id, caseDir };
}
