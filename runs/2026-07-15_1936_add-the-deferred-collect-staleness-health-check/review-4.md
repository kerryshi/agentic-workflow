# Review — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check (round 4)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- tests/test_collect_health.py: Lines 216-222 require gitignored extension/out/extension.js. CI runs pytest in a separate clean-checkout job that never compiles or receives this artifact, so python -m pytest fails before exercising the regression. Reproduced by removing the compiled artifact temporarily. Run this behavioral test in the extension job after compilation, or otherwise make its dependency available in the pytest job.

## Should fix
- STATUS.md: It reports 17 collect-health tests, but tests/test_collect_health.py now contains 19.

## Notes
The original collision defect is resolved: npm run compile passed; all 19 targeted tests passed after compilation; a title containing the marker received the banner; and an engine-produced existing banner remained unchanged and idempotent. Full pytest was not run because the clean-checkout regression test blocker was already reproduced.
