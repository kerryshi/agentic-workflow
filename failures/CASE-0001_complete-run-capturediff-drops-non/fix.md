# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-09T10:41:09-04:00)
- Status: fixed
- Regression test: tests/run_tests.ps1::R14
- Prevention layer: project test + code fix (complete_run.ps1 Get-RepoDiff)

Intent-to-add over the . pathspec on a throwaway index copy (GIT_INDEX_FILE); git enumerates untracked files itself so no filename round-trips through PowerShell.