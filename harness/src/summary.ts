import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './fsx.js';
import { migratePipeline } from './engine.js';
import type { Pipeline } from './types.js';

/**
 * Estate-wide catch-rate: the number that answers "is the review insurance
 * paying?" as run history accumulates. Findings are tracked per attempt
 * since v2.1 (2026-07-12); older runs contribute cost/rounds but their
 * finding counts live only in prose (review.md) — reported as such, never
 * silently zeroed.
 */

export interface RunSummaryRow {
  run_id: string;
  template: string;
  state: 'completed' | 'active';
  cost_usd: number;
  review_rounds: number;
  must_fix_caught: number | null; // null = pre-v2.1 record, findings not machine-readable
}

export interface EstateSummary {
  rows: RunSummaryRow[];
  /** pipeline.json files that could not be read — reported, never silently dropped. */
  skipped: string[];
  totals: {
    runs: number;
    completed: number;
    active: number;
    cost_usd: number;
    review_rounds: number;
    must_fix_caught: number;
    runs_with_findings_data: number;
  };
}

export function summarizeRuns(root: string): EstateSummary {
  const runsDir = join(root, 'runs');
  const rows: RunSummaryRow[] = [];
  const skipped: string[] = [];
  if (existsSync(runsDir)) {
    for (const id of readdirSync(runsDir).sort()) {
      const pp = join(runsDir, id, 'pipeline.json');
      if (!existsSync(pp)) continue; // v1 script-recorded runs have no pipeline
      try {
        const p = migratePipeline(readJson<Pipeline>(pp));
        const attempts = p.stages.flatMap((s) => s.attempts ?? []);
        const reviews = attempts.filter((a) => a.review !== undefined);
        const reviewAttempts = p.stages
          .filter((s) => s.name === 'review')
          .flatMap((s) => s.attempts ?? []);
        // Findings are machine-readable for any v2 pipeline — a v2 run with no
        // reviews yet is an honest 0, only true legacy records are n/a.
        const findingsTracked = (p.schema_version ?? 1) >= 2 && !legacyMigrated(p, reviews.length);
        // A finding that survives a fix cycle appears in several rounds —
        // count unique defects, not sightings.
        const uniqueMustFix = new Set(
          reviews.flatMap((a) => (a.review?.must_fix ?? []).map((f) => `${f.file ?? '?'}::${f.issue}`)),
        );
        rows.push({
          run_id: p.run_id,
          template: p.template,
          state: p.current_stage >= p.stages.length ? 'completed' : 'active',
          cost_usd: attempts.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
          review_rounds: Math.max(p.review_round ?? 0, reviewAttempts.length),
          must_fix_caught: findingsTracked ? uniqueMustFix.size : null,
        });
      } catch {
        skipped.push(id); // one bad pipeline.json must not take down the estate report
      }
    }
  }
  const totals = {
    runs: rows.length,
    completed: rows.filter((r) => r.state === 'completed').length,
    active: rows.filter((r) => r.state === 'active').length,
    cost_usd: rows.reduce((s, r) => s + r.cost_usd, 0),
    review_rounds: rows.reduce((s, r) => s + r.review_rounds, 0),
    must_fix_caught: rows.reduce((s, r) => s + (r.must_fix_caught ?? 0), 0),
    runs_with_findings_data: rows.filter((r) => r.must_fix_caught !== null).length,
  };
  return { rows, skipped, totals };
}

/** True when this pipeline was migrated from v1 in memory — its attempts carry
 * no review findings even though schema_version now reads 2. */
function legacyMigrated(p: Pipeline, reviewsWithFindings: number): boolean {
  if (reviewsWithFindings > 0) return false;
  // migrated v1 runs have attempts synthesized WITHOUT review payloads on
  // review stages that did run
  return p.stages.some((s) => s.name === 'review' && (s.attempts?.length ?? 0) > 0 && s.attempts!.every((a) => a.review === undefined));
}

export function renderEstateSummary(s: EstateSummary): string {
  const lines = [
    '# Harness estate report — all runs',
    '',
    '| run | template | state | cost USD | review rounds | must-fix caught |',
    '|---|---|---|---:|---:|---:|',
    ...s.rows.map(
      (r) =>
        `| ${r.run_id} | ${r.template} | ${r.state} | ${r.cost_usd.toFixed(4)} | ${r.review_rounds} | ${
          r.must_fix_caught === null ? 'n/a (pre-v2.1)' : r.must_fix_caught
        } |`,
    ),
    `| **${s.totals.runs} runs** | | ${s.totals.completed} done / ${s.totals.active} active | **${s.totals.cost_usd.toFixed(2)}** | **${s.totals.review_rounds}** | **${s.totals.must_fix_caught}** |`,
    '',
  ];
  if (s.rows.some((r) => r.must_fix_caught === null)) {
    lines.push(
      'Pre-v2.1 rows are FLOORS: their pipelines overwrote re-run rounds, so cost and round',
      'totals under-count them (true numbers live in each run\'s commands.jsonl).',
      '',
    );
  }
  if (s.skipped.length) {
    lines.push(`Skipped ${s.skipped.length} unreadable pipeline.json run(s): ${s.skipped.join(', ')}`, '');
  }
  if (s.totals.must_fix_caught > 0) {
    lines.push(
      `Cost per must-fix caught: $${(s.totals.cost_usd / s.totals.must_fix_caught).toFixed(2)} ` +
        `(across the ${s.totals.runs_with_findings_data} run(s) with machine-readable findings; ` +
        `pre-v2.1 catches live in their review.md files and are NOT counted here).`,
    );
  } else {
    lines.push(
      `No machine-readable must-fix findings yet (tracked since v2.1) — ` +
        `if this stays at 0 across real runs, lower the insurance level and say so.`,
    );
  }
  return lines.join('\n');
}
