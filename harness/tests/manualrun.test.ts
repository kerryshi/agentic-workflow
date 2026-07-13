import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeManualRun, resolveRun, updateRun } from '../src/manualrun.js';
import { newRun } from '../src/newrun.js';

/**
 * Regressions carried over from update_run.ps1 / complete_run.ps1 (retired 2026-07-13).
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-manual-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const make = (objective: string, repo = root) => newRun({ root, objective, repo });

describe('resolveRun auto-detect (CASE-0007)', () => {
  it('targets the single in-progress run', () => {
    const { runId } = make('the only active run');
    expect(resolveRun(root).runId).toBe(runId);
  });

  it('REFUSES when more than one run is in progress — never silently picks the newest', () => {
    // The original sorted every in-progress run across every repo by created_at and completed
    // the newest. It exited 0 having closed the wrong record.
    make('first active run');
    make('second active run');
    expect(() => resolveRun(root)).toThrow(/ambiguous: 2 in-progress runs/);
  });

  it('scopes auto-detect to the given repo, so another repo’s run is not a candidate', () => {
    const mine = mkdtempSync(join(tmpdir(), 'repo-mine-'));
    const theirs = mkdtempSync(join(tmpdir(), 'repo-theirs-'));
    try {
      const { runId } = newRun({ root, objective: 'my run', repo: mine });
      newRun({ root, objective: 'their run', repo: theirs });
      // Two in-progress runs overall, but only one for this repo.
      expect(() => resolveRun(root)).toThrow(/ambiguous/);
      expect(resolveRun(root, undefined, mine).runId).toBe(runId);
    } finally {
      rmSync(mine, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      rmSync(theirs, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it('refuses an unknown run id rather than inventing one', () => {
    expect(() => resolveRun(root, 'not-a-run')).toThrow(/no such run/);
  });

  it('says so when there is nothing in progress', () => {
    const { runId } = make('done already');
    return completeManualRun(resolveRun(root, runId)).then(() => {
      expect(() => resolveRun(root)).toThrow(/no in-progress run/);
    });
  });
});

describe('completeManualRun (CASE-0003)', () => {
  it('APPENDS a completion section — hand-written final.md content survives', async () => {
    const { runId, runDir } = make('append not overwrite');
    const finalMd = join(runDir, 'final.md');
    writeFileSync(finalMd, '# Final\n\nHAND-WRITTEN: this must survive completion.\n');

    await completeManualRun(resolveRun(root, runId), {
      status: 'shipped',
      finalOutcome: 'ported the reliability layer',
    });

    const text = readFileSync(finalMd, 'utf8');
    expect(text).toContain('HAND-WRITTEN: this must survive completion.');
    expect(text).toContain('## Completion');
    expect(text).toContain('- Status: shipped');
    expect(text).toContain('- Outcome: ported the reliability layer');
  });

  it('refuses to complete a run twice (a second run_completed would skew the metrics)', async () => {
    const { runId } = make('complete once');
    await completeManualRun(resolveRun(root, runId));
    await expect(completeManualRun(resolveRun(root, runId))).rejects.toThrow(/already completed/);
  });

  it('logs exactly one run_completed event', async () => {
    const { runId } = make('one event');
    await completeManualRun(resolveRun(root, runId), { status: 'complete' });
    const events = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });
    expect(events.filter((e) => e.type === 'run_completed')).toHaveLength(1);
  });

  it('captures a diff that git can actually apply, including a non-ASCII filename (R14)', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'repo-diff-'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' });
    try {
      git('init', '-q');
      git('config', 'user.email', 't@t.t');
      git('config', 'user.name', 't');
      writeFileSync(join(repo, 'seed.txt'), 'seed\n');
      git('add', '-A');
      git('commit', '-qm', 'seed');

      // An untracked, non-ASCII-named file: the exact shape that used to be dropped, because
      // filenames were round-tripped back through the shell and mojibaked.
      writeFileSync(join(repo, 'café.txt'), 'unicode\n');
      writeFileSync(join(repo, 'seed.txt'), 'seed\nchanged\n');

      const { runId } = newRun({ root, objective: 'capture a diff', repo });
      await completeManualRun(resolveRun(root, runId), { captureDiff: true, repo });

      const patch = readFileSync(join(root, 'runs', runId, 'diff.patch'), 'utf8');
      expect(patch).toContain('seed.txt');
      expect(patch).toContain('caf'); // the non-ASCII file is present, not silently dropped
    } finally {
      rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe('updateRun', () => {
  it('logs a command and attaches evidence without duplicating links', async () => {
    const { runId, runDir } = make('update me');
    const handle = resolveRun(root, runId);

    await updateRun(handle, { command: 'npm test', result: '138 passed', note: 'green' });
    await updateRun(handle, { evidenceLinks: ['evidence.md'], filesChanged: ['src/a.ts'] });
    await updateRun(handle, { evidenceLinks: ['evidence.md'] }); // same link again

    const cmds = readFileSync(join(runDir, 'commands.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(cmds[0]!)).toMatchObject({ command: 'npm test', result: '138 passed' });

    const rec = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as {
      evidence_links: string[];
      files_changed: string[];
    };
    expect(rec.evidence_links).toEqual(['evidence.md']); // deduped, not appended twice
    expect(rec.files_changed).toEqual(['src/a.ts']);
  });
});
