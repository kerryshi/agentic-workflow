import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine } from '../src/engine.js';
import { readJson } from '../src/fsx.js';
import type { Pipeline, RunRecord } from '../src/types.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-engine-'));
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
    tokens: { input: 100, output: 50 },
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
    private up = true,
  ) {}
  async available(): Promise<boolean> {
    return this.up;
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
const VERIFY_PASS = ok({
  passed: true,
  results: [{ command: 'npm test', passed: true, output_tail: '12 passed' }],
  git_status_clean_of_surprises: true,
});

function engineWith(claude: MockDriver, codex?: MockDriver): Engine {
  return new Engine({
    root,
    drivers: { claude, ...(codex ? { codex } : {}) },
  });
}

async function startFeature(engine: Engine, over: Record<string, unknown> = {}) {
  return engine.start({
    task: 'Add a median helper to the stats module',
    repo,
    template: 'feature',
    builder: 'claude',
    // These tests pin the AGENT verify contract; the native path (default)
    // has its own suite in verify.test.ts.
    agentVerify: true,
    ...over,
  });
}

describe('feature pipeline happy path', () => {
  it('parks at approval, then completes with artifacts and records', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN, BUILD_GREEN, VERIFY_PASS]);
    const codex = new MockDriver('codex', [REVIEW_APPROVE]);
    const engine = engineWith(claude, codex);

    const parked = await startFeature(engine, { reviewer: 'codex' });
    expect(parked.state).toBe('parked');
    const runDir = join(root, 'runs', parked.runId);
    expect(existsSync(join(runDir, 'PARKED.md'))).toBe(true);
    expect(readFileSync(join(runDir, 'plan.md'), 'utf8')).toContain('Add median()');

    const done = await engine.resume(parked.runId, { approve: true });
    expect(done.state).toBe('completed');
    expect(existsSync(join(runDir, 'PARKED.md'))).toBe(false);
    expect(readFileSync(join(runDir, 'review.md'), 'utf8')).toContain('independent agent (codex)');
    expect(readFileSync(join(runDir, 'evidence.md'), 'utf8')).toContain('12 passed');

    const record = readJson<RunRecord>(join(runDir, 'run.json'));
    expect(record.status).toBe('complete');
    expect(record.files_changed).toEqual(['src/stats.ts']);
    expect(record.evidence_links).toEqual(['evidence.md']);

    // review went to codex, everything else to claude
    expect(codex.briefs.map((b) => b.stage)).toEqual(['review']);
    expect(claude.briefs.map((b) => b.stage)).toEqual(['grill', 'plan', 'build', 'verify']);
    // build brief embeds the plan artifact, not the whole conversation
    const buildBrief = claude.briefs.find((b) => b.stage === 'build')!;
    expect(buildBrief.prompt).toContain('Add median()');
  });

  it("cross-agent reviewer runs on its own default model, not the builder's", async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN, BUILD_GREEN, VERIFY_PASS]);
    const codex = new MockDriver('codex', [REVIEW_APPROVE]);
    const logs: string[] = [];
    const engine = new Engine({ root, drivers: { claude, codex }, log: (m) => logs.push(m) });

    const parked = await startFeature(engine, { reviewer: 'codex', model: 'sonnet' });
    const done = await engine.resume(parked.runId, { approve: true });
    expect(done.state).toBe('completed');

    // builder stages carry the requested model...
    expect(claude.opts.map((o) => o.model)).toEqual(['sonnet', 'sonnet', 'sonnet', 'sonnet']);
    // ...but `codex exec -m sonnet` would exit 1, so the reviewer gets null
    expect(codex.opts.map((o) => o.model)).toEqual([null]);
    // the drop is announced, never silent
    expect(logs.some((m) => m.includes("--model 'sonnet' targets the builder"))).toBe(true);
    // and the PERSISTED record is honest too — stage.model must match what ran
    const pipeline = readJson<Pipeline>(join(root, 'runs', parked.runId, 'pipeline.json'));
    const byName = Object.fromEntries(pipeline.stages.map((s) => [s.name, s.model]));
    expect(byName['review']).toBeNull();
    expect(byName['build']).toBe('sonnet');
  });

  it('resume without --approve stays parked at the gate', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const still = await engine.resume(parked.runId, {});
    expect(still.state).toBe('parked');
    expect(still.message).toContain('--approve');
  });
});

