# Classification

- Failure class: weak_verification
- Severity: must_fix
- Prevention layer: project test + code fix (scripts/complete_run.ps1)

## Root Cause
`complete_run` treated `evidence.md`/`review.md` as output files (whole-file write) rather than
run-time working docs, and had no idempotency guard on the completion event. Re-running it — which is
normal (amend an outcome, re-capture a diff) — therefore both clobbered hand-filled evidence and
double-logged the metric. The deeper gap was verification: the completion path shipped without a
lifecycle test that ran completion twice. Fix: append (never overwrite) a Completion section, and gate
on `completed_at` so a repeat refuses without `-Force` and logs `run_amended` with it.

## Contributing Factors
- No guard on `completed_at`; no distinction between first completion and an amend.
- Markdown artifacts were written, not appended.
- The MVP's own single-completion dogfood run masked it until re-completion was exercised.
