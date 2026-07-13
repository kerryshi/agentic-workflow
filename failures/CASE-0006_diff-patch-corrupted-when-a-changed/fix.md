# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-09T22:53:18-04:00)
- Status: fixed
- Regression test: tests/run_tests.ps1::R16
- Prevention layer: byte-preserving git diff capture

Let git write patch bytes directly without a PowerShell string round-trip.