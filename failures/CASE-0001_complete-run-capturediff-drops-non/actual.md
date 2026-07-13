# Actual Behavior

When an untracked file had a non-ASCII name (e.g. `café.txt`), that file was silently dropped from
`diff.patch`. Plain ASCII untracked files were still captured, so the patch looked plausible but was
incomplete. Whether it reproduced depended on the invocation context (real console vs piped stdout),
so it presented as a *flaky* test (`tests/run_tests.ps1::R14`) rather than a hard failure — passing
under a real console but failing deterministically when the harness ran under piped stdout (the Bash
tool / CI path), 8/8 runs.
