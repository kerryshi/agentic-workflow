# Final

## Outcome
Both tests pass.

**Outcome:** Fixed the even-length median bug.

**Changes:** `stats.js` — `median` now averages the two middle values when the sorted array has even length, instead of returning only `sorted[len/2]`.

**Validation:** `npm test` → 2/2 passing (odd-length and even-length cases).

**Risks/Follow-ups:** None; change is a minimal, scoped fix.

## Status
complete

## Files Changed
- stats.js

## Validation / Evidence
ACP executor exit: 0. Both tests pass.

**Outcome:** Fixed the even-length median bug.

**Changes:** `stats.js` — `median` now averages the two middle values when the sorted array has even length, instead of returning only `sorted[len/2]`.

**Validation:** `npm test` → 2/2 passing (odd-length and even-length cases).

**Risks/Follow-ups:** None; change is a minimal, scoped fix.

## Reviewer Result
**Outcome:** No must-fix findings. The fix is correct and matches the executor's report.

**Verification performed:**
- `git diff` confirms the change is a minimal, scoped fix to `median` in `stats.js:1-8` — only the even/odd branching was added, no unrelated edits.
- Traced both test cases by hand against the new code (couldn't run `npm test` directly — Bash was denied in this read-only turn):
  - `median([3,1,2])` → sorted `[1,2,3]`, odd length, returns `sorted[1] = 2` ✓
  - `median([4,1,3,2])` → sorted `[1,2,3,4]`, even length, returns `(sorted[1]+sorted[2])/2 = 2.5` ✓
- `[...values].sort(...)` still avoids mutating the caller's array, consistent with the original.
- `package.json` test script (`node --test test.js`) matches what the executor ran.

**Minor, non-blocking observation:** empty-array input changes from `undefined` (old code) to `NaN` (new code, since `sorted[-1] + sorted[0]`). Not a regression in any meaningful sense (both are invalid-input results) and out of scope for this bug fix — flagging only for awareness, not requiring action.

## Risks
Run is recorded as complete, not shipped; review findings still require human judgment.

## Follow-ups
Reliability run: 2026-07-10_1628_npm-test-fails-the-even-length-median