import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine } from '../src/engine.js';
import { readJson } from '../src/fsx.js';
import { nativeVerify, normalizeCommandForBash } from '../src/verify.js';
import type { Pipeline } from '../src/types.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-verify-'));
  repo = join(root, 'target-repo');
  mkdirSync(repo, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NODE_OK = `node -e "console.log('native ok')"`;
const NODE_FAIL = `node -e "console.error('boom'); process.exit(3)"`;

describe('nativeVerify executor', () => {
  it('captures real exit codes and output; all-pass means pass', async () => {
    const res = await nativeVerify(repo, [NODE_OK], []);
    expect(res.passed).toBe(true);
    expect(res.results[0]).toMatchObject({ passed: true, exit_code: 0 });
    expect(res.results[0]!.output_tail).toContain('native ok');
    expect(res.git_status_available).toBe(false); // not a repo — reported, not faked
  });

  it('a failing command fails the verify with its exit code preserved', async () => {
    const res = await nativeVerify(repo, [NODE_OK, NODE_FAIL], []);
    expect(res.passed).toBe(false);
    expect(res.results[1]).toMatchObject({ passed: false, exit_code: 3 });
    expect(res.results[1]!.output_tail).toContain('boom');
  });

  it('zero commands can never pass (vacuous PASS impossible by construction)', async () => {
    const res = await nativeVerify(repo, [], []);
    expect(res.passed).toBe(false);
  });

  // CASE-0022: plans authored on Windows write backslash paths; bash -c strips
  // bare backslashes (.venvScriptspython: command not found, exit 127).
  it('runs a plan-authored backslash path after normalizing it for bash', async () => {
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'probe.cjs'), `console.log('probe ok')`);
    const res = await nativeVerify(repo, ['node scripts\\probe.cjs'], []);
    expect(res.passed).toBe(true);
    expect(res.results[0]!.output_tail).toContain('probe ok');
    expect(res.results[0]!.command).toBe('node scripts\\probe.cjs'); // original preserved
    expect(res.results[0]!.normalized_command).toBe('node scripts/probe.cjs');
  });

  it('normalizes only path-shaped tokens that fully resolve in the repo', () => {
    mkdirSync(join(repo, '.venv', 'Scripts'), { recursive: true });
    writeFileSync(join(repo, '.venv', 'Scripts', 'python.exe'), '');
    expect(normalizeCommandForBash('.venv\\Scripts\\python -m pytest -q', repo)).toBe(
      '.venv/Scripts/python -m pytest -q',
    );
    // regex escapes stay untouched EVEN when the first segment is a real dir:
    // only a fully-resolving path earns a rewrite (reviewer finding, 2026-07-15)
    mkdirSync(join(repo, 'foo'), { recursive: true });
    expect(normalizeCommandForBash('grep -c foo\\.py src', repo)).toBe('grep -c foo\\.py src');
    // quoted tokens are never rewritten
    expect(normalizeCommandForBash(`grep '.venv\\Scripts' notes.md`, repo)).toBe(
      `grep '.venv\\Scripts' notes.md`,
    );
  });

  it('flags working-tree paths the build never reported', async () => {
    execFileSync('git', ['init', '-q', repo]);
    writeFileSync(join(repo, 'reported.ts'), 'x');
    writeFileSync(join(repo, 'sneaky.ts'), 'y');
    const res = await nativeVerify(repo, [NODE_OK], ['reported.ts']);
    expect(res.git_status_available).toBe(true);
    expect(res.surprises).toEqual(['sneaky.ts']);
  });
});

// ---- engine integration -----------------------------------------------------

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
  constructor(
    readonly id: 'claude',
    private script: StageResult[],
  ) {}
  async available(): Promise<boolean> {
    return true;
  }
  async run(brief: StageBrief, _opts?: DriveOpts): Promise<StageResult> {
    this.briefs.push(brief);
    const next = this.script.shift();
    if (!next) throw new Error(`mock ran out of scripted results (stage ${brief.stage})`);
    return next;
  }
}

const GRILL_CLEAR = ok({ ambiguous: false, questions: [] });
const BUILD_GREEN = ok({
  summary: 'added median()',
  files_changed: ['src/stats.ts'],
  commands_run: [NODE_OK],
  tests_passed: true,
  test_output_tail: 'ok',
});
const REVIEW_APPROVE = ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' });

function plan(commands: string[]): StageResult {
  return ok({ plan_markdown: '## Goal\nAdd median()', validation_commands: commands, files: [] });
}

async function runDefaultFeature(commands: string[]) {
  const claude = new MockDriver('claude', [GRILL_CLEAR, plan(commands), BUILD_GREEN, REVIEW_APPROVE]);
  const engine = new Engine({ root, drivers: { claude } });
  const gate = await engine.start({
    task: 'Add a median helper',
    repo,
    template: 'feature',
    builder: 'claude',
    reviewer: 'claude',
  });
  const outcome = await engine.resume(gate.runId, { approve: true });
  return { claude, outcome, runId: gate.runId };
}

describe('native verify is the default verify stage', () => {
  it('runs the plan commands itself: no agent brief, real evidence, zero-cost attempt', async () => {
    const { claude, outcome, runId } = await runDefaultFeature([NODE_OK]);
    expect(outcome.state).toBe('completed');
    // the driver was never asked to verify
    expect(claude.briefs.map((b) => b.stage)).toEqual(['grill', 'plan', 'build', 'review']);

    const evidence = readFileSync(join(root, 'runs', runId, 'evidence.md'), 'utf8');
    expect(evidence).toContain('Native verify');
    expect(evidence).toContain('native ok');
    expect(evidence).toContain('PASS (exit 0)');

    const pipeline = readJson<Pipeline>(join(root, 'runs', runId, 'pipeline.json'));
    const verify = pipeline.stages.find((s) => s.name === 'verify')!;
    expect(verify.attempts![0]).toMatchObject({ status: 'done', agent: 'harness', cost_usd: 0 });
  });

  it('parks on a failing command with the exit code in evidence', async () => {
    const { outcome, runId } = await runDefaultFeature([NODE_FAIL]);
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('verification failed');
    const evidence = readFileSync(join(root, 'runs', runId, 'evidence.md'), 'utf8');
    expect(evidence).toContain('FAIL (exit 3)');
    expect(evidence).toContain('boom');
  });

  it('parks honestly when the plan recorded no validation commands', async () => {
    const { outcome } = await runDefaultFeature([]);
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('no validation commands');
  });

  it('normalizes backslash paths and says so in evidence (CASE-0022)', async () => {
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'probe.cjs'), `console.log('probe ok')`);
    const { outcome, runId } = await runDefaultFeature(['node scripts\\probe.cjs']);
    expect(outcome.state).toBe('completed');
    const evidence = readFileSync(join(root, 'runs', runId, 'evidence.md'), 'utf8');
    expect(evidence).toContain('ran as `node scripts/probe.cjs`');
  });
});
