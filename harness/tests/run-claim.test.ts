import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimDir } from '../src/claim.js';

/**
 * A run id must be claimed ATOMICALLY, never check-then-act.
 *
 * `createRun` used to do existsSync(dir) -> pick a suffix -> ensureDir(dir). `ensureDir` is
 * mkdir -p, which succeeds on an existing directory — so two processes starting the same task
 * in the same minute both saw "free", both picked the same id, and the second silently
 * clobbered the first's run.json. `new_run.ps1` never had this bug: it claimed with a
 * NON-recursive mkdir, which throws when the name is taken.
 *
 * This is the CASE-0005 class. CASE-0018 records the Node case-port reintroducing it in
 * captureFailure; it was still live in the run path until 2026-07-13.
 *
 * It is ONLY observable across processes — the claim is synchronous, so Promise.all cannot
 * interleave it, and any in-process test passes both before and after the fix. Hence real
 * child processes.
 */
// A file:// URL, not a path: dynamic import() rejects a bare Windows path like C:\...\claim.ts.
const CLAIM_TS = new URL('../src/claim.ts', import.meta.url).href;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-claim-'));
});

afterEach(() => {
  // Windows can hold a handle for a beat after a child exits, and rmSync's `force` does not
  // retry EPERM — only maxRetries does.
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const WORKERS = 4;
const ROUNDS = 150;

/**
 * One process that claims the SAME sequence of base ids as its siblings, released from a
 * shared barrier so they all hit each id at the same instant.
 *
 * Both weaker designs were tried and BOTH went green against the reconstructed bug, i.e. they
 * proved nothing:
 *   - 8 one-shot processes racing a single id: process startup (~500ms) staggers them far
 *     wider than the ns window between existsSync() and mkdir().
 *   - 4 processes looping 150 ids with no barrier: each finishes its whole loop before the
 *     next one has even finished importing, so they never overlap.
 * The barrier is what actually makes them collide. A regression you never watched fail is not
 * a regression.
 */
function claimRoundsInChildProcess(): Promise<string[]> {
  const script = `
    const { claimDir } = await import(${JSON.stringify(CLAIM_TS)});
    const { mkdirSync, writeFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const runs = ${JSON.stringify(join(root, 'runs'))};
    const gate = ${JSON.stringify(join(root, 'gate'))};

    // Barrier: announce readiness, then WAIT until every sibling is up. Without this the
    // processes never overlap and the race cannot be observed.
    //
    // The wait must YIELD, not hot-spin: a busy loop here pegs one core per worker, starves the
    // other vitest workers, and makes the whole suite flaky — which is the exact contention bug
    // this repo just fixed in vitest.config.ts. Atomics.wait sleeps without burning CPU, and 1ms
    // granularity still releases everyone within the same millisecond, which is more than tight
    // enough to collide them.
    const sab = new Int32Array(new SharedArrayBuffer(4));
    mkdirSync(gate, { recursive: true });
    writeFileSync(join(gate, String(process.pid)), '');
    while (readdirSync(gate).length < ${WORKERS}) { Atomics.wait(sab, 0, 0, 1); }

    const claimed = [];
    for (let r = 0; r < ${ROUNDS}; r++) claimed.push(claimDir(runs, 'race-' + r));
    process.stdout.write(JSON.stringify(claimed));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('close', (code) =>
      code === 0
        ? resolve(JSON.parse(out) as string[])
        : reject(new Error(`child exited ${code}: ${err}`)),
    );
  });
}

describe('atomic id claim', () => {
  it('concurrent PROCESSES never share an id (CASE-0005 class)', async () => {
    const perWorker = await Promise.all(
      Array.from({ length: WORKERS }, () => claimRoundsInChildProcess()),
    );
    const ids = perWorker.flat();
    const expected = WORKERS * ROUNDS;

    // Every claim across every process is unique. Under check-then-act, two processes in the
    // same round both see the base id free and both mkdir -p it: same id, and the second
    // overwrites the first's run.json.
    expect(ids.length).toBe(expected);
    expect(new Set(ids).size).toBe(expected);
    // ...and every claim owns a real directory of its own.
    expect(readdirSync(join(root, 'runs')).length).toBe(expected);
  });

  it('suffixes in order and never reuses a taken id', () => {
    const runs = join(root, 'runs');
    expect(claimDir(runs, 'x')).toBe('x');
    expect(claimDir(runs, 'x')).toBe('x-2');
    expect(claimDir(runs, 'x')).toBe('x-3');
    expect(readdirSync(runs).sort()).toEqual(['x', 'x-2', 'x-3']);
  });

  it('gives up loudly rather than silently reusing an id', () => {
    const runs = join(root, 'runs');
    claimDir(runs, 'y');
    claimDir(runs, 'y', 2); // y-2 taken
    expect(() => claimDir(runs, 'y', 2)).toThrow(/could not allocate a unique id/);
  });
});
