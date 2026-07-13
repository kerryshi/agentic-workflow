# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD


## Resolution (2026-07-13T15:38:38-04:00)
- Status: fixed
- Regression test: harness/tests/run-claim.test.ts::concurrent PROCESSES never share an id (CASE-0005 class)
- Prevention layer: src/claim.ts: atomic non-recursive mkdir claim - the directory IS the lock, as new_run.ps1 had it. ensureDir (mkdir -p) must never be used to claim an id.

Replaced check-then-act with claimDir(). Proven fail-first: the regression only catches the race behind a shared barrier - 8 one-shot racers and an unbarriered loop both went GREEN against the bug.
