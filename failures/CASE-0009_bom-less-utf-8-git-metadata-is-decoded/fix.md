# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-09T22:53:22-04:00)
- Status: fixed
- Regression test: tests/run_tests.ps1::R21,R22
- Prevention layer: explicit UTF-8 process and JSON decoding

Decode git stdout and BOM-less JSON explicitly as UTF-8.