# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD


## Resolution (2026-07-12T20:23:44-04:00)
- Status: fixed
- Regression test: harness/tests/lock.test.ts + harness/tests/cases.test.ts::'concurrent captures with different summaries never share a number'
- Prevention layer: withDirLock around every shared-record RMW; port reviews must diff concurrency semantics against the source

withDirLock (mkdir mutex, stale-break) added; case allocation scans+claims under it; run.json RMWs locked in cases.ts AND records.ts. Commit 75fdaa1.
