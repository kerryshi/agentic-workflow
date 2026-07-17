import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderMetrics, summarizeMetrics, writeMetrics } from '../src/metrics.js';

/**
 * Regressions carried over from scripts/summarize_metrics.ps1 when it was retired
 * (2026-07-13). The first two are the ones that matter: both were bugs where the metric
 * flattered the system.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-metrics-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function run(id: string, record: Record<string, unknown>, evidenceMd?: string): void {
  const dir = join(root, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify(record));
  if (evidenceMd !== undefined) writeFileSync(join(dir, 'evidence.md'), evidenceMd);
}

function failure(id: string, record: Record<string, unknown>): void {
  const dir = join(root, 'failures', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'failure.json'), JSON.stringify(record));
}

describe('metrics (Node port of summarize_metrics.ps1)', () => {
  it('counts evidence only when it is PROVEN, never from status', () => {
    // The original bug: `status == shipped` was treated as evidence, so the evidence rate read
    // a dishonest 100%. A shipped run with nothing but a stub has produced no evidence.
    run('a', { status: 'shipped', evidence_links: [] }, '# Evidence\n- TBD\n');
    run('b', { status: 'shipped', evidence_links: [] }, '# Evidence\n- (none passed)\n');
    run('c', { status: 'shipped', evidence_links: [] }, '# Evidence\n- npm test: 138 passed\n');
    run('d', { status: 'shipped', evidence_links: ['runs/x/tokens.md'] });

    const s = summarizeMetrics(root);
    expect(s.runs_started).toBe(4);
    expect(s.runs_shipped).toBe(4);
    expect(s.validation_evidence_rate_percent).toBe(50); // c and d only — not 100
  });

  it('treats "- TBD (fill in later)" as a stub — stubs match by PREFIX', () => {
    run('a', { status: 'shipped' }, '# Evidence\n- TBD (fill in later)\n');
    expect(summarizeMetrics(root).validation_evidence_rate_percent).toBe(0);
  });

  it('counts wont_fix as CLOSED but NOT resolved', () => {
    // Counting wont_fix as resolved inflated the resolved number.
    failure('CASE-0001', { status: 'fixed', regression_test: 'tests/x.test.ts' });
    failure('CASE-0002', { status: 'resolved', regression_test: 'tests/y.test.ts' });
    failure('CASE-0003', { status: 'wont_fix' });
    failure('CASE-0004', { status: 'open', severity: 'must_fix' });

    const s = summarizeMetrics(root);
    expect(s.failures_total).toBe(4);
    expect(s.failures_resolved).toBe(2); // NOT 3
    expect(s.failures_wont_fix).toBe(1);
    expect(s.failures_open).toBe(1);
    expect(s.regressions_added).toBe(2);
    expect(s.must_fix_failures).toBe(1);
  });

  it('renders regressions_added as "Regression tests added" — tests, not regressions caused', () => {
    // Two meanings of "regression" sit adjacent in summary.md (this counter vs the
    // regression_introduced failure class); the label must say which one this is.
    failure('CASE-0001', { status: 'fixed', regression_test: 'tests/x.test.ts' });
    const md = renderMetrics(summarizeMetrics(root));
    expect(md).toContain('| Regression tests added | 1 |');
    expect(md).not.toContain('| Regressions added |');
  });

  it('averages duration only over runs that actually reached a terminal state', () => {
    run('a', {
      status: 'shipped',
      created_at: '2026-07-13T10:00:00-04:00',
      completed_at: '2026-07-13T10:30:00-04:00',
    });
    // Abandoned: has both timestamps, but no meaningful start-to-ship time. Must not count.
    run('b', {
      status: 'abandoned',
      created_at: '2026-07-13T10:00:00-04:00',
      completed_at: '2026-07-13T20:00:00-04:00',
    });

    expect(summarizeMetrics(root).average_minutes_start_to_ship).toBe(30);
  });

  it('reports n/a, not 0, when nothing has shipped', () => {
    run('a', { status: 'in_progress' });
    const s = summarizeMetrics(root);
    expect(s.average_minutes_start_to_ship).toBeNull();
    expect(renderContains(root, '| Avg minutes start to ship | n/a |')).toBe(true);
  });

  it('one corrupt record does not take down the report', () => {
    run('good', { status: 'shipped' }, '# Evidence\n- proof\n');
    const bad = join(root, 'runs', 'bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'run.json'), '{ not json');

    const warnings: string[] = [];
    const s = summarizeMetrics(root, (m) => warnings.push(m));
    expect(s.runs_started).toBe(1);
    expect(warnings[0]).toMatch(/Skipping invalid JSON/);
  });

  it('buckets a missing failure_class as `unclassified`', () => {
    failure('CASE-0001', { status: 'fixed', failure_class: 'tool_error' });
    failure('CASE-0002', { status: 'fixed' });
    expect(summarizeMetrics(root).failure_classes).toEqual({ tool_error: 1, unclassified: 1 });
  });

  it('writes BOM-less summary.md + summary.json', () => {
    run('a', { status: 'shipped' }, '# Evidence\n- proof\n');
    const written = writeMetrics(root);
    const md = readFileSync(join(root, 'metrics', 'summary.md'));
    const json = readFileSync(join(root, 'metrics', 'summary.json'));
    expect(md[0]).not.toBe(0xef);
    expect(json[0]).not.toBe(0xef);
    expect(JSON.parse(json.toString('utf8')).runs_started).toBe(written.runs_started);
  });
});

function renderContains(root: string, needle: string): boolean {
  writeMetrics(root);
  return readFileSync(join(root, 'metrics', 'summary.md'), 'utf8').includes(needle);
}
