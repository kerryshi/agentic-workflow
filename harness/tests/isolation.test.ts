import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentDriver, DriveOpts, StageBrief, StageResult } from '../src/adapters/types.js';
import { buildClaudeArgs } from '../src/adapters/claude.js';
import { Engine, readRepoConventions } from '../src/engine.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-isolation-'));
  repo = join(root, 'target-repo');
  mkdirSync(repo, { recursive: true });
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
  ) {}
  async available(): Promise<boolean> {
    return true;
  }
  async run(brief: StageBrief, opts?: DriveOpts): Promise<StageResult> {
    this.briefs.push(brief);
    this.opts.push(opts ?? {});
    const next = this.script.shift();
    if (!next) throw new Error('mock ran out of scripted results');
    return next;
  }
}

describe('buildClaudeArgs isolation and resume flags', () => {
  it('isolates workers by default via --setting-sources "" (never --bare: breaks auth)', () => {
    const args = buildClaudeArgs({});
    const i = args.indexOf('--setting-sources');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('');
    expect(args).not.toContain('--bare');
  });

  it('drops isolation with isolated:false and passes --resume when given', () => {
    const args = buildClaudeArgs({ isolated: false, resumeSession: 'sess-9' });
    expect(args).not.toContain('--setting-sources');
    const r = args.indexOf('--resume');
    expect(args[r + 1]).toBe('sess-9');
  });
});

describe('repo conventions injection', () => {
  it('reads AGENTS.md natively and caps oversized content', () => {
    writeFileSync(join(repo, 'AGENTS.md'), '# Conventions\nUse pytest.');
    expect(readRepoConventions(repo)).toContain('Use pytest.');

    writeFileSync(join(repo, 'CLAUDE.md'), 'x'.repeat(20_000));
    const capped = readRepoConventions(repo)!;
    expect(capped.length).toBeLessThan(9_000);
    expect(capped).toContain('[conventions truncated');
  });

  it('briefs carry REPO CONVENTIONS for isolated runs, and omit them with --no-isolation', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), 'Always run ruff before finishing.');
    const script = () => [
      ok({ ambiguous: false, questions: [] }),
      ok({ plan_markdown: '## Goal', validation_commands: ['npm test'], files: [] }),
    ];

    const isolated = new MockDriver('claude', script());
    await new Engine({ root, drivers: { claude: isolated } }).start({
      task: 'Add a helper',
      repo,
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
    });
    for (const b of isolated.briefs) {
      expect(b.prompt).toContain('REPO CONVENTIONS');
      expect(b.prompt).toContain('Always run ruff before finishing.');
    }
    expect(isolated.opts[0]!.isolated).toBe(true);

    const open = new MockDriver('claude', script());
    await new Engine({ root, drivers: { claude: open } }).start({
      task: 'Add a helper',
      repo,
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
      isolated: false,
      forceNew: true, // same task re-run on purpose — the duplicate guard is right to ask
    });
    // the CLI loads project files itself in non-isolated mode — no duplication
    for (const b of open.briefs) expect(b.prompt).not.toContain('REPO CONVENTIONS');
    expect(open.opts[0]!.isolated).toBe(false);
  });
});
