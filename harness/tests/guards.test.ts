import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine } from '../src/engine.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-guards-'));
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
  constructor(
    readonly id: 'claude',
    private script: StageResult[],
  ) {}
  async available(): Promise<boolean> {
    return true;
  }
  async run(_brief: StageBrief, _opts?: DriveOpts): Promise<StageResult> {
    const next = this.script.shift();
    if (!next) throw new Error('mock ran out of scripted results');
    return next;
  }
}

const GRILL_CLEAR = ok({ ambiguous: false, questions: [] });
const PLAN = ok({
  plan_markdown: '## Goal\nAdd median()',
  validation_commands: ['npm test'],
  files: [],
});

const TASK = 'Add a handoff briefing to the call agent';

async function parkAtApproval(engine: Engine, task = TASK) {
  return engine.start({ task, repo, template: 'feature', builder: 'claude', reviewer: 'claude' });
}

describe('pre-spend task validation (desktop field finding, 2026-07-11)', () => {
  it.each(['/plan', '/ship now please', 'fix', 'fix bug'])(
    'rejects non-task %j before any record or agent spend',
    async (task) => {
      const engine = new Engine({ root, drivers: { claude: new MockDriver('claude', []) } });
      await expect(
        engine.start({ task, repo, template: 'feature', builder: 'claude' }),
      ).rejects.toThrow(/slash command|too short/);
      // pre-spend: no run record was created
      expect(existsSync(join(root, 'runs'))).toBe(false);
    },
  );

  it('accepts a real one-sentence task', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    const outcome = await parkAtApproval(engine);
    expect(outcome.state).toBe('parked'); // approval gate — normal flow
  });
});

describe('duplicate-run guard (desktop field finding, 2026-07-11)', () => {
  it('refuses a twin of an active run and points at resume; --force-new overrides', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    const first = await parkAtApproval(engine);
    expect(first.state).toBe('parked');

    const engine2 = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    await expect(parkAtApproval(engine2)).rejects.toThrow(
      new RegExp(`harness resume ${first.runId}`),
    );

    const engine3 = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    const forced = await engine3.start({
      task: TASK,
      repo,
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
      forceNew: true,
    });
    expect(forced.state).toBe('parked');
    expect(forced.runId).not.toBe(first.runId);
  });

  it('a different task on the same repo proceeds with a shared-working-tree warning', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    await parkAtApproval(engine);

    const logs: string[] = [];
    const engine2 = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
      log: (m) => logs.push(m),
    });
    const second = await engine2.start({
      task: 'Rewrite the ticket printer output format',
      repo,
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(second.state).toBe('parked');
    expect(logs.some((m) => m.includes('also active on this repo'))).toBe(true);
  });

  it('completed runs never block a new start', async () => {
    const engine = new Engine({
      root,
      drivers: {
        claude: new MockDriver('claude', [
          ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' }),
        ]),
      },
    });
    const done = await engine.start({
      task: 'review the current diff for bugs',
      repo,
      template: 'review',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(done.state).toBe('completed');

    const engine2 = new Engine({
      root,
      drivers: {
        claude: new MockDriver('claude', [
          ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' }),
        ]),
      },
    });
    const again = await engine2.start({
      task: 'review the current diff for bugs',
      repo,
      template: 'review',
      builder: 'claude',
      reviewer: 'claude',
    });
    expect(again.state).toBe('completed');
  });
});
