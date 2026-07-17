# Fix

## Proposed Fix
Both halves of the prevention note:
1. **Grill brief** (`harness/src/brief.ts`): drop the "Skim the repository briefly if that
   helps" invitation — on a large/self-referential repo it funds an expedition. New
   directive: work from the task text, ASK, DON'T EXPLORE; at most 2 quick file peeks to
   confirm named things exist; a question you would answer by reading code is a question
   to return, not research to do.
2. **Smaller exploration allowance** (`harness/src/templates.ts`): `STAGE_MAX_TURNS.grill`
   lowered 12 → 6 — enough for a couple of peeks plus the answer, so a wandering grill
   burns half the budget it used to before parking. Note: the cap only binds the Claude
   driver (`codex exec` has no max-turns equivalent; the stage timeout backstops it) —
   the brief rewrite is the driver-agnostic primary fix.

## Applied Fix
Applied as proposed on branch fix-case-0021-0022 (2026-07-15):
- `harness/src/brief.ts` — grill stage rewritten ask-don't-explore
- `harness/src/templates.ts` — grill turn cap 12 → 6 with rationale comment

## Verification
`npm run typecheck` clean; full suite `npx vitest run` 177/177 green (25 files) including
the 2 new CASE-0021 regressions; `npm run build` clean. See regression.md.

## Resolution (2026-07-15T17:39:29-04:00)
- Status: fixed
- Regression test: harness/tests/briefs.test.ts: 'directs the agent to ask instead of exploring the repo' (old Skim-the-repository invitation must be gone), 'keeps the grill turn cap small' (cap <= 6)
- Prevention layer: grill brief forbids exploration (ask, don't read); engine passes a 6-turn cap so the failure mode costs half as much if it recurs
