import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess, tail } from './adapters/proc.js';

/**
 * Native verify: the harness executes the plan's validation commands itself.
 * Exit codes can't hallucinate, and the vacuous-PASS class (agent claiming
 * success without output — CASE class, review 2026-07-10) is impossible by
 * construction. Zero tokens.
 */
export interface NativeCommandResult {
  command: string;
  /** Present when backslash paths were rewritten for bash (CASE-0022). */
  normalized_command?: string;
  passed: boolean;
  exit_code: number | null;
  timed_out: boolean;
  output_tail: string;
}

export interface NativeVerifyResult {
  passed: boolean;
  results: NativeCommandResult[];
  /** Working-tree paths changed but never reported by a build stage. */
  surprises: string[];
  git_status_available: boolean;
  duration_ms: number;
}

const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

// Plans authored on Windows write .venv\Scripts\python; bash -c strips bare
// backslashes (.venvScriptspython: exit 127 — CASE-0022). Rewrite a token to
// forward slashes only when it is path-shaped AND the forward-slash form
// resolves in the repo as-is or with a Windows executable extension (the
// planner writes .venv\Scripts\python; the file is python.exe). Requiring the
// FULL path to resolve — never just its dirname — keeps regex escapes like
// foo\.py untouched even when foo/ is a real directory. Best-effort guard:
// the plan brief's forward-slash rule is the primary prevention.
const SEG = String.raw`[\w.-]+`;
const WIN_PATH_TOKEN = new RegExp(String.raw`^(?:[A-Za-z]:)?${SEG}(?:\\${SEG})+$`);
const EXEC_EXTS = ['', '.exe', '.cmd', '.bat'];

export function normalizeCommandForBash(command: string, cwd: string): string {
  return command
    .split(/(\s+)/)
    .map((token) => {
      if (!WIN_PATH_TOKEN.test(token)) return token;
      const fwd = token.replace(/\\/g, '/');
      const abs = /^[A-Za-z]:/.test(fwd) ? fwd : join(cwd, fwd);
      return EXEC_EXTS.some((ext) => existsSync(abs + ext)) ? fwd : token;
    })
    .join('');
}

async function runShell(cmd: string, cwd: string, timeoutMs: number) {
  // bash -c on every platform first: Git Bash is standing on the desktop
  // (sshd default shell) and the validation commands are written POSIX-style.
  // NOT -lc — a login shell sources profiles (~3-5s per spawn on Windows,
  // desktop-measured 2026-07-12) and makes the env non-deterministic.
  const bashBin = process.platform === 'win32' ? 'bash.exe' : 'bash';
  let out = await runProcess(bashBin, ['-c', cmd], cwd, '', timeoutMs);
  if (out.spawnError && process.platform === 'win32') {
    out = await runProcess('cmd.exe', ['/d', '/s', '/c', cmd], cwd, '', timeoutMs);
  }
  return out;
}

/** Porcelain paths from git status; empty + unavailable when not a repo. */
async function changedPaths(repo: string): Promise<{ available: boolean; paths: string[] }> {
  const out = await runProcess('git', ['-C', repo, 'status', '--porcelain'], repo, '', 60_000);
  if (out.spawnError || out.code !== 0) return { available: false, paths: [] };
  const paths = out.stdout
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
    // rename lines are "old -> new"; the new path is the change
    .map((p) => (p.includes(' -> ') ? p.split(' -> ').pop()! : p))
    .map((p) => p.replace(/^"|"$/g, ''));
  return { available: true, paths };
}

export async function nativeVerify(
  repo: string,
  commands: string[],
  reportedFiles: string[],
  commandTimeoutMs = COMMAND_TIMEOUT_MS,
): Promise<NativeVerifyResult> {
  const started = Date.now();
  const results: NativeCommandResult[] = [];
  for (const command of commands) {
    const normalized = normalizeCommandForBash(command, repo);
    const out = await runShell(normalized, repo, commandTimeoutMs);
    results.push({
      command,
      ...(normalized !== command ? { normalized_command: normalized } : {}),
      passed: !out.timedOut && !out.spawnError && out.code === 0,
      exit_code: out.code,
      timed_out: out.timedOut,
      output_tail: tail(`${out.stdout}\n${out.stderr}`.trim(), 2000),
    });
  }

  const status = await changedPaths(repo);
  const reported = new Set(reportedFiles.map((f) => f.replace(/\\/g, '/')));
  const surprises = status.paths.filter((p) => !reported.has(p.replace(/\\/g, '/')));

  return {
    passed: results.length > 0 && results.every((r) => r.passed),
    results,
    surprises,
    git_status_available: status.available,
    duration_ms: Date.now() - started,
  };
}
