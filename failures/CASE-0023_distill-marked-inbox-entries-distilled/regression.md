# Regression

## Regression Test
**None — honestly.** The failing artifact is a markdown skill (`~/.claude/skills/distill/SKILL.md`);
there is no executable surface to pin with an automated test, and `failure.json.regression_test` is
deliberately empty so `harness metrics` does not count a test that doesn't exist.

The prevention IS a check, just a procedural one: the rewritten skill's step 7 requires every
distill run to verify on disk that each `[[link]]` it added resolves to a file in `brain/notes/`
and to include that check's output in its report. That verification would have caught both prior
incidents (13 phantom notes 2026-07-12, 4 more 2026-07-13).

## Failing-First Evidence
The check "failed" against real history: brain commits `4649d82` ("repair 13
marked-distilled-but-never-written") and `507fb3c` ("backfill 4 phantom 07-13 notes") document the
two incidents the old skill ordering allowed.

## Passing Evidence
The 2026-07-15 audit ran exactly this verification over the whole graph post-repair: all 135
outbound `[[links]]` across 85 notes resolve; the only unresolved target is the literal `[[name]]`
placeholder in `notes/_template.md`. Future runs must reproduce this evidence per-run.
