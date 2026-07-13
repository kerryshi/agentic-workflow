import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { Engine } from '../src/engine.js';
import { interactiveLoop, type InteractiveIo } from '../src/interactive.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-interactive-'));
  repo = join(root, 'target-repo');
  mkdirSync(repo, { recursive: true }); // native verify runs real commands with cwd=repo
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
const GRILL_ASKS = ok({ ambiguous: true, questions: ['Which module?'] });
const PLAN = ok({
  plan_markdown: '## Goal\nAdd median()',
  validation_commands: [`node -e "console.log('ok')"`],
  files: [],
});
const BUILD_GREEN = ok({
  summary: 'added median()',
  files_changed: [],
  commands_run: [],
  tests_passed: true,
  test_output_tail: '12 passed',
});
const REVIEW_APPROVE = ok({ verdict: 'approve', must_fix: [], should_fix: [], notes: 'clean' });

/** Scripted terminal: each entry answers one ask(); before() runs first (simulates edits). */
function scriptedIo(steps: { answer: string; before?: () => void }[]) {
  const said: string[] = [];
  const io: InteractiveIo = {
    say: (l) => said.push(l),
    ask: async (prompt) => {
      const step = steps.shift();
      if (!step) throw new Error(`unexpected extra prompt: ${prompt}`);
      step.before?.();
      return step.answer;
    },
  };
  return { io, said, remaining: () => steps.length };
}

async function startFeature(engine: Engine, task = 'Add a median helper to the stats module') {
  return engine.start({ task, repo, template: 'feature', builder: 'claude', reviewer: 'claude' });
}

describe('interactive gate mode', () => {
  it('drives grill questions + plan approval to completion in one process', async () => {
    const engine = new Engine({
      root,
      drivers: {
        claude: new MockDriver('claude', [GRILL_ASKS, PLAN, BUILD_GREEN, REVIEW_APPROVE]),
      },
    });
    const first = await startFeature(engine);
    expect(first.state).toBe('parked'); // grill questions

    let questionsPath = '';
    const { io, said, remaining } = scriptedIo([
      {
        answer: '', // Enter after "editing" questions.md
        before: () => appendFileSync(questionsPath, '\nA: the stats module\n'),
      },
      { answer: 'y' }, // approve the plan
    ]);
    questionsPath = join(root, 'runs', first.runId, 'questions.md');

    const outcome = await interactiveLoop(engine, first, io);
    expect(outcome.state).toBe('completed');
    expect(remaining()).toBe(0);
    expect(said.join('\n')).toContain('questions.md');
    expect(said.join('\n')).toContain('plan.md');
  });

  it('re-prompts politely when Enter is hit without answering the questions', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_ASKS, PLAN]) },
    });
    const first = await startFeature(engine);
    let questionsPath = '';
    const { io } = scriptedIo([
      { answer: '' }, // forgot to edit — resume refuses, loop must re-prompt
      {
        answer: '',
        before: () => appendFileSync(questionsPath, '\nA: answered now\n'),
      },
      { answer: 'q' }, // leave parked at the approval gate
    ]);
    questionsPath = join(root, 'runs', first.runId, 'questions.md');

    const outcome = await interactiveLoop(engine, first, io);
    expect(outcome.state).toBe('parked');
    expect(outcome.message).toContain('--approve');
  });

  it('a stray Enter at the approval gate re-prompts instead of silently quitting', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN, BUILD_GREEN, REVIEW_APPROVE]) },
    });
    const first = await startFeature(engine);
    const { io, said } = scriptedIo([
      { answer: '' }, // reflex Enter — must NOT end the session
      { answer: 'y' },
    ]);
    const outcome = await interactiveLoop(engine, first, io);
    expect(outcome.state).toBe('completed');
    expect(said.some((l) => l.includes('type y to approve'))).toBe(true);
  });

  it('q at the approval gate leaves a normally-parked, resumable run', async () => {
    const engine = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [GRILL_CLEAR, PLAN]) },
    });
    const first = await startFeature(engine);
    const { io, said } = scriptedIo([{ answer: 'q' }]);
    const outcome = await interactiveLoop(engine, first, io);
    expect(outcome.state).toBe('parked');
    expect(said.join('\n')).toContain(`harness resume ${first.runId} --approve`);
    // park-to-disk unchanged underneath: a later non-interactive resume works
    const engine2 = new Engine({
      root,
      drivers: { claude: new MockDriver('claude', [BUILD_GREEN, REVIEW_APPROVE]) },
    });
    const done = await engine2.resume(first.runId, { approve: true });
    expect(done.state).toBe('completed');
  });

  it('a mid-pipeline park (must-fix persists) prompts intervene-then-Enter', async () => {
    const mustFix = ok({
      verdict: 'must_fix',
      must_fix: [{ file: 'a.ts', issue: 'still wrong' }],
      should_fix: [],
      notes: '',
    });
    const engine = new Engine({
      root,
      drivers: {
        claude: new MockDriver('claude', [
          GRILL_CLEAR,
          PLAN,
          BUILD_GREEN,
          mustFix,
          BUILD_GREEN,
          mustFix, // parks: must-fix after one fix cycle
          REVIEW_APPROVE, // after "intervention", re-review approves
        ]),
      },
    });
    const first = await startFeature(engine);
    const { io } = scriptedIo([
      { answer: 'y' }, // approve plan
      { answer: '' }, // intervene + Enter at the must-fix park
    ]);
    const outcome = await interactiveLoop(engine, first, io);
    expect(outcome.state).toBe('completed');
  });
});
