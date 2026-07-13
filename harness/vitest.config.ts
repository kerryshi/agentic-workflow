import { cpus } from 'node:os';
import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    // These are integration suites: they spawn real processes (bash, git, node -e,
    // taskkill) and drive whole pipelines. Windows process creation costs an order of
    // magnitude more than POSIX, so two things must give or the suite is flaky
    // (measured on the desktop, 2026-07-13 — PORTFOLIO A11):
    //
    //  1. CONCURRENCY. vitest defaults to one worker per core — 16 on this box. Sixteen
    //     workers each spawning processes starve each other: 11 failures across 5 files,
    //     with EPERM on temp-dir cleanup trailing the timeouts (a killed process still
    //     holds its cwd briefly on Windows, and rmSync's `force` does not retry EPERM).
    //     Capping workers took that to 1 flake in 4 runs, and the EPERM vanished
    //     entirely — it was purely a contention artifact.
    //  2. HEADROOM. The delta-review rounds genuinely take ~17s each here (several
    //     review rounds, each snapshotting a git diff). A 30s ceiling left almost none,
    //     and the last flake was one of them landing at 30.0s.
    //
    // The Mac sees neither — spawn is cheap there — which is exactly how v2.2 shipped
    // Windows-red. Don't "fix" a Windows flake by lowering these; measure first.
    testTimeout: isWindows ? 60_000 : 30_000,
    ...(isWindows ? { maxWorkers: Math.min(4, cpus().length) } : {}),
  },
});
