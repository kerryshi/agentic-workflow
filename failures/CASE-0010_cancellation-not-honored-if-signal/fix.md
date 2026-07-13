# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-10T10:55:15-04:00)
- Status: fixed
- Regression test: zed-acp-agents test/runner-cancel.test.js (2 tests; fail without guard, pass with it)
- Prevention layer: pre-spawn signal.aborted guard in ClaudeRunner + post-core.start re-check in agent codeTurn

