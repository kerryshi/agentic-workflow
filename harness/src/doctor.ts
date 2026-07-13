import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeDriver } from './adapters/claude.js';
import { CodexDriver } from './adapters/codex.js';
import { runProcess } from './adapters/proc.js';
import { readJson } from './fsx.js';
import type { Pipeline } from './types.js';

/**
 * Zero-token preflight. Field finding (desktop, 2026-07-11): a session fought
 * the tooling for 8 minutes (blocked PS shim, slash-command task, duplicate
 * runs) and bounced off the harness entirely. Doctor turns that into one
 * command that says exactly what is wrong and what to type next.
 */

export interface DoctorCheck {
  ok: boolean | null; // null = informational
  label: string;
  detail: string;
}

export interface DoctorDeps {
  /** Agent availability comes from the DRIVERS — they know how to launch their
   * CLIs (the codex npm shim can't be spawned directly on Windows, CASE-0016). */
  claudeAvailable(): Promise<boolean>;
  codexAvailable(): Promise<boolean>;
  probe(bin: string, args: string[]): Promise<{ code: number | null; stdout: string }>;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

const defaultDeps: DoctorDeps = {
  claudeAvailable: () => new ClaudeDriver().available(),
  codexAvailable: () => new CodexDriver().available(),
  probe: async (bin, args) => {
    const out = await runProcess(bin, args, process.cwd(), '', 30_000);
    return { code: out.spawnError ? null : out.code, stdout: out.stdout };
  },
  platform: process.platform,
  env: process.env,
};

export async function runDoctor(
  root: string,
  repo: string,
  deps: DoctorDeps = defaultDeps,
): Promise<{ checks: DoctorCheck[]; healthy: boolean; nextCommand: string }> {
  const checks: DoctorCheck[] = [];
  const win = deps.platform === 'win32';

  checks.push(
    (await deps.claudeAvailable())
      ? { ok: true, label: 'claude CLI', detail: 'available (driver probe)' }
      : { ok: false, label: 'claude CLI', detail: 'not runnable — install/login claude, or set HARNESS_CLAUDE_BIN' },
  );

  checks.push({
    ok: null,
    label: 'codex CLI',
    detail: (await deps.codexAvailable())
      ? 'available (cross-agent review possible)'
      : 'absent — reviews fall back to a fresh claude process (recorded honestly)',
  });

  const bash = await deps.probe(win ? 'bash.exe' : 'bash', ['--version']);
  checks.push(
    bash.code === 0
      ? { ok: true, label: 'bash (native verify)', detail: 'found' }
      : {
          ok: win ? null : false,
          label: 'bash (native verify)',
          detail: win
            ? 'not on PATH — native verify falls back to cmd.exe (install Git Bash for POSIX commands)'
            : 'missing — native verify cannot run commands',
        },
  );

  const insideProject = existsSync(join(repo, '.git')) || existsSync(join(repo, 'AGENTS.md')) || existsSync(join(repo, 'CLAUDE.md')) || existsSync(join(repo, 'package.json')) || existsSync(join(repo, 'pyproject.toml'));
  const git = await deps.probe('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD']);
  checks.push(
    git.code === 0
      ? { ok: true, label: 'target repo', detail: `git repo (branch: ${git.stdout.trim() || 'unborn'})` }
      : {
          ok: null,
          label: 'target repo',
          detail:
            `${repo} is not a git repository — runs still work, but diff snapshots and the verify ` +
            `surprise-check degrade${insideProject ? '' : '; if this is not your project, re-run with --repo <path>'}`,
        },
  );

  const conventions = ['AGENTS.md', 'CLAUDE.md'].filter((f) => existsSync(join(repo, f)));
  checks.push({
    ok: null,
    label: 'repo conventions',
    detail: conventions.length
      ? `${conventions.join(' + ')} found — injected into worker briefs`
      : 'no AGENTS.md/CLAUDE.md — workers get only the brief (fine, just unguided on conventions)',
  });

