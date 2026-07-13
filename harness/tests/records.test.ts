import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeRun, createRun, logRunEvent } from '../src/records.js';
import type { RunRecord } from '../src/types.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-records-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NOW = new Date(2026, 6, 10, 20, 15, 30);

function makeRun() {
  return createRun({
    root,
    repo: root, // any dir works; branch resolves to '' outside a repo
    task: 'Add a median() helper',
    template: 'feature',
    builder: 'claude',
    reviewer: 'codex',
    model: null,
    validationPlan: ['npm test'],
    now: NOW,
  });
}

describe('createRun', () => {
  it('writes a schema-3.11 run.json, BOM-less', () => {
    const handle = makeRun();
    const rawBytes = readFileSync(join(handle.runDir, 'run.json'));
    expect(rawBytes[0]).not.toBe(0xef); // no BOM

    const record = JSON.parse(rawBytes.toString('utf8')) as RunRecord;
    expect(record.run_id).toBe('2026-07-10_2015_add-a-median-helper');
    expect(record.status).toBe('in_progress');
    expect(record.completed_at).toBeNull();
    expect(record.agent).toEqual({
      agent_id: 'claude-code',
      agent_role: 'executor',
      surface: 'harness',
      model: null,
      adapter_version: 'v2-harness',
    });
    expect(Array.isArray(record.validation_plan)).toBe(true);
    expect(record.validation_plan).toEqual(['npm test']);
    expect(record.repo).not.toContain('\\');
  });

  it('writes task.md and appends run_started to metrics/runs.jsonl', () => {
    const handle = makeRun();
    const task = readFileSync(join(handle.runDir, 'task.md'), 'utf8');
    expect(task).toContain('## Agent Adapter');
    expect(task).toContain('builder: claude-code');
    expect(task).toContain('reviewer: codex');

    const lines = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(event['type']).toBe('run_started');
    expect(event['run_id']).toBe(handle.runId);
  });
});

describe('completeRun', () => {
  it('stamps completion and appends run_completed', () => {
    const handle = makeRun();
    const record = completeRun(handle, {
      status: 'shipped',
      finalOutcome: 'done',
      reviewerResult: 'no must-fix',
      evidenceLinks: ['evidence.md'],
      now: new Date(2026, 6, 10, 20, 45),
    });
    expect(record.status).toBe('shipped');
    expect(record.completed_at).toMatch(/^2026-07-10T20:45/);

    const onDisk = JSON.parse(
      readFileSync(join(handle.runDir, 'run.json'), 'utf8'),
    ) as RunRecord;
    expect(onDisk.final_outcome).toBe('done');
    expect(onDisk.evidence_links).toEqual(['evidence.md']);

    const lines = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[1]!) as Record<string, unknown>)['type']).toBe('run_completed');
  });
});

describe('review-2026-07-10 regressions', () => {
  it('same-minute same-slug runs get a suffix instead of clobbering', () => {
    const first = makeRun();
    const second = makeRun(); // identical task + timestamp
    expect(second.runId).toBe(`${first.runId}-2`);
    expect(second.runDir).not.toBe(first.runDir);
    const original = JSON.parse(
      readFileSync(join(first.runDir, 'run.json'), 'utf8'),
    ) as RunRecord;
    expect(original.run_id).toBe(first.runId); // untouched
  });

  it('double-complete throws instead of duplicating run_completed events', () => {
    const handle = makeRun();
    completeRun(handle, { status: 'complete' });
    expect(() => completeRun(handle, { status: 'shipped' })).toThrow(/already completed/);
    const events = readFileSync(join(root, 'metrics', 'runs.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { type: string }).type);
    expect(events.filter((t) => t === 'run_completed')).toHaveLength(1);
  });

  it('completeRun merges evidence_links/files_changed instead of replacing', () => {
    const handle = makeRun();
    const path = join(handle.runDir, 'run.json');
    const record = JSON.parse(readFileSync(path, 'utf8')) as RunRecord;
    record.evidence_links = ['earlier-link.md'];
    record.files_changed = ['a.ts'];
    writeFileSync(path, JSON.stringify(record), 'utf8');
    const completed = completeRun(handle, {
      evidenceLinks: ['evidence.md'],
      filesChanged: ['a.ts', 'b.ts'],
    });
    expect(completed.evidence_links).toEqual(['earlier-link.md', 'evidence.md']);
    expect(completed.files_changed).toEqual(['a.ts', 'b.ts']);
  });
});

describe('logRunEvent', () => {
  it('appends to commands.jsonl with a timestamp', () => {
    const handle = makeRun();
    logRunEvent(handle, { event: 'stage_started', stage: 'plan' });
    const line = readFileSync(join(handle.runDir, 'commands.jsonl'), 'utf8').trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed['event']).toBe('stage_started');
    expect(parsed['at']).toMatch(/^\d{4}-/);
  });
});
