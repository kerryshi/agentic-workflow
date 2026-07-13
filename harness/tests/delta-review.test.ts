import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { capDiff, snapshotDiff } from '../src/diff.js';
import { Engine } from '../src/engine.js';

let root: string;
let repo: string;

function gitq(args: string[]): void {
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    stdio: 'ignore',
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-delta-'));
  repo = join(root, 'target-repo');
  mkdirSync(repo, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('snapshotDiff', () => {
  it('captures modified AND untracked files without touching the real index', async () => {
    gitq(['init', '-q']);
    writeFileSync(join(repo, 'a.ts'), 'original\n');
    gitq(['add', 'a.ts']);
    gitq(['commit', '-qm', 'base']);
    writeFileSync(join(repo, 'a.ts'), 'changed\n');
    writeFileSync(join(repo, 'brand-new.ts'), 'untracked content\n');

    const diff = (await snapshotDiff(repo))!;
    expect(diff).toContain('a.ts');
    expect(diff).toContain('+changed');
    expect(diff).toContain('brand-new.ts'); // the R14 class: untracked must appear
    expect(diff).toContain('+untracked content');
    // the real index was never touched — brand-new.ts stays untracked
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(status).toContain('?? brand-new.ts');
  });

  it('returns undefined outside a git repo', async () => {
    expect(await snapshotDiff(repo)).toBeUndefined();
  });
});

describe('capDiff', () => {
  it('keeps whole files up to the budget and names what it dropped', () => {
    const file = (name: string, body: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n${body}\n`;
    const diff = file('small.ts', '+x') + file('big.ts', `+${'y'.repeat(500)}`);
    const capped = capDiff(diff, 120);
    expect(capped).toContain('small.ts');
    expect(capped).toContain('[diff truncated');
    expect(capped).toContain('big.ts');
    expect(capped).not.toContain('yyyyyyyy');
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
const PLAN = ok({
  plan_markdown: '## Goal\nAdd median()',
  validation_commands: [`node -e "console.log('ok')"`],
  files: [],
});
const BUILD_GREEN = ok({
  summary: 'added median()',
  files_changed: ['tracked.ts'],
  commands_run: ['npm test'],
  tests_passed: true,
  test_output_tail: '12 passed',
});
const MUST_FIX = ok({
  verdict: 'must_fix',
  must_fix: [{ file: 'tracked.ts', issue: 'even-length median off by one' }],
  should_fix: [],
  notes: '',
});
const REVIEW_APPROVE = ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' });

function repoWithChanges(): void {
  gitq(['init', '-q']);
  writeFileSync(join(repo, 'tracked.ts'), 'original\n');
  gitq(['add', 'tracked.ts']);
  gitq(['commit', '-qm', 'base']);
  writeFileSync(join(repo, 'tracked.ts'), 'built output\n');
}

async function runFixCycle(over: Record<string, unknown> = {}) {
  repoWithChanges();
  const claude = new MockDriver('claude', [
    GRILL_CLEAR,
    PLAN,
    BUILD_GREEN,
    MUST_FIX, // review round 1 -> fix cycle
    BUILD_GREEN, // fix build
    REVIEW_APPROVE, // review round 2
  ]);
  const engine = new Engine({ root, drivers: { claude } });
  const gate = await engine.start({
    task: 'Add a median helper',
    repo,
    template: 'feature',
    builder: 'claude',
    reviewer: 'claude',
    ...over,
  });
  const outcome = await engine.resume(gate.runId, { approve: true });
  return { claude, outcome, runId: gate.runId };
}

describe('review diffs and delta re-reviews', () => {
  it('round 1 gets the harness-captured diff inline; the re-review is a scoped delta', async () => {
    const { claude, outcome, runId } = await runFixCycle();
    expect(outcome.state).toBe('completed');

    const reviews = claude.briefs.filter((b) => b.stage === 'review');
    expect(reviews).toHaveLength(2);
    // round 1: full review, diff inlined, no delta framing
    expect(reviews[0]!.prompt).toContain('CURRENT DIFF');
    expect(reviews[0]!.prompt).toContain('built output');
    expect(reviews[0]!.prompt).not.toContain('RE-REVIEW');
    // round 2: delta — prior findings + both diffs, scoped instructions
    expect(reviews[1]!.prompt).toContain('RE-REVIEW');
    expect(reviews[1]!.prompt).toContain('even-length median off by one');
    expect(reviews[1]!.prompt).toContain('PRIOR DIFF');
    expect(reviews[1]!.prompt).toContain('Do NOT re-litigate');

    // both rounds' trees are preserved as artifacts
    const runDir = join(root, 'runs', runId);
    expect(existsSync(join(runDir, 'review-1.diff'))).toBe(true);
    expect(existsSync(join(runDir, 'review-2.diff'))).toBe(true);
  });

  it('--full-rereview keeps every round full', async () => {
    const { claude } = await runFixCycle({ fullRereview: true });
    const reviews = claude.briefs.filter((b) => b.stage === 'review');
    expect(reviews[1]!.prompt).not.toContain('RE-REVIEW');
    expect(reviews[1]!.prompt).toContain('DO NOT fix anything');
  });

  it('risk=high forces full reviews regardless', async () => {
    const { claude } = await runFixCycle({ riskLevel: 'high' });
    const reviews = claude.briefs.filter((b) => b.stage === 'review');
    expect(reviews[1]!.prompt).not.toContain('RE-REVIEW');
  });

  it('a non-git repo degrades gracefully: reviewer is told to derive the diff itself', async () => {
    const claude = new MockDriver('claude', [GRILL_CLEAR, PLAN, BUILD_GREEN, REVIEW_APPROVE]);
    const engine = new Engine({ root, drivers: { claude } });
    const gate = await engine.start({
      task: 'Add a median helper',
      repo, // never git-initialized
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
    });
    const outcome = await engine.resume(gate.runId, { approve: true });
    expect(outcome.state).toBe('completed');
    const review = claude.briefs.find((b) => b.stage === 'review')!;
    expect(review.prompt).toContain('No harness diff was captured');
  });
});
