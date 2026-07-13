# Plan

## Approach
1. Multi-agent review (5 dimensions + adversarial verification) over PRD.md, the four
   scripts, docs, templates, and the dogfood run data.
2. Apply confirmed must-fix/should-fix findings to scripts and docs.
3. Reconcile PRD.md with the implementation (schemas, layout, taxonomy, roadmap state);
   bump status from "Draft for critique" to accepted-v1.
4. v1 build-out beyond bug fixes:
   - tests/run_tests.ps1 — self-contained smoke + regression harness for all four scripts
     (runs against a temp sandbox, never the real runs/failures/metrics data).
   - Wire the /ship skill to the run-record lifecycle (complete_run + capture_failure steps).
   - Clean MVP-era data pollution (duplicate run_completed events) with provenance noted.
5. Complete this run record via complete_run.ps1; regenerate metrics; update HANDOFF/README/USAGE.
6. Local commit of v1 (no push — remotes are per-project and opt-in).

## Constraints
- Preserve surrounding code style (PS 5.1-safe, StrictMode-clean).
- Keep the diff scoped to the stated objective.
- No new daemons, no database, no outward-facing actions.
- Escalate product, API, data model, security, and irreversible decisions.

## Validation
- tests\run_tests.ps1 (new harness) — all pass
- summarize_metrics.ps1 regenerates cleanly
- fresh reviewer pass over the final diff
