# Regression

## Regression Test
`tests/run_tests.ps1::R14` — "non-ASCII untracked filename does not drop other untracked files".
Creates a git repo with a modified tracked file, an ASCII untracked file (`newfile.txt`), an empty
untracked file, and a non-ASCII untracked file (`café.txt`), runs `complete_run -CaptureDiff`, and
asserts the patch contains BOTH `accented name` (café.txt) and `brand new` (newfile.txt).

## Failing-First Evidence
Pre-fix, deterministic under piped stdout: `31 passed, 1 failed` (exit 1), 8/8 consecutive runs, with
`Failed: R14 …`. Isolated diagnostic confirmed `add -N 'caf├⌐.txt' -> LASTEXITCODE=128`,
`existsOnDisk=False`, and `patch contains 'accented name': False`.

## Passing Evidence
Post-fix: `32 passed, 0 failed` (exit 0) on 10/10 consecutive runs. Diagnostic of the fix approach:
`patch contains 'accented name': True`, `real index untouched (staged files: 0)`.
