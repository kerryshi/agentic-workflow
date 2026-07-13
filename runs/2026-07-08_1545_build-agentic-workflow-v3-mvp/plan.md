# Plan

## Approach
- TBD

## Constraints
- Preserve surrounding code style.
- Keep the diff scoped to the stated objective.
- Escalate product, API, data model, security, and irreversible decisions.

## Validation
- powershell -NoProfile -ExecutionPolicy Bypass -File scripts\summarize_metrics.ps1,git diff --check
