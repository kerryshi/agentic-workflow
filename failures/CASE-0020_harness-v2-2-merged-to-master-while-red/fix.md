# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD


## Resolution (2026-07-13T15:38:47-04:00)
- Status: fixed
- Regression test: harness/tests/doctor.test.ts (gate reported when uninstalled) + the gate itself, proven both ways through a real git merge
- Prevention layer: .githooks/pre-merge-commit runs the suite before a merge lands and refuses a red one; vitest.config.ts caps workers and raises the timeout on Windows. harness doctor reports when the gate is not installed.

The gate was silently broken on the first attempt (reported green while merging a red branch) and only testing it found that. Now proven: red refused (exit 1, HEAD unmoved), green merged.
