# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-11T07:15:37-04:00)
- Status: fixed
- Regression test: harness/tests/proc.test.ts 'timeout always resolves (kill + grace force-finish)'
- Prevention layer: POSIX: detached spawn + process-group SIGKILL reaches grandchildren; all platforms: 5s grace force-finish after killTree (settled-guarded, unref'd)

killTree now kills the whole POSIX process group; a KILL_GRACE_MS fallback finish() guarantees the promise resolves even if inherited pipes never close. vitest 68/68.