import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../src/adapters/claude.js';
import { createRun } from '../src/records.js';
import { readJson } from '../src/fsx.js';
import type { RunRecord } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-hygiene-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('run.json machine field', () => {
  it('records the machine it actually ran on, not a hardcoded windows', () => {
    // regression: run 1617 executed on the Mac but its run.json said windows
    const handle = createRun({
      root,
      repo: join(root, 'r'),
      task: 't',
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
      model: null,
    });
    const record = readJson<RunRecord>(join(handle.runDir, 'run.json'));
    const expected =
      process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'wsl';
    expect(record.machine).toBe(expected);
  });
});

describe('per-stage budget cap', () => {
  it('passes --max-budget-usd only when a positive budget is set', () => {
    expect(buildClaudeArgs({ budgetUsd: 2.5 })).toContain('--max-budget-usd');
    const args = buildClaudeArgs({ budgetUsd: 2.5 });
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('2.5');
    expect(buildClaudeArgs({})).not.toContain('--max-budget-usd');
    expect(buildClaudeArgs({ budgetUsd: 0 })).not.toContain('--max-budget-usd');
  });
});
