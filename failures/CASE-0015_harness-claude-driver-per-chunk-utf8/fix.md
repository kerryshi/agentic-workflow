# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD

## Resolution (2026-07-11T05:38:21-04:00)
- Status: fixed
- Regression test: correct-by-construction: runProcess collects Buffers and decodes once at close (harness/src/adapters/claude.ts); verified by inspection + tsc, no process-level unit test
- Prevention layer: buffered single decode in the driver; brain note staged-agents/spawn-stdin patterns

Buffer.concat + single toString(utf8) at close; taskkill /T on timeout added in the same pass