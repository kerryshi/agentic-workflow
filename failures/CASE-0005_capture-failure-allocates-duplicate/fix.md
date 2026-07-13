# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-09T22:53:17-04:00)
- Status: fixed
- Regression test: tests/run_tests.ps1::R18
- Prevention layer: failure-directory mutex

Serialize scan and case-ID allocation under one mutex.