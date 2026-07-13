# Regression

## Regression Test
`tests/run_tests.ps1::R3` (completion preserves hand-written evidence; appends its own section) and
`::R4` (re-complete without `-Force` refused; exactly one `run_completed`; `-Force` logs `run_amended`).

## Failing-First Evidence
Pre-fix (v1-review pass): completion overwrote a hand-written `HANDWRITTEN-EVIDENCE` marker, and a run
accumulated 8 `run_completed` events in `metrics/runs.jsonl`.

## Passing Evidence
Post-fix: append-only completion + `completed_at` idempotency guard; R3/R4 green in the 32/32 harness
(10/10 runs). Independently re-verified by an adversarial 9-invocation stress test (exactly 1
`run_completed`, 3 `run_amended`, hand-written markers survived).