describe('grill park/answer loop', () => {
  it('parks with questions.md, refuses unchanged file, resumes after answers', async () => {
    const claude = new MockDriver('claude', [
      ok({ ambiguous: true, questions: ['Which stats module?', 'Rounding behavior?'] }),
      PLAN,
      BUILD_GREEN,
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    expect(parked.state).toBe('parked');
    expect(parked.message).toContain('questions.md');
    const questionsPath = join(root, 'runs', parked.runId, 'questions.md');
    expect(readFileSync(questionsPath, 'utf8')).toContain('Which stats module?');

    const refused = await engine.resume(parked.runId, {});
    expect(refused.state).toBe('parked');
    expect(refused.message).toContain('no added answers');

    appendFileSync(questionsPath, '\nA1: src/stats.ts\nA2: no rounding\n');
    const next = await engine.resume(parked.runId, { approve: true }); // approves the later plan gate too? no — approve applies at approval park only
    // grill answers consumed; run proceeds to the approval gate and parks there
    expect(next.state).toBe('parked');
    expect(next.message).toContain('--approve');

    const pipeline = readJson<Pipeline>(join(root, 'runs', parked.runId, 'pipeline.json'));
    expect(pipeline.answers).toContain('A1: src/stats.ts');
    // the plan brief carried the answers
    const planBrief = claude.briefs.find((b) => b.stage === 'plan')!;
    expect(planBrief.prompt).toContain('CLARIFICATIONS FROM KERRY');
    expect(planBrief.prompt).toContain('A1: src/stats.ts');
  });
});

describe('review must-fix cycle', () => {
  it('inserts one fix build + re-review, then completes', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      ok({
        verdict: 'must_fix',
        must_fix: [{ file: 'src/stats.ts', issue: 'even-length median off by one' }],
        should_fix: [],
        notes: '',
      }),
      ok({ ...((BUILD_GREEN.parsed as object) ?? {}), summary: 'fixed median' } as never),
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const done = await engine.resume(parked.runId, { approve: true });
    expect(done.state).toBe('completed');

    const pipeline = readJson<Pipeline>(join(root, 'runs', parked.runId, 'pipeline.json'));
    const names = pipeline.stages.map((s) => (s.variant ? `${s.name}:fix` : s.name));
    expect(names).toEqual(['grill', 'plan', 'approval', 'build', 'review', 'build:fix', 'review', 'verify']);
    expect(pipeline.fix_cycles).toBe(1);
    // the fix build got the findings
    const fixBrief = claude.briefs.filter((b) => b.stage === 'build')[1]!;
    expect(fixBrief.prompt).toContain('even-length median off by one');
  });

  it('parks when must-fix persists after the one fix cycle', async () => {
    const mustFix = ok({
      verdict: 'must_fix',
      must_fix: [{ file: 'src/stats.ts', issue: 'still wrong' }],
      should_fix: [],
      notes: '',
    });
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      mustFix,
      BUILD_GREEN,
      mustFix,
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('must-fix findings after one automated fix cycle');
  });
});

describe('honest failure handling', () => {
  it('build admitting failing tests parks the run', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      ok({
        summary: 'tried',
        files_changed: [],
        commands_run: ['npm test'],
        tests_passed: false,
        test_output_tail: '2 failed',
      }),
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('failing validation');
    expect(
      readFileSync(join(root, 'runs', parked.runId, 'build-failure.md'), 'utf8'),
    ).toContain('2 failed');
  });

  it('verify failure parks with evidence preserved', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      REVIEW_APPROVE,
      ok({
        passed: false,
        results: [{ command: 'npm test', passed: false, output_tail: '1 failed' }],
        git_status_clean_of_surprises: true,
      }),
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine, { reviewer: 'claude' });
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    const evidence = readFileSync(join(root, 'runs', parked.runId, 'evidence.md'), 'utf8');
    expect(evidence).toContain('FAIL');
    expect(evidence).toContain('1 failed');
  });

  it('agent process failure parks with raw output preserved', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      {
        ok: false,
        resultText: '',
        tokens: { input: 0, output: 0 },
        cost_usd: 0,
        duration_ms: 0,
        num_turns: 0,
        raw: 'boom: out of cheese',
        error: 'claude exited 1',
      },
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('harness case new');
    expect(
      readFileSync(join(root, 'runs', parked.runId, 'stage-build-raw.txt'), 'utf8'),
    ).toContain('out of cheese');
  });

  it('output-contract violation parks the stage', async () => {
    const claude = new MockDriver('claude', [
      {
        ok: true,
        resultText: 'I think this task is fine, no JSON for you',
        tokens: { input: 1, output: 1 },
        cost_usd: 0,
        duration_ms: 1,
        num_turns: 1,
      },
    ]);
    const engine = engineWith(claude);
    const outcome = await startFeature(engine);
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('output contract violated');
  });
});

