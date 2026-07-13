# Regression

## Regression Test
`tests/run_tests.ps1::R1` — "capture_failure works a second time (no D4 crash)" and "R1 case IDs
increment". Calls `capture_failure` twice and asserts the second call produces a `CASE-0002…`
directory without throwing.

## Failing-First Evidence
Pre-fix (v1-review pass): the second `capture_failure` call threw a format exception on `"{0:D4}"`
with a `[double]` argument; no `CASE-0002` directory was created.

## Passing Evidence
Post-fix: `[int]` cast before formatting; R1 green in the 32/32 harness (10/10 runs). This very
seeding pass exercised it end-to-end — `CASE-0001` through `CASE-0003` were created in one sweep with
no crash.
