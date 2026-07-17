# Regression

## Regression Test
- `harness/tests/briefs.test.ts` — `directs the agent to ask instead of exploring the repo`
  (asserts the ASK, DON'T EXPLORE directive is present and the old "Skim the repository"
  invitation is gone from the grill brief)
- `harness/tests/briefs.test.ts` — `keeps the grill turn cap small — questions, not expeditions`
  (asserts `STAGE_MAX_TURNS.grill <= 6`)

The failure is LLM behavior, so the testable surface is the prevention layer itself: the
brief text that steers the model and the cap that bounds the damage. Both are pinned.

## Failing-First Evidence
Run before the fix (2026-07-15, vitest on the branch with tests only):

```
FAIL tests/briefs.test.ts > grill brief (CASE-0021) > directs the agent to ask instead of exploring the repo
  expected '...Skim the repository briefly if that helps...' to contain "ASK, DON'T EXPLORE"
FAIL tests/briefs.test.ts > grill brief (CASE-0021) > keeps the grill turn cap small — questions, not expeditions
  expected 12 to be less than or equal to 6
Test Files  2 failed (2) / Tests  6 failed | 7 passed (13)
```

## Passing Evidence
After the fix (same session):

```
Test Files  25 passed (25)
Tests  177 passed (177)
```

`npm run typecheck` and `npm run build` clean.
