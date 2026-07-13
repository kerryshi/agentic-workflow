import { appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotDiff } from './diff.js';
import { appendJsonl, readJson, writeFileAtomic, writeJsonAtomic } from './fsx.js';
import { localIso } from './ids.js';
import { withDirLock } from './lock.js';
import type { RunRecord } from './types.js';
import { completeRun, type CompleteRunOpts, type RunHandle } from './records.js';

/**
 * The manual-run lifecycle: the Node replacement for update_run.ps1 and complete_run.ps1
 * (retired 2026-07-13). Harness-driven runs are closed by the engine; these are for runs the
 * harness is NOT driving (see newrun.ts).
 *
 * Regressions carried over — every one of these is a bug that already shipped once:
 *   - CASE-0007: auto-detecting "the active run" must target the intended run or REFUSE
 *     LOUDLY. The original sorted every in-progress run across every repo by created_at and
 *     silently completed the newest — the wrong record, exit 0.
 *   - CASE-0003: completion APPENDS to final.md; it never overwrites hand-written content, and
 *     it refuses to re-complete a finished run (which would double-log run_completed and skew
 *     the metrics).
 *   - CASE-0001 / CASE-0006: the captured diff must apply cleanly and must not drop
 *     non-ASCII filenames — hence snapshotDiff(), which lets git enumerate paths itself on a
 *     throwaway index instead of round-tripping filenames back through the shell.
 * Regressions: tests/manualrun.test.ts.
 */

/**
 * Resolve which run to act on. With no id: the single in-progress run FOR THIS REPO. More than
 * one candidate is an ambiguity, and ambiguity is refused, never guessed (CASE-0007).
 */
export function resolveRun(root: string, runId?: string, repo?: string): RunHandle {
  const runsDir = join(root, 'runs');
  if (runId) {
    const runDir = join(runsDir, runId);
    if (!existsSync(join(runDir, 'run.json'))) throw new Error(`no such run: ${runId}`);
    return { runId, runDir, root };
  }
  if (!existsSync(runsDir)) throw new Error('no runs/ directory — nothing to resolve.');

  const wanted = repo?.replace(/\\/g, '/');
  const active = readdirSync(runsDir).filter((id) => {
    const path = join(runsDir, id, 'run.json');
    if (!existsSync(path)) return false;
    try {
      const rec = readJson<RunRecord>(path);
      if (rec.completed_at !== null) return false;
      return wanted ? rec.repo === wanted : true;
    } catch {
      return false;
    }
  });

  if (active.length === 0) throw new Error('no in-progress run found — pass a run id.');
  if (active.length > 1) {
    // Never "newest wins": that silently completed the wrong record (CASE-0007).
    throw new Error(
      `ambiguous: ${active.length} in-progress runs — name one explicitly.\n  ${active.join('\n  ')}`,
    );
  }
  return { runId: active[0]!, runDir: join(runsDir, active[0]!), root };
}

export interface UpdateRunOpts {
  command?: string;
  result?: string;
  note?: string;
  evidenceLinks?: string[];
  filesChanged?: string[];
}

/** Log a command and/or attach evidence to a run that is still in progress. */
export async function updateRun(handle: RunHandle, opts: UpdateRunOpts): Promise<void> {
  if (opts.command !== undefined) {
    appendJsonl(join(handle.runDir, 'commands.jsonl'), {
      at: localIso(),
      command: opts.command,
      result: opts.result ?? '',
      note: opts.note ?? '',
    });
  }

  if (opts.evidenceLinks?.length || opts.filesChanged?.length) {
    const path = join(handle.runDir, 'run.json');
    // Locked read-modify-write: another process may be writing linked_failures into this same
    // file at the same moment (CASE-0004).
    await withDirLock(path, () => {
      const rec = readJson<RunRecord>(path);
      if (opts.evidenceLinks?.length) {
        rec.evidence_links = [...new Set([...rec.evidence_links, ...opts.evidenceLinks])];
      }
      if (opts.filesChanged?.length) {
        rec.files_changed = [...new Set([...rec.files_changed, ...opts.filesChanged])];
      }
      writeJsonAtomic(path, rec);
    });
  }
}

export interface CompleteManualRunOpts extends CompleteRunOpts {
  /** Capture the working-tree diff into diff.patch (git-native, applies cleanly). */
  captureDiff?: boolean;
  repo?: string;
  risks?: string;
  followUps?: string;
}

export async function completeManualRun(
  handle: RunHandle,
  opts: CompleteManualRunOpts = {},
): Promise<RunRecord> {
  const { captureDiff, repo, risks, followUps, ...completeOpts } = opts;

  // completeRun refuses a second completion (CASE-0003) and takes the lock (CASE-0004).
  const record = await completeRun(handle, completeOpts);

  if (captureDiff) {
    const target = repo ?? record.repo;
    // snapshotDiff has git enumerate the paths itself on a throwaway index — filenames never
    // round-trip through the shell, so non-ASCII names survive (CASE-0001/R14) and the patch
    // applies cleanly (CASE-0006).
    const diff = await snapshotDiff(target);
    writeFileAtomic(join(handle.runDir, 'diff.patch'), diff ?? '');
  }

  // APPEND a completion section — never overwrite hand-written content (CASE-0003).
  const finalMd = join(handle.runDir, 'final.md');
  const section = [
    '',
    `## Completion — ${record.completed_at}`,
    '',
    `- Status: ${record.status}`,
    ...(record.final_outcome ? [`- Outcome: ${record.final_outcome}`] : []),
    ...(record.reviewer_result ? [`- Reviewer: ${record.reviewer_result}`] : []),
    ...(risks ? [`- Risks: ${risks}`] : []),
    ...(followUps ? [`- Follow-ups: ${followUps}`] : []),
    ...(record.evidence_links.length
      ? [`- Evidence: ${record.evidence_links.join(', ')}`]
      : []),
    '',
  ].join('\n');
  appendFileSync(finalMd, section, { encoding: 'utf8' });

  return record;
}
