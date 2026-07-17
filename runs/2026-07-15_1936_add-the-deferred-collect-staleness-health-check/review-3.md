# Review — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check (round 3)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- extension/src/extension.ts:114: Prior finding is unresolved. `md.includes(STALE_MARKER)` still mistakes scraped content containing “Collection may have stopped” for an existing banner. Direct execution of the freshly compiled extension reproduced `banner_present=false` and `output_unchanged=true` for an older-engine digest containing that phrase in a title. Detect the exact banner structure or use a collision-resistant sentinel.
- tests/test_collect_health.py: The required collision regression test is still missing. Add a test proving an older-engine digest with the marker phrase in a scraped title or summary still receives the stale banner, while an actual existing banner remains idempotent.

## Should fix
- none

## Notes
Scoped re-review only. The source and test hashes exactly match the prior review (`20813c4…` and `fe52d17…`), so no fix delta exists. Existing 17 targeted tests passed and `npm run compile` passed, but neither catches the reproduced defect.
