# Evidence

## Commands
| Command | Result | Notes |
|---|---|---|
| `harness: npx vitest run` | 29/29 green | unit + engine state machine (mock driver) |
| `harness: npx tsc --noEmit` | clean | strict, exactOptionalPropertyTypes |
| `harness: npm run build` | clean | dist/ regenerated after plan.md dedup fix |
| `tests\run_tests.ps1` | **64 passed / 0 failed** | v1 PS harness untouched by v2 |
| `scripts\summarize_metrics.ps1` | parsed harness-written records unchanged | 11 runs started / 10 complete |

## Proof
- Proof run: `runs/2026-07-10_2017_fix-the-failing-test-median-returns-the-wrong-va/` — bugfix
  pipeline e2e via live `claude -p` (sonnet): repro → plan → **parked at approval, process
  exited** → `resume --approve` in a fresh process → build → review → verify → completed.
- Fix landed: fixture `src/stats.js` +3 lines only, test file untouched, `npm test` 3/3 pass —
  re-verified outside the pipeline.
- Reviewer (fresh-claude fallback, independence recorded in review.md) drove `npm test` itself
  before approving. Park/resume across processes: **proven** (v2 success criterion).
- Token/cost vs unharnessed single-call baseline (same task/model):
  harness 4,997 out-tok / $0.69 / 25 turns vs baseline 873 out-tok / $0.16 / 6 turns.
  **Honest verdict: ~4.3× overhead on a trivial task** (five fresh contexts re-read the repo).
  The savings hypothesis (lean staged briefs beating one long wandering conversation) is only
  testable on a real-size task and remains unproven. Per-stage: that run's `tokens.md`.
- Codex: CLI absent (`~/.codex` auth exists from Codex Desktop); installing `@openai/codex`
  is a package-install approval item — driver stub reports unavailable honestly.

## Artifacts
- `harness/` (src, tests, dist), `docs/orchestration.md`, PRD §4, USAGE cheat-sheet row
- proof-run folder incl. `pipeline.json`, `tokens.md`, `PARKED.md` lifecycle
- commits: c45b16e (spec) · 609b495 (skeleton+driver) · 48f7ed4 (engine) · c916699 (proof)


## Completion (2026-07-11T05:39:21-04:00)

_No summary passed to complete_run._

### Evidence links
- (none passed)