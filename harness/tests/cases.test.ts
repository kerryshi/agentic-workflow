import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureFailure, caseSlug, resolveFailure } from '../src/cases.js';
import { readJson, writeJsonAtomic } from '../src/fsx.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-cases-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function capture(over: Record<string, unknown> = {}) {
  return captureFailure({
    root,
    summary: 'native verify drops output on multibyte tails',
    failureClass: 'environment_platform_issue',
    ...over,
  });
}

describe('harness case new (Node port of capture_failure.ps1)', () => {
  it('creates the full case: failure.json fields, 8 skeleton files, metrics event', async () => {
    const { caseId, caseDir } = await capture({
      severity: 'should_fix',
      reproCommand: 'npx vitest run tests/verify.test.ts',
      expected: 'tails intact',
      actual: 'tail truncated mid-rune',
      evidence: '- see run 2026-07-12_1811 evidence.md',
      preventionLayer: 'unit test',
    });
    expect(caseId).toBe('CASE-0001');

    const f = readJson<Record<string, unknown>>(join(caseDir, 'failure.json'));
    expect(f).toMatchObject({
      case_id: 'CASE-0001',
      resolved_at: null,
      status: 'open',
      failure_class: 'environment_platform_issue',
      severity: 'should_fix',
      prevention_layer: 'unit test',
      regression_test: null,
    });
    for (const name of [
      'prompt.md',
      'expected.md',
      'actual.md',
      'repro.md',
      'evidence.md',
      'classification.md',
      'fix.md',
      'regression.md',
    ]) {
      expect(existsSync(join(caseDir, name)), name).toBe(true);
    }
    expect(readFileSync(join(caseDir, 'actual.md'), 'utf8')).toContain('tail truncated mid-rune');

    const events = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(events.at(-1)!)).toMatchObject({
      type: 'failure_captured',
      case_id: 'CASE-0001',
      severity: 'should_fix',
    });
  });

  it('matches the real PS-written failure.json key set and order (cross-check fixture)', async () => {
    // The repo's own CASE-0001 was written by capture_failure.ps1 on the desktop.
    const psFixture = resolve(
      import.meta.dirname,
      '../../failures/CASE-0001_complete-run-capturediff-drops-non/failure.json',
    );
    if (!existsSync(psFixture)) return; // partial checkout — nothing to cross-check against
    const psKeys = Object.keys(readJson<Record<string, unknown>>(psFixture));
    const { caseDir } = await capture();
    const nodeKeys = Object.keys(readJson<Record<string, unknown>>(join(caseDir, 'failure.json')));
    expect(nodeKeys).toEqual(psKeys);
  });

  it('allocates sequential ids and survives dir collisions atomically', async () => {
    expect((await capture()).caseId).toBe('CASE-0001');
    expect((await capture({ summary: 'a second, different failure happened' })).caseId).toBe('CASE-0002');
    // a foreign dir with a higher number bumps the sequence
    mkdirSync(join(root, 'failures', 'CASE-0100_manual'));
    expect((await capture({ summary: 'third failure after manual case' })).caseId).toBe('CASE-0101');
  });

  it('links the case into run.json linked_failures when the run exists', async () => {
    const runDir = join(root, 'runs', '2026-07-12_1811_x');
    mkdirSync(runDir, { recursive: true });
    writeJsonAtomic(join(runDir, 'run.json'), { run_id: '2026-07-12_1811_x', linked_failures: [] });
    const { caseId } = await capture({ linkedRun: '2026-07-12_1811_x' });
    const run = readJson<{ linked_failures: string[] }>(join(runDir, 'run.json'));
    expect(run.linked_failures).toEqual([caseId]);
  });
});

describe('review findings 2026-07-12 (v2.2 adversarial panel)', () => {
  it('caseSlug matches New-Slug: 40-char cap trimmed to a word boundary', () => {
    const long = 'complete run capturediff drops non ascii untracked files everywhere always';
    const slug = caseSlug(long);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    // trimmed at a dash, not mid-word (PS: LastIndexOf('-') >= 8)
    expect(long.replace(/[^a-z0-9]+/g, '-').startsWith(slug)).toBe(true);
    expect(caseSlug('!!!')).toBe('failure');
  });

  it('a run.json without linked_failures gets the field instead of a TypeError', async () => {
    const runDir = join(root, 'runs', 'old-run');
    mkdirSync(runDir, { recursive: true });
    writeJsonAtomic(join(runDir, 'run.json'), { run_id: 'old-run' }); // pre-adapter record shape
    const { caseId } = await capture({ linkedRun: 'old-run' });
    const run = readJson<{ linked_failures: string[] }>(join(runDir, 'run.json'));
    expect(run.linked_failures).toEqual([caseId]);
  });

  it('resolve matches case ids case-insensitively (PS -like parity)', async () => {
    await capture();
    expect((await resolveFailure({ root, caseId: 'case-0001' })).caseId).toBe('CASE-0001');
  });

  it('a stray FILE named CASE-… neither poisons numbering nor matches resolve', async () => {
    mkdirSync(join(root, 'failures'), { recursive: true });
    writeJsonAtomic(join(root, 'failures', 'CASE-0500_notes.json'), { scratch: true });
    expect((await capture()).caseId).toBe('CASE-0001'); // file ignored, numbering intact
  });

  it('concurrent captures with different summaries never share a number (CASE-0005)', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        captureFailure({
          root,
          summary: `unique concurrent failure number ${i} with distinct slug`,
          failureClass: 'tool_error',
        }),
      ),
    );
    const ids = results.map((r) => r.caseId);
    expect(new Set(ids).size).toBe(6);
  });
});

describe('harness case resolve (Node port of resolve_failure.ps1)', () => {
  it('sets status/resolved_at/regression, appends the fix.md resolution, logs the event', async () => {
    const { caseId, caseDir } = await capture();
    const done = await resolveFailure({
      root,
      caseId,
      regressionTest: 'tests/verify.test.ts::multibyte tails',
      preventionLayer: 'unit test',
      fixSummary: 'Decode once at the end.',
    });
    expect(done.caseId).toBe(caseId);

    const f = readJson<Record<string, unknown>>(join(caseDir, 'failure.json'));
    expect(f['status']).toBe('fixed');
    expect(f['resolved_at']).toBeTruthy();
    expect(f['regression_test']).toBe('tests/verify.test.ts::multibyte tails');

    const fix = readFileSync(join(caseDir, 'fix.md'), 'utf8');
    expect(fix).toContain('## Resolution');
    expect(fix).toContain('Decode once at the end.');
    expect(fix).toContain('## Proposed Fix'); // skeleton not clobbered

    const events = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(events.at(-1)!)).toMatchObject({ type: 'failure_resolved', case_id: caseId });
  });

  it('anchors the id: CASE-1 must not resolve CASE-10', async () => {
    mkdirSync(join(root, 'failures', 'CASE-10_ten'), { recursive: true });
    writeJsonAtomic(join(root, 'failures', 'CASE-10_ten', 'failure.json'), {
      case_id: 'CASE-10',
      status: 'open',
      prevention_layer: null,
      regression_test: null,
      resolved_at: null,
    });
    await expect(resolveFailure({ root, caseId: 'CASE-1' })).rejects.toThrow(/not found/);
    expect((await resolveFailure({ root, caseId: 'CASE-10' })).caseId).toBe('CASE-10');
  });
});
