import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from '../src/adapters/proc.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'proc-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('runProcess never rejects', () => {
  it('round-trips stdin through a real child', async () => {
    const out = await runProcess(
      process.execPath,
      ['-e', 'process.stdin.pipe(process.stdout)'],
      dir,
      'ping',
      30_000,
    );
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('ping');
  });

  it('missing binary resolves with spawnError (async ENOENT path)', async () => {
    const out = await runProcess(join(dir, 'nope', 'missing-bin'), [], dir, '', 5_000);
    expect(out.code).toBeNull();
    expect(out.spawnError).toContain('ENOENT');
  });

  it.runIf(process.platform === 'win32')(
    'sync spawn throw (.cmd, CVE-2024-27980 guard) resolves with spawnError — CASE-0016',
    async () => {
      const cmd = join(dir, 'shim.cmd');
      writeFileSync(cmd, '@echo off\r\nexit /b 0\r\n', 'utf8');
      const out = await runProcess(cmd, [], dir, '', 5_000);
      expect(out.code).toBeNull();
      expect(out.spawnError).toContain('EINVAL');
    },
  );

  it(
    'timeout always resolves (kill + grace force-finish) — CASE-0017',
    { timeout: 15_000 },
    async () => {
      const out = await runProcess(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        dir,
        '',
        500,
      );
      expect(out.timedOut).toBe(true);
    },
  );
});
