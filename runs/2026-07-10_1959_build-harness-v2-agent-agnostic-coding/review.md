# Review

## Independent Reviewer
Multi-agent adversarial workflow (5 lenses: state-machine, process-io, records-compat,
safety-boundary, spec-drift → per-finding adversarial verification). 41 findings raised;
28 verified real (most at note level), 4 refuted, 9 verifications lost to the monthly spend
limit and hand-verified by code inspection instead.

## Must-fix
All fixed in the same session, each with a regression (failure cases CASE-0011..0015):
- fix-cycle crash instead of park on `{"verdict":"must_fix"}` with no arrays → CASE-0011
- template-blind fix cycle: review-only pipeline auto-ran an ungated repo-editing build → CASE-0012
- verify accepted PASS with zero results / empty output tails (unbacked "done") → CASE-0013
- first-JSON-wins parser forgeable by quoted repo content → CASE-0014 (last-JSON-wins now)
- `--skip approval` silently removed the only human gate → now refused by the engine

## Should-fix / Nits
Fixed: per-chunk UTF-8 decode (CASE-0015), refactor fix-cycle re-verify (stale evidence),
run-ID collision guard, double-complete guard, merge-not-replace on completion, secret scrub on
recorded output tails (FR7), claude error-envelope surfaced on non-zero exit, process-tree kill
on timeout, skipped stages recorded not erased, grill-resume hash check, park_reason cleanup,
validation_plan synced to run.json, tmp cleanup in the atomic writer, docs event-name and
cross-check claims corrected (cross-check now an executable test).
Accepted as documented behavior: --dangerously-skip-permissions default (Kerry's standing
full-auto decision; --safe-perms opt-out added), riskLevel recorded-not-enforced, keyword
classifier approximate (--template overrides).

## Resolution
Post-fix: harness vitest **47/47 green** (incl. the new PS metrics cross-check test),
`tsc --noEmit` clean, v1 PS harness **64/64**. Fix commit follows the review commit trail;
failure loop exercised for real (5 cases captured + resolved in one pass).


## Completion reviewer result (2026-07-11T05:39:21-04:00)

5-lens adversarial workflow: 41 raised, 28 real, all serious fixed same-session; 9 verifications hit the monthly spend limit and were hand-verified