import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { summarizeMetrics } from '../src/metrics.js';
import { captureFailure, resolveFailure } from '../src/cases.js';
import { completeRun, createRun } from '../src/records.js';

/**
 * The docs promise the metrics layer reads harness-written records unchanged. This makes that
 * promise executable.
 *
 * It used to shell out to summarize_metrics.ps1 and was therefore `runIf(win32)` — so the Mac
 * never ran it, and the promise went unchecked on half the estate. Since the metrics layer was
 * ported to Node (2026-07-13) the same guarantee is enforced on BOTH platforms. That is the
 * whole point of retiring the PowerShell: one implementation, checked everywhere.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-compat-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('metrics read harness-written records', () => {
  it('counts a harness run, its evidence, and a linked failure case', async () => {
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
    await completeRun(handle, { status: 'complete', evidenceLinks: ['evidence.md'] });

    const { caseId } = await captureFailure({
      root,
      summary: 'a real defect found by the fixture run',
      failureClass: 'tool_error',
      severity: 'must_fix',
      linkedRun: handle.runId,
    });
    await resolveFailure({ root, caseId, regressionTest: 'tests/metrics-compat.test.ts' });

    const s = summarizeMetrics(root);
    expect(s.runs_started).toBe(1);
    expect(s.runs_shipped).toBe(1);
    // Evidence is proven from evidence_links, never inferred from status.
    expect(s.validation_evidence_rate_percent).toBe(100);
    expect(s.failures_total).toBe(1);
    expect(s.failures_resolved).toBe(1);
    expect(s.failures_open).toBe(0);
    expect(s.regressions_added).toBe(1);
    expect(s.must_fix_failures).toBe(1);
    expect(s.failure_classes).toEqual({ tool_error: 1 });
  });
});
