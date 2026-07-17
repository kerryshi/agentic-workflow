# Review — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check (round 2)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- extension/src/extension.ts:114: `withStaleBanner()` uses `md.includes(STALE_MARKER)` with the generic text “Collection may have stopped.” Scraped titles or summaries containing that phrase are mistaken for an existing banner. I reproduced this with compiled extension code and an older-engine response lacking `health`: the badge warned, but the digest remained unbannered. Detect the exact banner structure or use a collision-resistant sentinel, and add a regression test.

## Should fix
- none

## Notes
Both previous findings are otherwise resolved through behavioral verification: failed collect/fetch paths preserve the warning badge, unknown/nonzero/parse/older-engine paths banner cached markdown, repeated failures do not stack normal banners, and a fresh response clears both warning surfaces. Focused pytest: 29 passed. New test module: 17 passed. Full pytest suite: 126 passed in 96.3s. TypeScript compilation and `git diff --check` passed. No Jetson deploy path was touched.
