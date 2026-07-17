# Review — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check (round 1)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- extension/src/extension.ts: `collectNow()` calls `idleStatus()` when collection/SSH fails. Because `idleStatus()` now clears `statusItem.backgroundColor`, a previously established stale warning is erased and remains silently neutral until another refresh. Failed collection must preserve or set the unhealthy badge.
- extension/src/extension.ts: Unknown-health paths do not add the required banner to the digest. SSH/nonzero and parse failures leave the cached markdown unchanged, while valid output from an older engine is written unchanged without a banner. These cases show only the badge, contrary to the requirement that unknown/unreachable health warn on both the status bar and digest markdown.

## Should fix
- engine/cli.py: The `status` command still crashes on naive or malformed `last_collect` values because `_ago()` parses and subtracts the raw timestamp independently. This defeats `collect_health()`'s defensive unknown/naive handling for that surface.

## Notes
No files were edited. Targeted tests passed, the full pytest suite passed with exit 0, `npm run compile` passed, the compiled output contains `statusBarItem.warningBackground`, and `git diff --check` passed.
