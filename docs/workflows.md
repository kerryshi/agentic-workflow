# Agentic Workflow v1 (reliability layer)

An agent-agnostic reliability layer. Claude Code is the first supported adapter, but the same run
records, failure cases, ship evidence, and metrics can wrap Codex or local/open-source agents.
See `docs/ai-coding-workflow.md` and `adapters/adapter-contract.md` for the general loop.

## Invocation (read first)

The scripts are Windows PowerShell 5.1 and share `scripts/_common.ps1` (auto-loaded). Two
safe ways to call them:

- **From a PowerShell session, in-process:** `& C:\Users\PC\agentic-workflow\scripts\new_run.ps1 -Objective "..." ...`
- **From the Bash tool:** `powershell -NoProfile -ExecutionPolicy Bypass -File C:\...\new_run.ps1 -Objective "..." ...`

Do **not** pass argument values that contain double quotes or newlines through
`powershell -File` from a PowerShell session - PS 5.1 mangles quote-bearing strings passed to
native exes. For long narrative (final outcome, reviewer notes), pass a short value and edit
the generated `.md` afterward, or run from the Bash tool.

All records are BOM-less UTF-8 and strict-parser friendly. Every script takes an optional
`-Root` (defaults to this repo) so tests and experiments never touch real records.

## A. Start a run

For substantial coding tasks, before major edits.

```powershell
& C:\Users\PC\agentic-workflow\scripts\new_run.ps1 `
  -Objective "Fix failing navbar test" `
  -Repo C:\Users\PC\example-repo `
  -AgentId claude-code `
  -RiskLevel medium `
  -ValidationPlan 'npm test', 'npm run lint'
```

`-ValidationPlan` binds as a PowerShell array (`'a','b'`); items are **not** comma-split, so a
command like `'pytest -k "a,b"'` is preserved. The script prints the generated run ID (format
`yyyy-MM-dd_HHmm_slug`) - later steps auto-detect it, so you rarely need to copy it.

Done when `runs/<run-id>/run.json` exists with `status: in_progress` and an `agent` block.

## B. Work the run (optional, mid-flight)

Log commands and attach evidence without editing files by hand:

```powershell
& C:\Users\PC\agentic-workflow\scripts\update_run.ps1 `
  -Command "npm test" -Result "12 passed" -Note "navbar green" `
  -EvidenceLink "runs/<run-id>/test-output.txt"
```

Omit `-RunId` and it targets the newest in-progress run. `-Command` appends a JSON line to
`commands.jsonl`; `-EvidenceLink` adds to the run's `evidence_links`.

## C. Ship a change

Run the normal `/ship` process first (diff scan, independent review, validation, evidence).
Then complete the run record:

```powershell
& C:\Users\PC\agentic-workflow\scripts\complete_run.ps1 `
  -Status shipped `
  -FinalOutcome "Fixed failing navbar test and added regression coverage." `
  -ReviewerResult "No must-fix findings remain." `
  -Evidence "npm test and npm run lint passed." `
  -CaptureDiff
```

Omit `-RunId` to auto-detect the active run. `complete_run`:
- authors `final.md` (its own report) and updates `run.json`;
- **appends** a completion section to `evidence.md` and `review.md` - it never overwrites
  content you wrote during the run;
- merges (never drops) `evidence_links` and `files_changed`;
- refuses to re-complete an already-finished run unless you pass `-Force` (which logs a
  `run_amended` event instead of a duplicate `run_completed`).

`-CaptureDiff` writes a real, `git apply`-able `diff.patch` (tracked changes + untracked new
files). **Caveat:** it embeds the content of untracked, non-gitignored files from the target
repo. Common secret paths (`.env`, `*.pem`, `*.key`, `credentials.json`, `token.json`, ...) are
excluded, but do not use `-CaptureDiff` on a repo that may hold unignored secrets.

Done when `final.md`, `evidence.md`, `review.md`, and `diff.patch` tell the story without
opening chat history.

## D. Capture a failure

When tests fail, review finds a serious issue, the user reports a regression, or the agent
behavior itself was wrong.

```powershell
& C:\Users\PC\agentic-workflow\scripts\capture_failure.ps1 `
  -Summary "Reviewer caught wrong order confirmation flow" `
  -Repo C:\Users\PC\example-repo `
  -LinkedRun <run-id> `
  -FailureClass weak_verification `
  -Severity must_fix `
  -ReproCommand 'pytest tests/test_orders.py -k confirmation'
```

Pass `-Repo` explicitly - it defaults to the current directory, which is usually not the
failing project. Creates `failures/CASE-####_slug/` (expected / actual / repro / evidence /
classification / fix / regression) and links the case into the run when `-LinkedRun` is given.

## E. Resolve a failure

After fixing, close the case and record the durable prevention:

```powershell
& C:\Users\PC\agentic-workflow\scripts\resolve_failure.ps1 `
  -CaseId CASE-0001 -Status fixed `
  -RegressionTest "tests/run_tests.ps1::R1" `
  -PreventionLayer "project test" `
  -FixSummary "Cast Measure-Object max to int before the D4 format."
```

Sets `status` (`fixed` / `wont_fix` / `resolved`), stamps `resolved_at`, and appends a
Resolution section to `fix.md`.

## F. Summarize metrics

```powershell
& C:\Users\PC\agentic-workflow\scripts\summarize_metrics.ps1
```

Regenerates `metrics/summary.md` + `summary.json`: runs started/shipped, honest evidence rate
(shipped status alone does NOT count as evidence), must-fix + escaped-bug counts, open/resolved
failures, regressions added, failure classes, and average minutes over shipped/complete runs.

## Tests

`& C:\Users\PC\agentic-workflow\tests\run_tests.ps1` runs the full lifecycle plus one
regression per fixed bug against a throwaway `-Root`; exit 0 = all green.
