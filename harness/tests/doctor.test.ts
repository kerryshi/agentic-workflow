import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderDoctor, runDoctor, type DoctorDeps } from '../src/doctor.js';
import { writeJsonAtomic } from '../src/fsx.js';

let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-doctor-'));
  repo = join(root, 'target-repo');
  mkdirSync(repo, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface DepsOver {
  claude?: boolean;
  codex?: boolean;
  probes?: Record<string, { code: number | null; stdout: string }>;
  platform?: NodeJS.Platform;
  env?: Record<string, string>;
}

function deps(over: DepsOver = {}): DoctorDeps {
  return {
    claudeAvailable: async () => over.claude ?? true,
    codexAvailable: async () => over.codex ?? false,
    platform: over.platform ?? 'darwin',
    env: over.env ?? {},
    probe: async (bin) =>
      over.probes?.[bin.replace(/\.exe$/, '')] ?? { code: 0, stdout: `${bin} ok` },
  };
}

describe('harness doctor', () => {
  it('healthy setup passes and suggests an interactive run', async () => {
    const result = await runDoctor(root, repo, deps());
    expect(result.healthy).toBe(true);
    expect(result.nextCommand).toContain('harness run -i');
    expect(renderDoctor(result, 'darwin')).toContain('✓ claude CLI');
  });

  it('agent availability comes from the DRIVERS, not raw CLI spawns (codex.cmd class)', async () => {
    const result = await runDoctor(root, repo, deps({ codex: true }));
    expect(renderDoctor(result, 'darwin')).toContain('cross-agent review possible');
  });

  it('missing claude CLI is a hard failure with a fix hint', async () => {
    const result = await runDoctor(root, repo, deps({ claude: false }));
    expect(result.healthy).toBe(false);
    expect(renderDoctor(result, 'darwin')).toContain('✗ claude CLI');
    expect(renderDoctor(result, 'darwin')).toContain('HARNESS_CLAUDE_BIN');
  });

  it('absent codex is informational, never a failure (honest fallback exists)', async () => {
    const result = await runDoctor(root, repo, deps({ codex: false }));
    expect(result.healthy).toBe(true);
    expect(renderDoctor(result, 'darwin')).toContain('fresh claude process');
  });

  it('lists active runs on this repo with interactive resume commands', async () => {
    const runDir = join(root, 'runs', '2026-07-11_1242_plan');
    mkdirSync(runDir, { recursive: true });
    writeJsonAtomic(join(runDir, 'pipeline.json'), {
      run_id: '2026-07-11_1242_plan',
      repo,
      task: 'x',
      current_stage: 0,
      stages: [{ name: 'grill', status: 'parked', artifacts: [] }],
    });
    const result = await runDoctor(root, repo, deps());
    expect(renderDoctor(result, 'darwin')).toContain('harness resume 2026-07-11_1242_plan -i');
    expect(result.nextCommand).toBe('harness resume 2026-07-11_1242_plan -i');
  });

  it('windows: repo path comparison for active runs is case-insensitive', async () => {
    const runDir = join(root, 'runs', 'r1');
    mkdirSync(runDir, { recursive: true });
    writeJsonAtomic(join(runDir, 'pipeline.json'), {
      run_id: 'r1',
      repo: repo.toUpperCase(),
      task: 'x',
      current_stage: 0,
      stages: [{ name: 'grill', status: 'parked', artifacts: [] }],
    });
    const result = await runDoctor(root, repo, deps({ platform: 'win32' }));
    expect(result.nextCommand).toContain('harness resume r1');
  });

  it('windows: the shim is only a failure when the execution policy actually blocks it', async () => {
    const appdata = join(root, 'appdata');
    mkdirSync(join(appdata, 'npm'), { recursive: true });
    writeFileSync(join(appdata, 'npm', 'harness.ps1'), 'shim');

    const blocked = await runDoctor(
      root,
      repo,
      deps({ platform: 'win32', env: { APPDATA: appdata }, probes: { powershell: { code: 0, stdout: 'Restricted\n' } } }),
    );
    expect(blocked.healthy).toBe(false);
    const blockedText = renderDoctor(blocked, 'win32');
    expect(blockedText).toContain('Set-ExecutionPolicy -Scope CurrentUser RemoteSigned');
    expect(blockedText).toContain('only lasts until the next npm install');

    const fine = await runDoctor(
      root,
      repo,
      deps({ platform: 'win32', env: { APPDATA: appdata }, probes: { powershell: { code: 0, stdout: 'RemoteSigned\n' } } }),
    );
    expect(fine.healthy).toBe(true);
    expect(renderDoctor(fine, 'win32')).toContain('shim runs fine');
  });

  it('windows rendering is pure ASCII (PS 5.1 OEM-codepage mojibake class)', async () => {
    const result = await runDoctor(root, repo, deps({ platform: 'win32', claude: false }));
    const text = renderDoctor(result, 'win32');
    expect(text).not.toMatch(/[✓✗·]/);
    expect(text).toContain('XX claude CLI');
  });

  it('non-git non-project dir hints at --repo', async () => {
    const result = await runDoctor(root, repo, deps({ probes: { git: { code: 128, stdout: '' } } }));
    expect(result.healthy).toBe(true);
    expect(renderDoctor(result, 'darwin')).toContain('re-run with --repo');
  });
});
