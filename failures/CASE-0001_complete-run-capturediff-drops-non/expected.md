# Expected Behavior

`complete_run.ps1 -CaptureDiff` writes a `diff.patch` that includes **every** untracked file in the
repo regardless of its name — ASCII (`newfile.txt`) and non-ASCII (`café.txt`) alike — so the run
record's diff is a faithful, `git apply`-able snapshot of the change.
