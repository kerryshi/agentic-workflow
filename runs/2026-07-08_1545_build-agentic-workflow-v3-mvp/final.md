# Final

## Outcome
Built the Agentic Workflow v3 MVP reliability layer in the agentic-workflow repo.

## Status
shipped

## Files Changed
- .gitignore
- docs/
- docs/path-conventions.md
- docs/permission-policy.md
- docs/workflows.md
- failures/
- failures/.gitkeep
- HANDOFF.md
- metrics/
- metrics/runs.jsonl
- metrics/summary.json
- metrics/summary.md
- PORTFOLIO.md
- PRD.md
- README.md
- runs/
- runs/.gitkeep
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/commands.jsonl
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/diff.patch
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/evidence.md
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/final.md
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/plan.md
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/review.md
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/run.json
- runs/2026-07-08_1545_build-agentic-workflow-v3-mvp/task.md
- scripts/
- scripts/capture_failure.ps1
- scripts/complete_run.ps1
- scripts/new_run.ps1
- scripts/summarize_metrics.ps1
- templates/
- templates/failure-case.md
- templates/postmortem.md
- templates/run-record.md
- templates/ship-report.md
- USAGE.md

## Validation / Evidence
Dogfood run record created and completed; metrics regenerated; parser validation passed for all scripts; git diff --check passed.

## Reviewer Result
Manual validation: PowerShell parser reported syntax OK for all scripts; git diff --check returned clean with CRLF normalization warnings only.

## Risks
Global Claude config was not mutated; /ship integration remains a deliberate follow-up.

## Follow-ups
Use v3 records on the next substantial task, then update the active /ship skill if this flow feels right.
