import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderEstateSummary, summarizeRuns } from '../src/summary.js';
import { writeJsonAtomic } from '../src/fsx.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-summary-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRun(id: string, pipeline: Record<string, unknown>): void {
  const dir = join(root, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, 'pipeline.json'), { run_id: id, ...pipeline });
}

describe('harness report --all (estate catch-rate)', () => {
  it('aggregates v2 runs and reports pre-v2.1 finding counts as n/a, never zero', () => {
    // v2.1-era run: findings machine-readable
    writeRun('2026-07-12_1617_x', {
      schema_version: 2,
      review_round: 4,
      template: 'feature',
      repo: '/r',
      task: 't',
      current_stage: 6,
      stages: [
        {
          name: 'build',
          status: 'done',
          artifacts: [],
          attempts: [{ status: 'done', agent: 'claude', cost_usd: 1.26 }],
        },
        {
          name: 'review',
          status: 'done',
          artifacts: [],
          attempts: [
            {
              status: 'done',
              agent: 'claude',
              cost_usd: 1.06,
              review: { verdict: 'must_fix', must_fix: [{ file: 'a', issue: 'x' }, { file: 'b', issue: 'y' }], should_fix: [] },
            },
            {
              status: 'done',
              agent: 'claude',
              cost_usd: 1.16,
              review: { verdict: 'approve', must_fix: [], should_fix: [] },
            },
          ],
        },
      ],
    });
    // legacy v1 run parked before review: never reviewed, so 0 caught is HONEST
    writeRun('2026-07-11_1242_plan', {
      template: 'feature',
      repo: '/other',
      task: '/plan',
      current_stage: 0,
      stages: [
        { name: 'grill', status: 'parked', artifacts: [], agent: 'claude', cost_usd: 0.15 },
      ],
    });
    // legacy v1 run whose reviews RAN but recorded no findings (the 1617 shape):
    // catches exist only in review.md prose -> must be n/a, never a fake 0
    writeRun('2026-07-10_1959_legacy', {
      template: 'feature',
      repo: '/r',
      task: 't',
      current_stage: 6,
      stages: [
        { name: 'review', status: 'done', artifacts: [], agent: 'claude', cost_usd: 1.0 },
        { name: 'verify', status: 'done', artifacts: [], agent: 'claude', cost_usd: 0.1 },
      ],
    });
    // one unreadable pipeline must not take the report down
    const bad = join(root, 'runs', 'zz-corrupt');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'pipeline.json'), '{ not json');

    const s = summarizeRuns(root);
    expect(s.totals).toMatchObject({
      runs: 3,
      completed: 2,
      active: 1,
      review_rounds: 4 + 1, // 1959's migrated review attempt counts as a round
      must_fix_caught: 2,
      runs_with_findings_data: 2, // 1617-shape run is n/a; the never-reviewed one is an honest 0
    });
    expect(s.totals.cost_usd).toBeCloseTo(1.26 + 1.06 + 1.16 + 0.15 + 1.1, 5);
    expect(s.skipped).toEqual(['zz-corrupt']);

    const text = renderEstateSummary(s);
    expect(text).toContain('n/a (pre-v2.1)'); // the reviews-ran-findings-lost run
    expect(text).toContain('| 2026-07-11_1242_plan | feature | active | 0.1500 | 0 | 0 |');
    expect(text).toContain('FLOORS');
    expect(text).toContain('Skipped 1 unreadable');
    expect(text).toContain('Cost per must-fix caught');
    // 4.73 / 2 catches
    expect(text).toContain('$2.37');
  });

  it('a finding that survives a fix cycle is one defect, not two (dedupe by file+issue)', () => {
    writeRun('2026-07-12_2000_z', {
      schema_version: 2,
      review_round: 2,
      template: 'feature',
      repo: '/r',
      task: 't',
      current_stage: 5,
      stages: [
        {
          name: 'review',
          status: 'done',
          artifacts: [],
          attempts: [
            { status: 'done', agent: 'claude', cost_usd: 1, review: { verdict: 'must_fix', must_fix: [{ file: 'a.ts', issue: 'off by one' }], should_fix: [] } },
            { status: 'done', agent: 'claude', cost_usd: 1, review: { verdict: 'must_fix', must_fix: [{ file: 'a.ts', issue: 'off by one' }, { file: 'b.ts', issue: 'new bug' }], should_fix: [] } },
          ],
        },
      ],
    });
    const s = summarizeRuns(root);
    expect(s.rows[0]!.must_fix_caught).toBe(2); // 'off by one' seen twice, counted once
  });

  it('zero catches renders the honest lower-the-insurance line', () => {
    writeRun('2026-07-12_1811_y', {
      schema_version: 2,
      review_round: 1,
      template: 'feature',
      repo: '/r',
      task: 't',
      current_stage: 2,
      stages: [
        {
          name: 'review',
          status: 'done',
          artifacts: [],
          attempts: [
            { status: 'done', agent: 'claude', cost_usd: 0.37, review: { verdict: 'approve', must_fix: [], should_fix: [] } },
          ],
        },
        { name: 'verify', status: 'done', artifacts: [], attempts: [] },
      ],
    });
    const text = renderEstateSummary(summarizeRuns(root));
    expect(text).toContain('lower the insurance level');
  });
});
