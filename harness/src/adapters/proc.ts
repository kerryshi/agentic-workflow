import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import type { StageResult } from './types.js';

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
/** After a timeout kill, how long to wait for 'close' before force-resolving. */
const KILL_GRACE_MS = 5000;

export interface ProcOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export function runProcess(
  bin: string,
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs: number,
): Promise<ProcOutput> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      // detached on POSIX puts the child in its own process group so a
      // timeout kill can reach grandchildren (the codex npm shim is a node
      // launcher whose native binary inherits our pipes).
      child = spawn(bin, args, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (err) {
      // spawn can throw SYNCHRONOUSLY (e.g. EINVAL for .bat/.cmd since the
      // CVE-2024-27980 guard) — without this, the rejection escapes the
      // never-throw driver contract and can crash `harness run` pre-run
      // (review finding, 2026-07-11, CASE-0016).
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: String(err) });
      return;
    }
    // Collect raw buffers and decode ONCE at the end: per-chunk toString('utf8')
    // corrupts multibyte characters split across chunk boundaries (review
    // finding, 2026-07-10 — this platform's 4th encoding bite).
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const killTree = () => {
      if (process.platform === 'win32' && child.pid) {
        // child.kill only hits the exe, not tools it spawned (bash, node, ...).
        // Absolute path (PATH may be stripped) + error swallow (an unhandled
        // 'error' event on this fire-and-forget spawn would kill the harness).
        const taskkill = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on(
          'error',
          () => {},
        );
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL'); // whole process group (detached above)
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
      // 'close' waits for stdout/stderr EOF, which a surviving grandchild
      // holding our inherited pipes can block forever — force-resolve so a
      // timed-out stage parks instead of stranding as 'running'
      // (review finding, 2026-07-11, CASE-0017).
      setTimeout(() => finish(null), KILL_GRACE_MS).unref();
    }, timeoutMs);

    const finish = (code: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out: ProcOutput = {
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        timedOut,
      };
      if (spawnError !== undefined) out.spawnError = spawnError;
      resolve(out);
    };

    child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));
    child.on('error', (err) => finish(null, String(err)));
    child.on('close', (code) => finish(code));

    child.stdin.on('error', () => {
      /* agent may exit before reading all of stdin; close handles the outcome */
    });
    child.stdin.end(stdin, 'utf8');
  });
}

export const tail = (s: string, n = 4000): string => (s.length > n ? s.slice(-n) : s);

export function failure(error: string, raw: string): StageResult {
  return {
    ok: false,
    resultText: '',
    tokens: { input: 0, output: 0 },
    cost_usd: 0,
    duration_ms: 0,
    num_turns: 0,
    raw: tail(raw),
    error,
  };
}
