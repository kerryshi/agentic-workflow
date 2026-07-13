# Evidence

## Commands
| Command | Result | Notes |
|---|---|---|
| `powershell -File tests/run_tests.ps1` x8 (before fix) | `31 passed, 1 failed` (exit 1), 8/8 | R14 deterministically red under piped stdout |
| `diag_r14.ps1` | `add -N 'caf├⌐.txt' -> 128`, `existsOnDisk=False`, `accented name` present=False | root cause: IBM437 decode of git UTF-8 stdout |
| `diag_r14.ps1` (fix approach) | `accented name` present=True; real index staged files=0 | temp-index + `.` pathspec captures it, index untouched |
| `powershell -File tests/run_tests.ps1` x10 (after fix) | `32 passed, 0 failed` (exit 0), 10/10 | deterministically green |
| `powershell -File tests/run_tests.ps1` x3 (after NIT) | `32 passed, 0 failed` (exit 0), 3/3 | still green after belt-and-suspenders NIT |
| capture_failure x3 + resolve_failure x3 | CASE-0001..0003 created + `status: fixed` | failure loop exercised end-to-end |
| `summarize_metrics.ps1` | 3 failures, 3 resolved, 3 regressions, 3 classes | metrics honest |

## Proof
- R14 root cause: `Console.OutputEncoding=IBM437`; git emits `café.txt` (UTF-8 `…C3 A9…`), PS 5.1
  decodes to `caf├⌐.txt` (codes `251C 2310`), `add -N` exits 128, file drops from the patch.
- Fix: `Get-RepoDiff` now does `git add -N -- "." @excludes` on a throwaway `GIT_INDEX_FILE` copy —
  git self-enumerates untracked files (no filename round-trips through PS), real index untouched.
- Harness: 31/1 (exit 1) before → 32/32 (exit 0) after, deterministic over 10 runs.
- Independent `reviewer` subagent: no MUST-FIX / no SHOULD-FIX; verified by reconstructing the old
  code (fail-before/pass-after) and empirically checking index safety; 1 NIT applied.

## Artifacts
- `scripts/complete_run.ps1` (Get-RepoDiff rewrite), `tests/run_tests.ps1` (R14 comments)
- `failures/CASE-0001..0003/` (full narratives + resolutions)
- `~/.claude/skills/review/SKILL.md` (step 5 — global config change)
- `diff.patch` (this run's captured snapshot), `metrics/summary.md`


## Completion (2026-07-09T10:55:20-04:00)

tests/run_tests.ps1 32/32 exit 0 over 10 runs; diag_r14 root-cause+fix proof; metrics show 3 resolved / 3 regressions.

### Evidence links
- runs/2026-07-09_1034_harden-agentic-workflow-v1-to-fully/evidence.md
- failures/CASE-0001_complete-run-capturediff-drops-non/regression.md
- metrics/summary.md