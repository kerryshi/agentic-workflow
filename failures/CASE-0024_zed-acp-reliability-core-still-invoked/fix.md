# Fix

## Proposed Fix
TBD

## Applied Fix
TBD

## Verification
TBD


## Resolution (2026-07-16T20:56:04-04:00)
- Status: fixed
- Regression test: zed-acp-agents test/reliability-cli.test.js — 2 tests, watched failing (ENOENT scripts/new_run.ps1) against pre-fix reliability.js, green after
- Prevention layer: TBD

Migrated ReliabilityCore to spawn the Node harness CLI (new-run/update-run/complete-run) argv-style via process.execPath; evidence folds into --outcome; ZED_ACP_POWERSHELL env replaced by ZED_ACP_NODE. Full suite 11/11 + check + build green; real ACP drive re-run live as the watched check
