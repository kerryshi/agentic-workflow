# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-09T10:41:11-04:00)
- Status: fixed
- Regression test: tests/run_tests.ps1::R1
- Prevention layer: project test + code fix (capture_failure.ps1)

Cast Measure-Object.Maximum to [int] before the D4 format.