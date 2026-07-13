# Classification

- Failure class: syntax_type_error
- Severity: must_fix
- Prevention layer: project test + code fix (scripts/capture_failure.ps1)

## Root Cause
The next case number was computed as `($caseNumbers | Measure-Object -Maximum).Maximum`. In Windows
PowerShell 5.1 `Measure-Object -Maximum` returns a `[double]`. That value was then formatted with
`"{0:D4}"`, but the `D` (decimal) format specifier is **integral-only** and throws on a `[double]`.
The first call skipped this path (empty-set branch), so the bug only surfaced from the second call on.
Fix: `[int](($caseNumbers | Measure-Object -Maximum).Maximum)` before formatting.

## Contributing Factors
- PS 5.1's implicit `[double]` from `Measure-Object` is a well-known footgun.
- The MVP was never exercised with two captures before shipping (same verification gap as CASE-0003).
