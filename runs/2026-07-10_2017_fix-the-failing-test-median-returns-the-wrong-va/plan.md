## Goal
Fix `median()` in `src/stats.js` so it correctly averages the two middle elements for even-length arrays, without changing odd-length or empty-array behavior.

## Root cause
`src/stats.js:6-7` computes `mid = Math.floor(sorted.length / 2)` and returns `sorted[mid]` unconditionally. For even-length arrays this returns the upper-middle element (e.g. `sorted[2]` = 3 for `[1,2,3,4]`) instead of the average of the two middle elements (`(2+3)/2 = 2.5`). Confirmed via `npm test`: actual `3`, expected `2.5`.

## Steps
1. Edit `src/stats.js`: after sorting, branch on `sorted.length % 2`.
   - Odd length: return `sorted[mid]` (existing behavior, `mid = Math.floor(sorted.length / 2)`).
   - Even length: return `(sorted[mid - 1] + sorted[mid]) / 2`.
2. Leave the empty-array guard (lines 2-4) untouched — no test targets it for change.
3. Do not touch `test/stats.test.js` — it's correct per the task.
4. Re-run the full test suite and confirm all 3 tests pass (odd-length, even-length, rejects-empty).

## Files to touch
- `src/stats.js` (implementation fix only)

## Validation commands
- `npm test` (runs `node --test`, discovers `test/stats.test.js`) — expect `pass 3`, `fail 0`.

## Risks
- Low risk: single pure function, 3 existing tests fully cover odd/even/empty cases. No other files reference `median` (single-file fixture repo), so no ripple effects.
- Must ensure the odd-length branch is unchanged (still returns `sorted[mid]`, not an average) to avoid regressing the passing test.

## Validation commands
- npm test
