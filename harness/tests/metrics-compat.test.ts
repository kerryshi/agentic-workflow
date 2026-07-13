import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeRun, createRun } from '../src/records.js';

/**
 * The docs promise: summarize_metrics.ps1 parses harness-written records
 * unchanged. This test makes that promise executable (Windows-only — the
 * v1 scripts are Windows PowerShell).
 */
const SUMMARIZE = resolve(import.meta.dirname, '..', '..', 'scripts', 'summarize_metrics.ps1');

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-metrics-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.runIf(process.platform === 'win32')('summarize_metrics.ps1 cross-check', () => {
  it('counts a harness-written run', () => {
    const handle = createRun({
      root,
      repo: root,
      task: 'cross-check fixture task',
      template: 'feature',
      builder: 'claude',
      reviewer: 'claude',
      model: null,
      validationPlan: ['npm test'],
    });
    completeRun(handle, { status: 'complete', evidenceLinks: ['evidence.md'] });

    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SUMMARIZE, '-Root', root, '-Json'],
      { encoding: 'utf8', timeout: 120_000 },
    );
    const summary = JSON.parse(stdout.replace(/^﻿/, '')) as Record<string, unknown>;
    expect(summary['runs_started']).toBe(1);
    expect(summary['runs_shipped']).toBe(1);
  }, 120_000);
});
