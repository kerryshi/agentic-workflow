# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-11T05:38:21-04:00)
- Status: fixed
- Regression test: harness/tests/engine.test.ts :: must_fix verdict with missing arrays parks instead of crashing
- Prevention layer: engine normalizes finding arrays + execute() wraps every stage in a park-on-exception guard (park contract absolute)

guard must_fix/should_fix with ?? []; park on must_fix-without-findings; try/catch in execute parks internal errors