describe('crash recovery and reviewer fallback', () => {
  it('a stage stuck in running is re-run on resume', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);

    // simulate a crash mid-build after approval
    const runDir = join(root, 'runs', parked.runId);
    const pipeline = readJson<Pipeline>(join(runDir, 'pipeline.json'));
    pipeline.stages[2]!.status = 'done'; // approval
    pipeline.current_stage = 3;
    pipeline.stages[3]!.status = 'running';
    const { writeJsonAtomic } = await import('../src/fsx.js');
    writeJsonAtomic(join(runDir, 'pipeline.json'), pipeline);

    const claude2 = new MockDriver('claude', [BUILD_GREEN, REVIEW_APPROVE, VERIFY_PASS]);
    const engine2 = engineWith(claude2);
    const outcome = await engine2.resume(parked.runId, {});
    expect(outcome.state).toBe('completed');
    expect(claude2.briefs[0]!.stage).toBe('build');
  });

  it('falls back to same-agent review when the other agent is unavailable', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const codexDown = new MockDriver('codex', [], false);
    const engine = engineWith(claude, codexDown);
    const parked = await startFeature(engine); // no explicit reviewer
    const done = await engine.resume(parked.runId, { approve: true });
    expect(done.state).toBe('completed');
    const review = readFileSync(join(root, 'runs', parked.runId, 'review.md'), 'utf8');
    expect(review).toContain('fresh claude process');
    expect(review).toContain('honest fallback');
  });
});

