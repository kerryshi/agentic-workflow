# Grill questions

Answer inline under each question, then resume the run.

1. Is the 'per-run send cap' a new required CLI argument (e.g. --cap N) distinct from config.yaml's daily_send_cap that must be explicitly passed for any live run, and should a live send use the minimum of the per-run cap and daily_send_cap? Or does it just mean the existing daily_send_cap?
   A: New REQUIRED --cap N argument, distinct from daily_send_cap. Any live run must explicitly pass it; effective cap = min(--cap, daily_send_cap). Forgetting the flag means no send. [Kerry, 2026-07-16]

2. For the live gate, does 'complete env config' require the full SMTP transport set (SMTP_HOST/PORT/USER/PASSWORD plus SENDER_EMAIL/NAME/ADDRESS), or should it keep the existing missing_for_live() 3-variable check (SMTP_HOST, SENDER_EMAIL, SENDER_ADDRESS)?
   A: Full SMTP transport set required: SMTP_HOST/PORT/USER/PASSWORD plus SENDER_EMAIL/NAME/ADDRESS. The gate must prove the send can actually work; a partial pass that crashes at send time is a weaker gate than no gate. [Kerry, 2026-07-16]

3. Should this build implement the full GO-LIVE Step 3 checklist — send-time DNC re-check, idempotency (atomic record-before-send so a crash can't re-send), cap counted from what was actually sent today, forward-only status advance to 'sent', footer test, and a kill-switch command — or is the target minimal (SMTP send + the three gates + dry-run default) with those deferred?
   A: Full checklist: send-time DNC re-check, atomic record-before-send idempotency, cap counted from actually-sent-today, forward-only status advance, footer test, and kill-switch command. This code touches real inboxes — every deferred item is a real-world incident class. [Kerry, 2026-07-16]

4. When --live is passed but a gate fails (incomplete env or missing per-run cap), should the sender keep the current behavior of printing the guard, showing the dry-run preview, and returning exit 2, or hard-error without previewing?
   A: Keep current behavior: print which gate failed, show the dry-run preview, return exit 2. The preview is send-free and diagnostic. [Kerry, 2026-07-16]
