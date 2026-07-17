# Review — 2026-07-15_2209_build-go-live-step-3-of-the-outreach-webmaster-p (round 2)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: approve

## Must fix
- none

## Should fix
- src/outreach_webmaster/outreach/send.py: _effective_cap() returns a negative value for an invalid negative --cap. The refused dry-run then uses negative slicing, previewing all but the last lead while reporting the daily cap. Normalize invalid caps for diagnostic previews.

## Notes
All four prior findings are resolved. Failed claims consume daily capacity; the per-run cap formula is correct; SMTP_PORT must be explicitly valid and malformed values refuse cleanly; whitespace-only SMTP/SENDER values fail the gate. Validation: targeted regressions 18 passed; ruff check passed; full suite 399 passed with 3 unrelated deprecation warnings; malformed-port CLI run refused with exit 2. No email or SMTP connection was attempted.