describe('review-2026-07-10 regressions', () => {
  it('must_fix verdict with missing arrays parks instead of crashing (crash-not-park)', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      ok({ verdict: 'must_fix' }), // schema-tolerated, arrays absent
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('no findings');
    expect(existsSync(join(root, 'runs', parked.runId, 'PARKED.md'))).toBe(true);
  });

  it('review-only template parks on must_fix — no ungated fix build', async () => {
    const claude = new MockDriver('claude', [
      ok({
        verdict: 'must_fix',
        must_fix: [{ file: 'a.ts', issue: 'broken' }],
        should_fix: [],
        notes: '',
      }),
    ]);
    const engine = engineWith(claude);
    const outcome = await engine.start({
      task: 'review the current diff',
      repo,
      template: 'review',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('no approved plan');
    const pipeline = readJson<Pipeline>(
      join(root, 'runs', outcome.runId, 'pipeline.json'),
    );
    expect(pipeline.stages.map((s) => s.name)).toEqual(['review']); // nothing inserted
    expect(claude.briefs.map((b) => b.stage)).toEqual(['review']); // builder never driven
  });

  it('verify PASS with zero results is rejected as vacuous evidence', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      REVIEW_APPROVE,
      ok({ passed: true, results: [], git_status_clean_of_surprises: true }),
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine, { reviewer: 'claude' });
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('without command output evidence');
  });

  it('verify PASS with an empty output_tail is rejected too', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      REVIEW_APPROVE,
      ok({
        passed: true,
        results: [{ command: 'npm test', passed: true, output_tail: '   ' }],
        git_status_clean_of_surprises: true,
      }),
    ]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine, { reviewer: 'claude' });
    const outcome = await engine.resume(parked.runId, { approve: true });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('without command output evidence');
  });

  it('refactor fix cycle re-verifies the final state (no stale evidence)', async () => {
    const claude = new MockDriver('claude', [
      PLAN,
      BUILD_GREEN,
      VERIFY_PASS,
      ok({
        verdict: 'must_fix',
        must_fix: [{ file: 'a.ts', issue: 'behavior changed' }],
        should_fix: [],
        notes: '',
      }),
      BUILD_GREEN,
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const engine = engineWith(claude);
    const parked = await engine.start({
      task: 'refactor the stats module',
      repo,
      template: 'refactor',
      builder: 'claude',
      reviewer: 'claude',
      agentVerify: true,
    });
    const done = await engine.resume(parked.runId, { approve: true });
    expect(done.state).toBe('completed');
    const pipeline = readJson<Pipeline>(join(root, 'runs', parked.runId, 'pipeline.json'));
    const names = pipeline.stages.map((s) => (s.variant ? `${s.name}:fix` : s.name));
    expect(names).toEqual([
      'plan', 'approval', 'build', 'verify', 'review', 'build:fix', 'review', 'verify',
    ]);
    // final driven stage was the re-verify
    expect(claude.briefs.at(-1)!.stage).toBe('verify');
  });

  it('--skip approval is refused', async () => {
    const engine = engineWith(new MockDriver('claude', []));
    await expect(
      engine.start({ task: 'add a thing', repo, template: 'feature', skipStages: ['approval'] }),
    ).rejects.toThrow(/approval gate cannot be skipped/);
  });

  it('skipped stages are recorded as skipped, not erased', async () => {
    const claude = new MockDriver('claude', [PLAN]);
    const engine = engineWith(claude);
    const parked = await engine.start({
      task: 'add a thing',
      repo,
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
      skipStages: ['grill'],
    });
    const pipeline = readJson<Pipeline>(join(root, 'runs', parked.runId, 'pipeline.json'));
    expect(pipeline.stages[0]).toMatchObject({ name: 'grill', status: 'skipped' });
    expect(claude.briefs.map((b) => b.stage)).toEqual(['plan']);
  });

  it('an exception inside a stage parks the run instead of crashing it', async () => {
    class ThrowingDriver extends MockDriver {
      override async run(): Promise<never> {
        throw new Error('driver exploded');
      }
    }
    const engine = engineWith(new ThrowingDriver('claude', []));
    const outcome = await engine.start({
      task: 'add a thing',
      repo,
      template: 'review',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('parked, not crashed');
    const runDir = join(root, 'runs', outcome.runId);
    expect(existsSync(join(runDir, 'PARKED.md'))).toBe(true);
    const pipeline = readJson<Pipeline>(join(runDir, 'pipeline.json'));
    expect(pipeline.stages[0]!.status).toBe('failed'); // never stranded as 'running'
  });
});

describe('plan artifact rendering', () => {
  it('does not duplicate a validation section the agent already wrote', async () => {
    const planWithSection = ok({
      plan_markdown: '## Goal\nFix it\n\n## Validation commands\n- npm test',
      validation_commands: ['npm test'],
      files: [],
    });
    const claude = new MockDriver('claude', [GRILL_CLEAR, planWithSection]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const plan = readFileSync(join(root, 'runs', parked.runId, 'plan.md'), 'utf8');
    expect(plan.match(/validation commands/gi)).toHaveLength(1);
  });

  it('appends a validation section when the agent omitted it', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN]);
    const engine = engineWith(claude);
    const parked = await startFeature(engine);
    const plan = readFileSync(join(root, 'runs', parked.runId, 'plan.md'), 'utf8');
    expect(plan).toContain('## Validation commands');
    expect(plan).toContain('- npm test');
  });
});

describe('templates and dry-run', () => {
  it('review template runs a single stage and completes', async () => {
    const claude = new MockDriver('claude', [REVIEW_APPROVE]);
    const engine = engineWith(claude);
    const outcome = await engine.start({
      task: 'review the current diff',
      repo,
      template: 'review',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(outcome.state).toBe('completed');
  });

  it('dry-run prints briefs without creating a run', async () => {
    const engine = engineWith(new MockDriver('claude', []));
    const text = engine.dryRun({ task: 'fix the failing median test', repo });
    expect(text).toContain('template: bugfix');
    expect(text).toContain('STAGE repro');
    expect(text).toContain('human gate');
    expect(existsSync(join(root, 'runs'))).toBe(false);
  });
});
