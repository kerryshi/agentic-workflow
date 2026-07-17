# PLAN — GO-LIVE step 3: build the sender (cannot send by default)

## Goal

Replace the unconditional `--live` refusal in `outreach/send.py` with a real SMTP send path that is **structurally incapable of sending unless three independent gates all pass**:

1. explicit `--live` flag,
2. **complete** SMTP/sender env config (full transport set, per Kerry Q2),
3. an explicit per-run `--cap N` (per Kerry Q1; effective cap = `min(--cap, daily_send_cap)`).

Any gate failing → print which gate failed, show the send-free dry-run preview, return exit **2** (Kerry Q4). No flag at all → dry-run, exit 0. Plus the full GO-LIVE step-3 checklist (Kerry Q3): send-time DNC re-check, atomic record-before-send idempotency, cap counted from actually-sent-today, forward-only advance to `sent`, footer test, kill switch. **No test or verification step may send email or open an SMTP socket.**

## Ordered steps

### 1. `db.py` — the send ledger (enables idempotency + real cap counting)

Append to `SCHEMA` (additive; `CREATE TABLE IF NOT EXISTS`, so `init_db` migrates existing DBs with no data touched):

```sql
CREATE TABLE IF NOT EXISTS sends (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL,
    to_email   TEXT NOT NULL,
    subject    TEXT,
    state      TEXT NOT NULL DEFAULT 'claimed',   -- claimed | sent | failed
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lead_id),
    FOREIGN KEY(lead_id) REFERENCES leads(id)
);
```

Three helpers, in the style of the existing `add_dnc` / `outcome_exists` / `contacted_today_ids`:

- `claim_send(lead_id, to_email, subject, path) -> bool` — `INSERT OR IGNORE`; returns `cur.rowcount > 0`. **This is the record-before-send atom.** True = we own the claim and may transmit; False = already claimed → skip. A crash between claim and transmit leaves a `claimed` row, so a retry skips that lead rather than re-sending (GO-LIVE: "a crash mid-batch must not re-send on retry"). `UNIQUE(lead_id)` makes this crash-safe without a transaction spanning the socket.
- `mark_send(lead_id, state, path)` — set `state` to `sent` or `failed` after transmission.
- `sent_today_count(path) -> int` — `SELECT COUNT(*) FROM sends WHERE state IN ('claimed','sent') AND date(created_at,'localtime')=date('now','localtime')`. Counts `claimed` as well as `sent`: a crashed claim consumes a cap slot, which errs toward under-sending.

### 2. `outreach/send.py` — gates

- **Widen `missing_for_live(cfg)`** to the full transport set: `SMTP_HOST`, `SMTP_PORT` (validated as a positive int, since config defaults it to 587 and it can never be `None`), `SMTP_USER`, `SMTP_PASSWORD`, `SENDER_EMAIL`, `SENDER_NAME`, `SENDER_ADDRESS (CAN-SPAM)`. Kerry: the gate must prove the send can actually work.
- **New `live_blockers(cfg, cap, path) -> list[str]`** — the single source of truth for "may this run send?". Returns human-readable reasons: each missing env var; `"--cap N not given (required for --live)"` when `cap is None`; `"--cap must be > 0"`; `"kill switch engaged (data/STOP)"`. Empty list = permitted.

### 3. `outreach/send.py` — kill switch

`STOP_FILE = Path("data/STOP")` + `stop_engaged()`, `engage_stop(reason)`, `release_stop()`. Kept in `send.py` (AGENTS.md: reuse before creating new modules). Checked **before the run and again before every single message** in the live loop, so `stop` in another terminal halts an in-flight batch — that is the "stops everything mid-campaign" requirement.

### 4. `outreach/send.py` — the live path

Signature: `send_batch(live=False, settings=None, path=db.DEFAULT_DB, cap=None, transport=None)`.

`transport: Callable[[Email], None] | None` is injected purely for testability; the real one is only built **inside** the permitted-live branch, so the dry-run path never imports/constructs `smtplib` at all.

Control flow:

1. Compute `effective_cap = max(0, min(cap, settings.daily_send_cap) - db.sent_today_count(path))` when `cap` is given; dry-run with no `--cap` previews against `daily_send_cap` as today.
2. `sel = select_recipients(db.all_leads(path), effective_cap, lambda v: db.is_dnc(v, path))`.
3. If `not live` → preview only, return 0. Untouched behavior.
4. If `live` and `live_blockers(...)` non-empty → print the failed gates, fall through to the preview, return **2**.
5. If `live` and no blockers → `db.init_db(path)` (idempotent; creates `sends` on an older DB), then per lead:
   - `stop_engaged()` → abort the rest of the batch;
   - **re-check DNC now** with a fresh `db.is_dnc` query on `dnc_keys(lead)` (the list can change between selection and send) → skip;
   - `lead_id = db.find_lead(lead.source, lead.source_id, path=path)["id"]`;
   - `db.claim_send(...)` → False means already sent, skip;
   - `transport(email)`;
   - success → `db.mark_send(lead_id, "sent")` + `db.set_status(lead_id, Status.SENT, path)` (**forward-only, no `force`**);
   - failure → `db.mark_send(lead_id, "failed")`, count the error, keep the claim (no silent auto-retry).
6. Exit codes: `0` clean dry-run or clean live send; `2` live requested but refused; `1` live send with transmission errors.

`_smtp_send(cfg)` builds the real transport: `email.message.EmailMessage` (`From: "{sender_name} <{sender_email}>"`, `To`, `Subject`, body from `render_email`, which already appends the CAN-SPAM footer unconditionally), over `smtplib.SMTP(host, port)` → `starttls()` → `login()` → `send_message()`.

