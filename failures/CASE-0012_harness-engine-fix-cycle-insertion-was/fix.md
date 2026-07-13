# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-11T05:38:21-04:00)
- Status: fixed
- Regression test: harness/tests/engine.test.ts :: review-only template parks on must_fix - no ungated fix build
- Prevention layer: engine requires a done approval stage before inserting a fix cycle; review-only pipelines park with findings

hadApprovedPlan check gates fix-cycle insertion