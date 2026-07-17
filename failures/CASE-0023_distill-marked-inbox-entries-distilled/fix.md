# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD


## Resolution (2026-07-15T19:25:28-04:00)
- Status: fixed
- Regression test: No automated regression is possible for a markdown skill (no executable surface). The prevention IS the check: the skill's step 7 makes every future distill run verify its own links on disk and report the output; that check would have caught both prior incidents. Honest gap, stated plainly.
- Prevention layer: skill update (write-then-mark ordering + step-7 link verification); brain INDEX theme 1 promoted to the global brief the same day (a check you didn't watch fail is not a check)

Rewrote ~/.claude/skills/distill/SKILL.md: entries processed one at a time write-then-mark (a line moves to Distilled only after its note file exists on disk), plus a mandatory end-of-run verification that every [[link]] added resolves to a file in brain/notes/
