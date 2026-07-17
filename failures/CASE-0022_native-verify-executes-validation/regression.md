# Regression

## Regression Test
- `harness/tests/verify.test.ts` — `runs a plan-authored backslash path after normalizing it for bash`
  (behavioral: real `bash -c` exec of `node scripts\probe.cjs` in a temp repo)
- `harness/tests/verify.test.ts` — `normalizes only path-shaped tokens that resolve in the repo`
  (unit: rewrites `.venv\Scripts\python`, leaves `foo\.py` regex escapes and quoted tokens alone)
- `harness/tests/verify.test.ts` — `normalizes backslash paths and says so in evidence (CASE-0022)`
  (engine integration: run completes, evidence.md shows the "ran as" line)
- `harness/tests/briefs.test.ts` — `plan brief validation-command rules (CASE-0022)`

## Failing-First Evidence
Run before the fix (2026-07-15, vitest on the branch with tests only):

```
FAIL tests/verify.test.ts > nativeVerify executor > runs a plan-authored backslash path after normalizing it for bash
  expected false to be true  # res.passed — bash stripped the backslashes
FAIL tests/verify.test.ts > nativeVerify executor > normalizes only path-shaped tokens that resolve in the repo
  TypeError: normalizeCommandForBash is not a function
FAIL tests/verify.test.ts > native verify is the default verify stage > normalizes backslash paths and says so in evidence (CASE-0022)
  expected 'parked' to be 'completed'   # the exact production failure: green change parked
FAIL tests/briefs.test.ts > plan brief validation-command rules (CASE-0022)
Test Files  2 failed (2) / Tests  6 failed | 7 passed (13)
```

The engine-integration failure reproduces the production incident exactly: a green change
parked on `verification failed` because bash stripped the backslashes out of the command.

## Passing Evidence
After the fix (same session):

```
Test Files  25 passed (25)
Tests  177 passed (177)
```

`npm run typecheck` and `npm run build` clean.
