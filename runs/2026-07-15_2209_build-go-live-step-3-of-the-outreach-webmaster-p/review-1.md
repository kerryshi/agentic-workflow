# Review — 2026-07-15_2209_build-go-live-step-3-of-the-outreach-webmaster-p (round 1)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- src/outreach_webmaster/db.py: At lines 620–639, sent_today_count() excludes SEND_FAILED even though the sender explicitly treats a transport exception as possibly delivered. A post-delivery exception can therefore free a daily slot and permit the daily cap to be exceeded later. Ambiguous failed claims must consume the cap.
- src/outreach_webmaster/outreach/send.py: At lines 253–261, the cap formula subtracts prior sends from both limits: min(--cap, daily_send_cap) - sent_today. Because --cap is a distinct per-run cap, it should be min(--cap, daily_send_cap - sent_today). For example, daily=20, --cap=5, and one prior send currently permits 4 rather than 5.
- src/outreach_webmaster/config.py: At lines 129 and 143, SMTP_PORT defaults to 587 before the live gate, so omitting SMTP_PORT still passes despite Kerry explicitly requiring the full env set. A malformed port also raises ValueError before live_blockers(), preventing the required refusal, preview, and exit 2.
- src/outreach_webmaster/outreach/send.py: At lines 175–185, complete-config validation uses raw truthiness. Whitespace-only SMTP/SENDER values pass; notably, a whitespace SENDER_ADDRESS authorizes live sending with no meaningful physical address in the footer. Values must be stripped and validated before satisfying the gate.

## Should fix
- src/outreach_webmaster/outreach/send.py: At lines 382–387, refused/dry-run output always reports daily_send_cap even when selection used --cap and today's remaining allowance. This makes the diagnostic preview report the wrong cap.
- src/outreach_webmaster/config.py: The SendConfig docstring still says --live is an unconditional guarded refusal; config.yaml and tests/test_send.py contain similar stale descriptions after the sender was implemented.

## Notes
Validation: ruff check passed; full pytest passed (379 tests, 3 warnings); send-focused pytest passed (45 tests); git diff --check had only existing LF/CRLF warnings; send/stop CLI help assertions passed; the real CLI dry-run exited 0. No live command or SMTP transport was invoked. Fake-only reproduction confirmed failed_claim_counted_today=0 and cap 5 becoming 4 after one prior send. One diagnostic command exited 1 because Windows retained its temporary SQLite handle during automatic cleanup; its reviewer-created temp directory was subsequently verified under data/ and removed.
