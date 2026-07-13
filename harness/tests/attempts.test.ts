import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine, migratePipeline } from '../src/engine.js';
import { readJson } from '../src/fsx.js';
import { renderReport } from '../src/report.js';
import type { Pipeline } from '../src/types.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-attempts-'));
  repo = join(root, 'target-repo');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ok(json: unknown): StageResult {
  return {
    ok: true,
    resultText: JSON.stringify(json),
    parsed: json,
    tokens: { input: 100, output: 50, cache_read: 1000 },
    cost_usd: 0.01,
    duration_ms: 1000,
    num_turns: 3,
  };
}

class MockDriver implements AgentDriver {
  briefs: StageBrief[] = [];
  opts: DriveOpts[] = [];
  constructor(
    readonly id: 'claude' | 'codex',
    private script: StageResult[],
  ) {}
  async available(): Promise<boolean> {
    return true;
  }
  async run(brief: StageBrief, opts?: DriveOpts): Promise<StageResult> {
    this.briefs.push(brief);
    this.opts.push(opts ?? {});
    const next = this.script.shift();
    if (!next) throw new Error(`mock ${this.id} ran out of scripted results (stage ${brief.stage})`);
    return next;
  }
}

const GRILL_CLEAR = ok({ ambiguous: false, questions: [] });
const PLAN = ok({
  plan_markdown: '## Goal\nAdd median()',
  validation_commands: ['npm test'],
  files: ['src/stats.ts'],
});
const BUILD_GREEN = ok({
  summary: 'added median()',
  files_changed: ['src/stats.ts'],
  commands_run: ['npm test'],
  tests_passed: true,
  test_output_tail: '12 passed',
});
const REVIEW_APPROVE = ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' });
const MUST_FIX = ok({
  verdict: 'must_fix',
  must_fix: [{ file: 'src/stats.ts', issue: 'still wrong' }],
  should_fix: [],
  notes: '',
});
const VERIFY_PASS = ok({
  passed: true,
  results: [{ command: 'npm test', passed: true, output_tail: '12 passed' }],
  git_status_clean_of_surprises: true,
});

describe('append-only attempt records (records-honesty, 2026-07-12)', () => {
  it('a re-run stage keeps every attempt and the report sums them all', async () => {
    // build -> review#1 must_fix -> fix build -> review#2 must_fix -> PARK
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      MUST_FIX,
      BUILD_GREEN,
      MUST_FIX,
    ]);
    const engine = new Engine({ root, drivers: { claude } });
    const gate = await engine.start({
      task: 'Add a median helper',
      repo,
      template: 'feature',
      agentVerify: true, // these suites mock the verify agent; native path is covered in verify.test.ts
      builder: 'claude',
      reviewer: 'claude',
    });
    const parked = await engine.resume(gate.runId, { approve: true });
    expect(parked.state).toBe('parked');

    // Kerry intervenes, resumes: the SAME review stage slot re-runs and approves
    const claude2 = new MockDriver('claude', [REVIEW_APPROVE, VERIFY_PASS]);
    const engine2 = new Engine({ root, drivers: { claude: claude2 } });
    const done = await engine2.resume(gate.runId, {});
    expect(done.state).toBe('completed');

    const pipeline = readJson<Pipeline>(join(root, 'runs', gate.runId, 'pipeline.json'));
    const reviews = pipeline.stages.filter((s) => s.name === 'review');
    expect(reviews).toHaveLength(2);
    // review#2's slot ran twice: the parked must_fix attempt AND the approve re-run
    expect(reviews[1]!.attempts).toHaveLength(2);
    expect(reviews[1]!.attempts![0]).toMatchObject({
      status: 'parked',
      review: { verdict: 'must_fix' },
    });
    expect(reviews[1]!.attempts![1]).toMatchObject({
      status: 'done',
      review: { verdict: 'approve' },
    });
    // every attempt carries its own cost — nothing clobbered
    const attempts = pipeline.stages.flatMap((s) => s.attempts ?? []);
    expect(attempts).toHaveLength(8); // grill plan build review fix review review verify

    const report = renderReport(pipeline);
    // the re-run stage renders one row per attempt...
    expect(report).toContain('review #1');
    expect(report).toContain('review #2');
    // ...and the total is the TRUE total (8 x $0.01), not the latest-row sum
    expect(report).toContain('**0.0800**');
  });

  it('every review round is preserved as review-N.md, review.md stays latest', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      MUST_FIX,
      BUILD_GREEN,
      MUST_FIX,
    ]);
    const engine = new Engine({ root, drivers: { claude } });
    const gate = await engine.start({
      task: 'Add a median helper',
      repo,
      template: 'feature',
      agentVerify: true, // these suites mock the verify agent; native path is covered in verify.test.ts
      builder: 'claude',
      reviewer: 'claude',
    });
    await engine.resume(gate.runId, { approve: true });
    const claude2 = new MockDriver('claude', [REVIEW_APPROVE, VERIFY_PASS]);
    const engine2 = new Engine({ root, drivers: { claude: claude2 } });
    await engine2.resume(gate.runId, {});

    const runDir = join(root, 'runs', gate.runId);
    expect(readFileSync(join(runDir, 'review-1.md'), 'utf8')).toContain('must_fix');
    expect(readFileSync(join(runDir, 'review-2.md'), 'utf8')).toContain('must_fix');
    expect(readFileSync(join(runDir, 'review-3.md'), 'utf8')).toContain('approve');
    expect(readFileSync(join(runDir, 'review.md'), 'utf8')).toContain('round 3');
    expect(existsSync(join(runDir, 'review-4.md'))).toBe(false);
  });

  it('migrates a v1 pipeline: mirror fields become single attempts', () => {
    const v1 = {
      run_id: 'r',
      template: 'feature',
      repo: '/tmp/x',
      task: 't',
      answers: null,
      builder: 'claude',
      reviewer: 'claude',
      model: null,
      skip_permissions: true,
      current_stage: 2,
      validation_commands: [],
      files_changed: [],
      fix_cycles: 0,
      last_must_fix: null,
      stages: [
        {
          name: 'grill',
          status: 'done',
          agent: 'claude',
          tokens: { input: 16, output: 7292, cache_read: 363977 },
          cost_usd: 0.4491,
          duration_ms: 90000,
          num_turns: 14,
          artifacts: [],
        },
        { name: 'approval', status: 'parked', artifacts: [] },
      ],
    } as unknown as Pipeline;

    const migrated = migratePipeline(v1);
    expect(migrated.schema_version).toBe(2);
    expect(migrated.stages[0]!.attempts).toHaveLength(1);
    expect(migrated.stages[0]!.attempts![0]).toMatchObject({
      status: 'done',
      agent: 'claude',
      cost_usd: 0.4491,
    });
    // gate stage never executed — no synthetic attempt invented for it
    expect(migrated.stages[1]!.attempts).toHaveLength(0);
    // idempotent
    expect(migratePipeline(migrated).stages[0]!.attempts).toHaveLength(1);

    const report = renderReport(migrated);
    expect(report).toContain('0.4491');
    expect(report).toContain('363977');
  });
});
