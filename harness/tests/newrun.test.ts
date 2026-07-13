import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newRun } from '../src/newrun.js';

/**
 * Regressions carried over from scripts/new_run.ps1 when it was retired (2026-07-13). Each one
 * is a bug that already bit once; a port that drops them re-breaks them, which is exactly what
 * CASE-0018 records happening to the case port.
 */

let root: string;
const base = () => ({ root, objective: 'add a price faq intent', repo: root });

const readRun = (runDir: string) =>
  JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as Record<string, any>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-newrun-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('newRun (Node port of new_run.ps1)', () => {
  it('scaffolds the full record set and logs run_started', () => {
    const { runId, runDir } = newRun({ ...base(), validationPlan: ['npm test'] });

    for (const f of [
      'run.json',
      'task.md',
      'plan.md',
      'evidence.md',
      'review.md',
      'final.md',
      'commands.jsonl',
      'diff.patch',
    ]) {
      expect(existsSync(join(runDir, f)), `${f} missing`).toBe(true);
    }

    const rec = readRun(runDir);
    expect(rec.run_id).toBe(runId);
    expect(rec.status).toBe('in_progress');
    expect(rec.completed_at).toBeNull();

    const events = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8').trim().split('\n');
    expect(JSON.parse(events[0]!)).toMatchObject({ type: 'run_started', run_id: runId });
  });

  it('records an unknown agent honestly as `manual` (CASE-0008)', () => {
    const { runDir } = newRun(base());
    const rec = readRun(runDir);
    expect(rec.agent.agent_id).toBe('manual');
    expect(rec.agent.agent_role).toBe('mixed');
    expect(rec.agent.adapter_version).toBe('v1');
  });

  it('lets a named agent inherit its own surface when none is given (CASE-0008)', () => {
    const { runDir } = newRun({ ...base(), agentId: 'codex', agentRole: 'reviewer' });
    const rec = readRun(runDir);
    expect(rec.agent.agent_id).toBe('codex');
    expect(rec.agent.surface).toBe('codex'); // NOT a hard-coded default
    expect(rec.agent.agent_role).toBe('reviewer');
  });

  it('honours an explicit surface over the inherited one', () => {
    const { runDir } = newRun({ ...base(), agentId: 'codex', agentSurface: 'harness' });
    expect(readRun(runDir).agent.surface).toBe('harness');
  });

  it('never comma-splits a validation command', () => {
    // A real command. Splitting on commas would silently turn this into two broken commands.
    const cmd = 'pytest -k "a,b"';
    const { runDir } = newRun({ ...base(), validationPlan: [cmd, '  ', 'ruff check .'] });
    const rec = readRun(runDir);
    expect(rec.validation_plan).toEqual([cmd, 'ruff check .']); // blank dropped, comma kept
    expect(readFileSync(join(runDir, 'task.md'), 'utf8')).toContain(`- ${cmd}`);
  });

  it('validates BEFORE claiming an id, so a bad call leaves no orphan run directory', () => {
    expect(() => newRun({ root, objective: 'a valid objective', repo: '   ' })).toThrow(/repo/);
    expect(() => newRun({ root, objective: '   ', repo: root })).toThrow(/objective/);
    expect(() => newRun({ ...base(), agentId: '  ' })).toThrow(/agentId/);

    // The original crashed after the claim and left an id-consuming directory behind.
    const runs = join(root, 'runs');
    expect(existsSync(runs) ? readdirSync(runs) : []).toEqual([]);
  });

  it('nulls out empty optional fields rather than writing empty strings', () => {
    const { runDir } = newRun(base());
    const rec = readRun(runDir);
    expect(rec.agent.model).toBeNull();
    expect(rec.worktree).toBeNull();
  });

  it('falls back to `unknown` when the repo has no branch', () => {
    // root is a temp dir, not a git repo — the git probe must fail soft, not throw.
    expect(readRun(newRun(base()).runDir).branch).toBe('unknown');
  });

  it('writes BOM-less JSON (strict parsers choke on a BOM)', () => {
    const { runDir } = newRun(base());
    expect(readFileSync(join(runDir, 'run.json'))[0]).not.toBe(0xef);
  });
});
