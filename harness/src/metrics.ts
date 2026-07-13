import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeFileAtomic, writeJsonAtomic, ensureDir } from './fsx.js';
import { localIso } from './ids.js';

/**
 * Port of scripts/summarize_metrics.ps1 (retired 2026-07-13).
 *
 * Three fixed bugs are load-bearing here and must not be undone — each one made the system
 * flatter itself:
 *   1. Evidence is PROVEN, not assumed. It counts a real evidence_link or a non-stub bullet in
 *      evidence.md. The original counted `status == shipped` as evidence, which reported a
 *      dishonest 100%. A metric that grades itself is not a metric.
 *   2. `wont_fix` is CLOSED but NOT RESOLVED. Counting it as resolved inflated the number.
 *   3. Duration averages only over runs that actually reached a terminal state — a blocked or
 *      abandoned run has no meaningful start-to-ship time.
 * Regressions: tests/metrics.test.ts.
 */

const TERMINAL = new Set(['shipped', 'complete']);
/** Stubs match by PREFIX: "- TBD (fill in later)" is still a stub, not evidence. */
const STUB_PREFIXES = ['- TBD', '- (none passed)'];

export interface MetricsSummary {
  updated_at: string;
  runs_started: number;
  runs_shipped: number;
  failed_runs: number;
  failures_total: number;
  failures_open: number;
  failures_resolved: number;
  failures_wont_fix: number;
  must_fix_failures: number;
  escaped_bugs: number;
  regressions_added: number;
  validation_evidence_rate_percent: number;
  average_minutes_start_to_ship: number | null;
  failure_classes: Record<string, number>;
}

interface Record_ {
  dir: string;
  data: Record<string, unknown>;
}

/** Read the named JSON file out of every immediate subdirectory of `dir`. A single corrupt
 *  record must not take down the whole report. */
function readRecordDirs(dir: string, fileName: string, onWarn?: (m: string) => void): Record_[] {
  if (!existsSync(dir)) return [];
  const out: Record_[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, fileName);
    if (!existsSync(path)) continue;
    try {
      out.push({ dir: join(dir, entry.name), data: readJson<Record<string, unknown>>(path) });
    } catch {
      onWarn?.(`Skipping invalid JSON: ${path}`);
    }
  }
  return out;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Honest evidence: a real evidence link, or an evidence.md bullet that is not a stub. */
function hasEvidence(rec: Record_): boolean {
  if (arr(rec.data['evidence_links']).length > 0) return true;

  const evidenceMd = join(rec.dir, 'evidence.md');
  if (!existsSync(evidenceMd)) return false;
  for (const line of readFileSync(evidenceMd, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('- ')) continue;
    if (!STUB_PREFIXES.some((p) => t.startsWith(p))) return true;
  }
  return false;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function summarizeMetrics(root: string, onWarn?: (m: string) => void): MetricsSummary {
  const runs = readRecordDirs(join(root, 'runs'), 'run.json', onWarn);
  const failures = readRecordDirs(join(root, 'failures'), 'failure.json', onWarn);

  const shipped = runs.filter((r) => TERMINAL.has(str(r.data['status'])));
  const runsWithEvidence = runs.filter(hasEvidence).length;

  const durations: number[] = [];
  for (const rec of shipped) {
    const start = Date.parse(str(rec.data['created_at']));
    const end = Date.parse(str(rec.data['completed_at']));
    if (Number.isFinite(start) && Number.isFinite(end)) durations.push((end - start) / 60_000);
  }

  const classes: Record<string, number> = {};
  for (const rec of failures) {
    const cls = str(rec.data['failure_class']).trim() || 'unclassified';
    classes[cls] = (classes[cls] ?? 0) + 1;
  }

  const byStatus = (...want: string[]) =>
    failures.filter((f) => want.includes(str(f.data['status']))).length;

  return {
    updated_at: localIso(),
    runs_started: runs.length,
    runs_shipped: shipped.length,
    failed_runs: runs.filter((r) => arr(r.data['linked_failures']).length > 0).length,
    failures_total: failures.length,
    failures_open: byStatus('open'),
    // wont_fix is closed, NOT resolved — counting it here inflated the metric.
    failures_resolved: byStatus('fixed', 'resolved'),
    failures_wont_fix: byStatus('wont_fix'),
    must_fix_failures: failures.filter((f) => str(f.data['severity']) === 'must_fix').length,
    escaped_bugs: failures.filter((f) => str(f.data['severity']) === 'escaped_bug').length,
    regressions_added: failures.filter((f) => str(f.data['regression_test']).trim() !== '').length,
    validation_evidence_rate_percent: runs.length
      ? round1((runsWithEvidence / runs.length) * 100)
      : 0,
    average_minutes_start_to_ship: durations.length
      ? round1(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
    failure_classes: classes,
  };
}

export function renderMetrics(s: MetricsSummary): string {
  const classRows = Object.keys(s.failure_classes).length
    ? Object.keys(s.failure_classes)
        .sort()
        .map((k) => `| ${k} | ${s.failure_classes[k]} |`)
        .join('\n')
    : '| none | 0 |';

  return [
    '# Agentic Workflow Metrics',
    '',
    `Last updated: ${s.updated_at}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Runs started | ${s.runs_started} |`,
    `| Runs shipped/complete | ${s.runs_shipped} |`,
    `| Runs with linked failures | ${s.failed_runs} |`,
    `| Validation evidence rate | ${s.validation_evidence_rate_percent}% |`,
    `| Avg minutes start to ship | ${s.average_minutes_start_to_ship ?? 'n/a'} |`,
    `| Failure cases | ${s.failures_total} |`,
    `| Open failures | ${s.failures_open} |`,
    `| Resolved failures | ${s.failures_resolved} |`,
    `| Won't-fix failures | ${s.failures_wont_fix} |`,
    `| Must-fix failures | ${s.must_fix_failures} |`,
    `| Escaped bugs | ${s.escaped_bugs} |`,
    `| Regressions added | ${s.regressions_added} |`,
    '',
    '## Failure Classes',
    '',
    '| Class | Count |',
    '|---|---:|',
    classRows,
    '',
  ].join('\n');
}

/** Write metrics/summary.md + summary.json. Returns the summary it wrote. */
export function writeMetrics(root: string, onWarn?: (m: string) => void): MetricsSummary {
  const summary = summarizeMetrics(root, onWarn);
  const metricsDir = join(root, 'metrics');
  ensureDir(metricsDir);
  writeFileAtomic(join(metricsDir, 'summary.md'), renderMetrics(summary));
  writeJsonAtomic(join(metricsDir, 'summary.json'), summary);
  return summary;
}
