import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine } from '../src/engine.js';
import { readJson } from '../src/fsx.js';
import type { Pipeline } from '../src/types.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-sessions-'));
  repo = join(root, 'target-repo');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function ok(json: unknown, session = 'sess-1'): StageResult {
  return {
    ok: true,
    resultText: JSON.stringify(json),
    parsed: json,
    tokens: { input: 100, output: 50 },
    cost_usd: 0.01,
    duration_ms: 1000,
    num_turns: 3,
    session_id: session,
  };
}

class MockDriver implements AgentDriver {
  briefs: StageBrief[] = [];
  opts: DriveOpts[] = [];
  constructor(
    readonly id: 'claude' | 'codex',
    private script: StageResult[],
    readonly supportsResume: boolean = true,
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
  must_fix: [{ file: 'src/stats.ts', issue: 'off by one' }],
  should_fix: [],
  notes: '',
});
const VERIFY_PASS = ok({
  passed: true,
  results: [{ command: 'npm test', passed: true, output_tail: '12 passed' }],
  git_status_clean_of_surprises: true,
});

async function runFeature(claude: MockDriver): Promise<{ runId: string; pipeline: Pipeline }> {
  const engine = new Engine({ root, drivers: { claude } });
  const gate = await engine.start({
    task: 'Add a median helper',
    repo,
    template: 'feature',
    agentVerify: true, // this suite mocks the verify agent
    builder: 'claude',
    reviewer: 'claude',
  });
  await engine.resume(gate.runId, { approve: true });
  return {
    runId: gate.runId,
    pipeline: readJson<Pipeline>(join(root, 'runs', gate.runId, 'pipeline.json')),
  };
}

describe('builder session continuity', () => {
  it('grill starts the session; plan, build and fix resume it', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      MUST_FIX,
      BUILD_GREEN, // fix build
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const { pipeline } = await runFeature(claude);

    const byStage = new Map(claude.briefs.map((b, i) => [i, { stage: b.stage, opts: claude.opts[i]! }]));
    // grill: nothing to resume yet
    expect(byStage.get(0)).toMatchObject({ stage: 'grill', opts: {} });
    // plan and both builds resume the builder session
    expect(byStage.get(1)).toMatchObject({ stage: 'plan', opts: { resumeSession: 'sess-1' } });
    expect(byStage.get(2)).toMatchObject({ stage: 'build', opts: { resumeSession: 'sess-1' } });
    expect(byStage.get(4)!.stage).toBe('build'); // fix build
    expect(byStage.get(4)!.opts.resumeSession).toBe('sess-1');
    expect(pipeline.builder_session_id).toBe('sess-1');
    // attempts record the resumption honestly
    const build = pipeline.stages.find((s) => s.name === 'build')!;
    expect(build.attempts![0]).toMatchObject({ resumed: true, session_id: 'sess-1' });
  });

  it('FIREWALL: review and verify never receive the builder session', async () => {
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      BUILD_GREEN,
      MUST_FIX,
      BUILD_GREEN,
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    await runFeature(claude);
    for (const [i, brief] of claude.briefs.entries()) {
      if (brief.stage === 'review' || brief.stage === 'verify') {
        expect(claude.opts[i]!.resumeSession, `${brief.stage} must be a fresh context`).toBeUndefined();
      }
    }
    // and the reviewer got fresh contexts even though it is the same agent
    expect(claude.briefs.filter((b) => b.stage === 'review').length).toBeGreaterThan(0);
  });

  it('a driver without resume support never gets a session (codex parity)', async () => {
    const codex = new MockDriver('codex', [GRILL_CLEAR, PLAN, BUILD_GREEN, VERIFY_PASS], false);
    const claude = new MockDriver('claude', [REVIEW_APPROVE]);
    const engine = new Engine({ root, drivers: { claude, codex } });
    const gate = await engine.start({
      task: 'Add a median helper',
      repo,
      template: 'feature',
      agentVerify: true, // these suites mock the verify agent; native path is covered in verify.test.ts
      builder: 'codex',
      reviewer: 'claude',
    });
    await engine.resume(gate.runId, { approve: true });
    for (const o of codex.opts) expect(o.resumeSession).toBeUndefined();
  });

  it('falls back to a fresh context when the session is gone, recording both attempts', async () => {
    const deadResume: StageResult = {
      ok: false,
      resultText: '',
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      duration_ms: 100,
      num_turns: 0,
      raw: 'No conversation found with session ID: sess-1',
      error: 'claude exited 1',
    };
    const claude = new MockDriver('claude', [
      GRILL_CLEAR,
      PLAN,
      deadResume, // build resume attempt dies
      BUILD_GREEN, // fresh retry succeeds
      REVIEW_APPROVE,
      VERIFY_PASS,
    ]);
    const { pipeline } = await runFeature(claude);

    const build = pipeline.stages.find((s) => s.name === 'build')!;
    expect(build.attempts).toHaveLength(2);
    expect(build.attempts![0]).toMatchObject({
      status: 'failed',
      resumed: true,
      error: 'builder session not found on resume',
    });
    expect(build.attempts![1]).toMatchObject({ status: 'done', resumed: false });
    // the fresh retry carried no resumeSession
    const buildCalls = claude.briefs
      .map((b, i) => ({ b, o: claude.opts[i]! }))
      .filter((x) => x.b.stage === 'build');
    expect(buildCalls[0]!.o.resumeSession).toBe('sess-1');
    expect(buildCalls[1]!.o.resumeSession).toBeUndefined();
    // session id re-chained from the fresh build onward
    expect(pipeline.builder_session_id).toBe('sess-1');
  });

  it('a resumed build brief marks the on-disk plan as authoritative', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN, BUILD_GREEN, REVIEW_APPROVE, VERIFY_PASS]);
    await runFeature(claude);
    const buildBrief = claude.briefs.find((b) => b.stage === 'build')!;
    expect(buildBrief.prompt).toContain('APPROVED version');
    expect(buildBrief.prompt).toContain('wins over your memory');
  });
});
