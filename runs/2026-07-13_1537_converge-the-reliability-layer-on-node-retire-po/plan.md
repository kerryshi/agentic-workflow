# Plan

## Approach
- TBD

## Constraints
- Preserve surrounding code style.
- Keep the diff scoped to the stated objective.
- Escalate product, API, data model, security, and irreversible decisions.

## Validation
- npm test (harness)
- npx tsc --noEmit -p .
- 10x consecutive full-suite runs, 165/165
- Node-vs-PowerShell metrics parity on the real repo
- merge gate proven both ways through a real git merge
