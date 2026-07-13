import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * Harness-side working-tree snapshots (zero agent tokens). Untracked files
 * must appear — the 1617 run's new test file was untracked, and a snapshot
 * without it would blind a delta reviewer. Same trick as the v1 PS scripts'
 * R14 fix: intent-to-add on a THROWAWAY index copy (GIT_INDEX_FILE), so git
 * self-enumerates and the real index is never touched.
 */

interface GitOut {
  code: number | null;
  stdout: string;
}

function git(args: string[], cwd: string, env?: Record<string, string>): Promise<GitOut> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', () => resolve({ code: null, stdout: '' }));
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') }));
  });
}

export async function snapshotDiff(repo: string): Promise<string | undefined> {
  const top = await git(['rev-parse', '--show-toplevel'], repo);
  if (top.code !== 0) return undefined;

  const realIndex = join(repo, '.git', 'index');
  const tmpIndex = join(tmpdir(), `harness-snap-${randomBytes(6).toString('hex')}`);
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, tmpIndex);
    const env = { GIT_INDEX_FILE: tmpIndex };
    await git(['add', '-N', '.'], repo, env);
    const hasHead = (await git(['rev-parse', '--verify', 'HEAD'], repo)).code === 0;
    const diff = await git(hasHead ? ['diff', 'HEAD'] : ['diff'], repo, env);
    return diff.code === 0 ? diff.stdout : undefined;
  } finally {
    rmSync(tmpIndex, { force: true });
  }
}

/**
 * Cap a diff for brief inlining: whole files kept until the budget, the rest
 * summarized by name — silent truncation would read as "reviewed everything".
 */
export function capDiff(diff: string, maxChars: number): string {
  if (diff.length <= maxChars) return diff;
  const files = diff.split(/^(?=diff --git )/m);
  const kept: string[] = [];
  const dropped: string[] = [];
  let used = 0;
  for (const f of files) {
    if (used + f.length <= maxChars && dropped.length === 0) {
      kept.push(f);
      used += f.length;
    } else {
      const m = /^diff --git a\/(\S+)/.exec(f);
      dropped.push(m?.[1] ?? '(unnamed)');
    }
  }
  return `${kept.join('')}\n[diff truncated at ${maxChars} chars — ${dropped.length} more file(s) not inlined: ${dropped.join(', ')} — read them in the repo]`;
}
