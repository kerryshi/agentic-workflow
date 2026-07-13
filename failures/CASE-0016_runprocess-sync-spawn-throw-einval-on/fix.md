# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-11T07:15:37-04:00)
- Status: fixed
- Regression test: harness/tests/proc.test.ts 'sync spawn throw (.cmd...) resolves with spawnError'; harness/tests/codex-driver.test.ts '.cmd override... resolves... instead of rejecting' (win32)
- Prevention layer: proc.ts try/catch around spawn -> resolve spawnError; Engine.isAvailable try/catch (probe crash can never kill the CLI pre-run)

spawn() wrapped in try/catch inside runProcess resolving {code:null, spawnError}; Engine.isAvailable guards await d.available(). vitest 68/68.