# Classification

- Failure class: environment_platform_issue
- Severity: should_fix
- Prevention layer: detached POSIX spawn + process-group SIGKILL; 5s grace force-finish after killTree (settled-guarded); regression: proc.test.ts 'timeout always resolves' CASE-0017

## Root Cause
TBD

## Contributing Factors
- TBD