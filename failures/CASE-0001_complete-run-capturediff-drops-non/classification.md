# Classification

- Failure class: environment_platform_issue
- Severity: must_fix
- Prevention layer: project test + code fix (scripts/complete_run.ps1 Get-RepoDiff)

## Root Cause
`Get-RepoDiff` listed untracked files with `git ls-files`, read the names back into PowerShell, then
passed each name to `git add -N -- <name>`. git emits paths as raw UTF-8, but Windows PowerShell 5.1
decodes a native command's stdout using the console **OEM code page** (`[Console]::OutputEncoding`,
here IBM437), not UTF-8. So `café.txt` (UTF-8 `63 61 66 C3 A9 2E …`) came back as the mojibake
`caf├⌐.txt` (`… 251C 2310 …`). That name matches no file on disk, so `git add -N` exited 128 and the
file was never intent-to-added — hence absent from the diff. The decode is context-dependent (console
vs pipe), which is why it looked intermittent.

The fix removes the round-trip entirely: intent-to-add over the `.` pathspec so **git** enumerates the
untracked files itself (no filename crosses back through PowerShell), run against a throwaway copy of
the index (`GIT_INDEX_FILE`) so the user's real index is never touched.

## Contributing Factors
- The round-trip (git stdout -> PS string -> git arg) is the fragile link; any non-ASCII name breaks it.
- `$OutputEncoding` (us-ascii) and `[Console]::OutputEncoding` (IBM437) both differ from git's UTF-8.
- The original test was written as a flaky assertion, masking a deterministic bug as "occasionally red".
