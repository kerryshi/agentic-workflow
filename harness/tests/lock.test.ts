import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withDirLock } from '../src/lock.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-lock-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('withDirLock (Invoke-WithFileLock analogue)', () => {
  it('serializes contenders: critical sections never interleave', async () => {
    const target = join(root, 'shared');
    const events: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        withDirLock(target, async () => {
          events.push(`enter-${i}`);
          await sleep(10);
          events.push(`exit-${i}`);
        }),
      ),
    );
    // strictly enter/exit pairs — an interleave would show two enters in a row
    for (let i = 0; i < events.length; i += 2) {
      expect(events[i]).toMatch(/^enter-/);
      expect(events[i + 1]).toBe(events[i]!.replace('enter', 'exit'));
    }
  });

  it('breaks a stale lock left by a crashed holder', async () => {
    const target = join(root, 'shared');
    const lockDir = `${target}.lock`;
    mkdirSync(lockDir);
    const old = (Date.now() - 60_000) / 1000;
    utimesSync(lockDir, old, old); // crashed 60s ago
    const result = await withDirLock(target, () => 'ran');
    expect(result).toBe('ran');
  });

  it('propagates body errors and always releases the lock', async () => {
    const target = join(root, 'shared');
    await expect(withDirLock(target, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    // lock released — a second acquisition succeeds immediately
    expect(await withDirLock(target, () => 'again')).toBe('again');
  });
});
