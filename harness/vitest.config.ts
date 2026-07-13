import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Several suites spawn real processes (bash, git, node -e). Windows spawn
    // latency made engine-level verify tests blow the 5s default even after
    // dropping the login shell (desktop, 2026-07-12) — give integration
    // headroom instead of tuning per test.
    testTimeout: 30_000,
  },
});