  // The cross-platform gate. This repo is worked from a Windows desktop AND a Mac, and the
  // desktop is where the Mac's branches get merged — so the merge is the one moment the other
  // platform is guaranteed to be present. v2.2 shipped Windows-red because nothing checked.
  //
  // Only reported for a root that actually SHIPS the gate. Firing this in a user's own project
  // would be a false alarm, and a check that cries wolf is a check people delete.
  if (existsSync(join(root, '.githooks', 'pre-merge-commit'))) {
    const hooksPath = await deps.probe('git', ['-C', root, 'config', '--get', 'core.hooksPath']);
    const installed = hooksPath.code === 0 && hooksPath.stdout.trim() === '.githooks';
    checks.push(
      installed
        ? {
            ok: true,
            label: 'merge gate',
            detail: 'core.hooksPath=.githooks — a merge runs the suite on THIS machine first',
          }
        : {
            ok: false,
            label: 'merge gate',
            detail:
              'this repo ships .githooks/pre-merge-commit but it is NOT installed — a branch from ' +
              'the other machine can merge without ever running here (how v2.2 shipped ' +
              'Windows-red). Fix: git config core.hooksPath .githooks && git config merge.ff false',
          },
    );
  }

  // Active runs on this repo — the duplicate/abandonment class. Windows paths
  // compare case-insensitively.
  const runsDir = join(root, 'runs');
  const norm = (p: string) => {
    const n = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return win ? n.toLowerCase() : n;
  };
  const active: string[] = [];
  if (existsSync(runsDir)) {
    for (const id of readdirSync(runsDir)) {
      const pp = join(runsDir, id, 'pipeline.json');
      if (!existsSync(pp)) continue;
      try {
        const p = readJson<Pipeline>(pp);
        if (p.current_stage < p.stages.length && norm(p.repo) === norm(repo)) active.push(id);
      } catch {
        /* unreadable — not doctor's patient */
      }
    }
  }
  checks.push({
    ok: null,
    label: 'active runs here',
    detail: active.length
      ? `${active.length} parked/in-flight: ${active.map((id) => `harness resume ${id} -i`).join(' · ')}`
      : 'none',
  });

  if (win) {
    const appdata = deps.env['APPDATA'];
    const ps1 = appdata ? join(appdata, 'npm', 'harness.ps1') : undefined;
    const shimExists = ps1 !== undefined && existsSync(ps1);
    if (shimExists) {
      // Only a real policy wall makes this a failure — probe it instead of
      // asserting (deleting the .ps1 is temporary anyway: npm regenerates it
      // on the next global install).
      const policy = await deps.probe('powershell.exe', ['-NoProfile', '-Command', 'Get-ExecutionPolicy']);
      const effective = policy.stdout.trim();
      const blocked = policy.code !== 0 || /^(Restricted|AllSigned|Undefined)$/i.test(effective);
      checks.push(
        blocked
          ? {
              ok: false,
              label: 'PowerShell shim',
              detail:
                `harness.ps1 exists and the execution policy (${effective || 'unknown'}) blocks it — ` +
                `run from Git Bash / cmd (harness.cmd), or fix durably: ` +
                `powershell -Command "Set-ExecutionPolicy -Scope CurrentUser RemoteSigned" ` +
                `(deleting the .ps1 only lasts until the next npm install)`,
            }
          : { ok: true, label: 'PowerShell shim', detail: `execution policy ${effective} — shim runs fine` },
      );
    } else {
      checks.push({ ok: true, label: 'PowerShell shim', detail: 'no blocking harness.ps1 shim' });
    }
  }

  const healthy = checks.every((c) => c.ok !== false);
  const nextCommand = active.length
    ? `harness resume ${active[0]} -i`
    : `harness run -i "<one full sentence: goal + context + constraints>" --repo ${repo}`;
  return { checks, healthy, nextCommand };
}

export function renderDoctor(
  result: { checks: DoctorCheck[]; healthy: boolean; nextCommand: string },
  platform: NodeJS.Platform = process.platform,
): string {
  // ASCII on Windows: PS 5.1 decodes ✓/✗ via the OEM codepage into mojibake
  // (this platform's documented encoding-bite class).
  const marks: [string, string, string] = platform === 'win32' ? ['OK', 'XX', '--'] : ['✓', '✗', '·'];
  const mark = (ok: boolean | null) => (ok === true ? marks[0] : ok === false ? marks[1] : marks[2]);
  const lines = result.checks.map((c) => `${mark(c.ok)} ${c.label.padEnd(22)} ${c.detail}`);
  lines.push('', result.healthy ? `ready — next: ${result.nextCommand}` : `fix the ${marks[1]} items above, then re-run harness doctor`);
  return lines.join('\n');
}