### 5. `cli.py`

- `send` gains `--cap N` (`type=int, default=None`), help text stating it is **required** for `--live`.
- `_send(settings, *, live, cap)` passes it through; `main` reads `args.cap`.
- New `stop` stage in `STAGES`: engages the kill switch; `stop --release` clears it. One command, as GO-LIVE requires.
- Update the module docstring line 4 ("`send` is dry-run by default and refuses `--live`") to describe the gated behavior.

### 6. Tests (nothing may send)

- **`tests/conftest.py` (create or extend): an autouse fixture poisoning `smtplib.SMTP` and `smtplib.SMTP_SSL` to raise across the whole suite.** This makes "no test ever sends" mechanical rather than a promise — any accidental real transport is a hard test failure, not an outbound email.
- **`tests/test_send.py`**: update `test_send_batch_live_is_refused_and_changes_nothing` — it asserts the literal `"--live is refused"`, which changes. Keep `rc == 2` and the DB-untouched assertion; assert the new gate-naming output. Update, do not delete.
- **`tests/test_send_live.py` (new)**, all with an injected fake transport:
  - `--live` without `--cap` → rc 2, nothing sent, status still APPROVED;
  - `--live --cap 5` with incomplete env → rc 2, names the missing vars, nothing sent;
  - dry-run never invokes the transport (inject one that raises);
  - all gates pass → transport called, status advances to SENT, `sends` row is `sent`;
  - **footer test**: every body handed to the transport contains `OPT_OUT_LINE` and `sender_address`;
  - idempotency: a second run re-sends nothing (claim blocks it);
  - crash simulation: transport raises mid-batch → retry does not re-send that lead;
  - effective cap = `min(--cap, daily_send_cap)` and is reduced by `sent_today_count`;
  - send-time DNC re-check: lead added to DNC after selection is not sent;
  - kill switch: engaged → refused; engaged mid-batch → remaining leads unsent.

### 7. `docs/GO-LIVE.md`

Update the headline and Step 3 to reflect that the sender now exists behind the three gates, and what still stands between it and a real send (steps 1/2: domain, SPF/DKIM/DMARC, env). Do not overstate — the offline prerequisites are unchanged.

## Files to touch

| file | change |
|---|---|
| `src/outreach_webmaster/db.py` | `sends` table + `claim_send` / `mark_send` / `sent_today_count` |
| `src/outreach_webmaster/outreach/send.py` | gates, kill switch, live loop, `_smtp_send` |
| `src/outreach_webmaster/cli.py` | `--cap`, `stop` stage, `_send` wiring, docstring |
| `tests/conftest.py` | autouse SMTP-poison fixture (create or extend) |
| `tests/test_send.py` | update the refusal test to the new gate output |
| `tests/test_send_live.py` | new — the gate/idempotency/DNC/cap/footer/kill-switch contract |
| `docs/GO-LIVE.md` | Step 3 status |

## Validation

Run from repo root; all non-interactive, all exit non-zero on failure. Per AGENTS.md I will report the exact commands and their real output, including failures.

1. `.venv/Scripts/ruff check .`
2. `.venv/Scripts/python -m pytest -q` — full suite (315 tests today; must not regress)
3. `.venv/Scripts/python -m pytest tests/test_send.py tests/test_send_live.py -q` — the send contract
4. `.venv/Scripts/python -m outreach_webmaster send --help | grep -q -- '--cap'` — the required flag is wired
5. `.venv/Scripts/python -m outreach_webmaster stop --help > /dev/null` — the kill switch is a real command

Commands 4/5 use `--help` only: they touch no DB and no network. The no-send property is proven by the autouse SMTP poison in `conftest.py` (any socket attempt fails the suite) plus the explicit dry-run-never-calls-transport test — not by observing an absence.

## Risks

1. **DB schema change (new `sends` table).** AGENTS.md lists schema as an escalation. Kerry's answer #3 authorizes idempotency + actually-sent-today counting, neither of which is possible without persistence. Mitigation: purely additive (`CREATE TABLE IF NOT EXISTS`), no existing table or column altered, forward-migrates via the existing `init_db`. **Flagging explicitly for the review stage.**
2. **A real SMTP path now exists in the repo** — the irreversible-damage path GO-LIVE warns about. Mitigated by the three gates sharing one `live_blockers` chokepoint, the transport being constructed only inside the permitted branch, and the suite-wide SMTP poison.
3. **`UNIQUE(lead_id)` means one email per lead, ever.** Correct for first-touch cold outreach and the strongest idempotency guarantee, but a future follow-up sequence will need this relaxed. Deliberate; noted.
4. **A failed send keeps its claim** → no automatic retry; an operator must clear it. Errs toward under-sending, which is the safe direction.
5. **`sent_today_count` counts `claimed`** → a crashed claim permanently consumes a cap slot for that day. Conservative by design.
6. **The kill switch is a cooperative file** in gitignored `data/`, honored only by this process between messages — it cannot abort a transmission already in flight, and it is not an OS-level kill.
7. **`SMTP_PORT` can never be literally absent** (config defaults it to 587), so that gate validates a positive int rather than env presence. Slight deviation from a strict reading of Kerry's Q2; called out so it can be overridden.
8. **Existing test churn**: `tests/test_send.py:181` pins the old refusal string and will be updated in place.

## Validation commands
- .venv/Scripts/ruff check .
- .venv/Scripts/python -m pytest -q
- .venv/Scripts/python -m pytest tests/test_send.py tests/test_send_live.py -q
- .venv/Scripts/python -m outreach_webmaster send --help | grep -q -- '--cap'
- .venv/Scripts/python -m outreach_webmaster stop --help > /dev/null
