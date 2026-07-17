# Plan — collect-staleness health check (VS Code digest surface)

## Goal
Warn visibly when the last successful collect is older than **25 minutes**. The 2026-07-05 ICS outage ran **74.5h silently**: the Jetson's eth0 lost its lease, every fetch died, the 72h ranked window emptied, and the digest just "looked quiet." Per Kerry: the **staleness comparison lives in the engine (Python, pytest-covered)**; the **extension only renders the engine's verdict** onto (a) a warning-state status-bar badge and (b) a banner prepended to the digest markdown. No new command, no toast, no SSH log-mtime, no Jetson deploy path touched.

## Source of truth (already exists — no collect change needed)
`Store.health()['last_collect']` = `MAX(last_seen)` over items; `engine/cli.py`'s `status` subcommand already prints it. The gap is only that `top --json` never exposed it. So: compute a verdict from that existing value, emit it in the JSON, and render it.

## Ordered steps

### 1. `engine/digest.py` — the verdict + the banner (pure, testable)
- Add module constant `STALE_AFTER_MINUTES = 25`, with a comment tying it to the `*/20` collect cron (one missed cycle + slack) and the 74.5h silent outage.
- Add `collect_health(last_collect: str | None, now: datetime | None = None) -> dict` returning `{"last_collect", "age_minutes", "stale", "reason"}`:
  - `None` / unparseable / naive-datetime handling: unknown -> `stale=True`, `age_minutes=None`, `reason="unknown"` (unknown health = unhealthy).
  - naive ISO string -> assume UTC (defensive; `status`'s existing arithmetic would raise on a naive value).
  - `age > 25 min` -> `stale=True, reason="stale"`; otherwise `stale=False, reason="fresh"`.
  - `now` injectable so tests are deterministic (no clock-freezing dependency, matching the repo's plain-pytest style).
- Add `_stale_banner(health) -> str` producing a `>` blockquote, mirroring the existing `_unjudged` warning's shape/voice: e.g. `> \u26a0 **Collection may have stopped** \u2014 last successful collect was 74.5 h ago (threshold: 25 min). The items below are a frozen snapshot, not a quiet news day.` Unknown variant: "...last successful collect is unknown".
- `render_markdown(items, subtitle="", health=None)`: emit the banner **immediately after the subtitle and BEFORE the `if not items:` early return**. This is load-bearing \u2014 the outage's symptom was an *empty* digest, so a banner placed after the early return would miss the exact failure it exists to catch.
- `write(items, digest_dir, health=None)`: thread `health` through so `latest.md` / the timestamped digest carry the banner too. Keep both params optional -> backwards compatible with existing callers and tests.
- **Out of scope (deliberate):** `render_html` / `serve.py`. Kerry named the markdown surface + badge only. Noted as a follow-up, not silently done.

### 2. `engine/cli.py` — expose the verdict
- In `_emit_top`: after ranking, open a `Store(cfg.db_path)`, read `health()['last_collect']`, compute `collect_health(...)`, `store.close()` \u2014 mirroring the `status` subcommand's existing open/read/close pattern.
- Pass `health` into `render_markdown(...)` and `write(...)`.
- Add `"health": health` to the `--json` payload: `{digest_md, digest_markdown, health, items}`.
- Reuse `collect_health` in the `status` subcommand so the `last collect:` line gets a `\u26a0 STALE` marker \u2014 one threshold, one verdict, no drift between the two surfaces.

### 3. `tests/test_collect_health.py` (new) — pytest, repo style
Module docstring explaining the outage rationale (matching `test_markdown_digest.py`'s "why this guard exists" voice). Cases:
- fresh (5 min) -> `stale=False`; boundary: 25 min exactly -> not stale, 26 min -> stale.
- `None` -> stale, `reason="unknown"`; unparseable garbage -> stale, no raise.
- naive ISO timestamp -> treated as UTC, no raise (guards the `status` crash path).
- `render_markdown([], health=<stale>)` **contains the banner** \u2014 the empty-digest regression guard for the real outage shape.
- `render_markdown(items, health=<fresh>)` -> no banner; `health=None` -> no banner (existing callers unchanged).
- Store wiring: build a temp `Store`, upsert an item with an old `last_seen`, assert `collect_health(store.health()['last_collect'])` is stale.
- CLI wiring: monkeypatch `engine.cli.run_rank`/`attach_summaries` to return `[]`, capture stdout of `main(["top", "--json"])`, assert the parsed JSON has `health.stale`.

### 4. `extension/src/extension.ts` — render only
- `showTop`: read `result.health` from the parsed JSON; pass to `updateStatus(items, query, health)`.
- `updateStatus`: treat **missing or `stale !== false` as stale** (unknown = unhealthy, per clarification #4). Stale -> `statusItem.text = "$(warning) AI Signal \u2014 stale"` + `statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")`; fresh -> clear `backgroundColor = undefined` (must clear, or the warning sticks forever once shown).
- Prepend the engine's warning line to the tooltip MarkdownString; keep `isTrusted = false` untouched.
- Failure paths must **not** silently go idle: SSH non-zero exit and the JSON-parse `catch` currently call `idleStatus()` \u2014 give them a stale badge instead. That is the literal 2026-07-05 shape (unreachable Jetson) and the whole point of the check.
- `idleStatus()` clears `backgroundColor` so the pre-fetch state isn't a false alarm.
- The digest banner needs **no** extension code: it arrives inside `result.digest_markdown` and is already written to disk by `writeDigest`.

### 5. Rebuild the tracked artifact
`extension/out/extension.js` is tracked and CI compiles it (`npm run compile`); STATUS records regenerating it as the convention. Rebuild it.

### 6. `STATUS.md`
Move the health check from "deferred / next-up" to done; note it activates fully once the (still `JETSON_HOST`-blocked) deploy lands.

## Files to touch
- `engine/digest.py` \u2014 `STALE_AFTER_MINUTES`, `collect_health`, `_stale_banner`, `render_markdown`/`write` signatures
- `engine/cli.py` \u2014 `_emit_top` health read + JSON field; `status` reuse
- `tests/test_collect_health.py` \u2014 new
- `extension/src/extension.ts` \u2014 badge warning state + failure paths
- `extension/out/extension.js` \u2014 regenerated build artifact
- `STATUS.md` \u2014 deferred -> done

## Validation (all run unattended, non-zero on failure)
1. New + adjacent digest/store tests (fast, deterministic).
2. Full pytest suite \u2014 what CI runs. **Baseline measured this session: exit 0.** Slow (>2 min; live-source smoke that self-skips offline).
3. `tsc` compile of the extension \u2014 the extension half of CI.
4. Grep the regenerated `out/extension.js` for the warning-background marker, proving step 5 actually ran.
5. An inline assertion that a stale verdict banners an **empty** digest and a fresh one does not \u2014 the outage-shape guard, proven outside pytest too.

## Risks
- **The badge warns immediately, before the Jetson deploy \u2014 flagging a conflict in the clarifications.** #1 says the warning "simply activates once deployed"; #4 says unknown health = warn. A pre-deploy engine returns *no* `health` field = unknown = warn. I follow **#4** (explicit and on-point). Practical effect: the badge shows stale now \u2014 which is *truthful* (SSH is broken, collection isn't running), but it is a visible-now change, not a dormant one. If Kerry wants quiet-until-deploy, treat absent-`health` as fresh; that reintroduces exactly one silent-staleness window, so I default to warning.
- **`last_collect` is `MAX(last_seen)`, a proxy for "collect ran," not "collect succeeded."** A collect that runs but fetches nothing (the ICS outage: every source raised) does *not* advance `last_seen` \u2014 so it correctly reads stale. But a partial collect where one source succeeds *would* refresh it and mask the rest. Faithful to the existing `status` semantics; a true per-run success ledger is a bigger change and out of scope.
- **Clock skew / timezone.** The Jetson stamps `last_seen`; the comparison uses UTC. A skewed Jetson clock could read fresh-when-stale (or negative age). Naive timestamps are coerced to UTC defensively.
- **Threshold vs. the 20-min cron.** 25 min = one cycle + 5 min slack. A slow collect near the boundary could flap the badge between refreshes. Acceptable per the explicit spec.
- **`out/extension.js` diff noise** \u2014 a compiled artifact; unavoidable given it's tracked.
- **No TS test harness** exists, hence the engine-side logic; the extension change itself is covered only by `tsc` + the compile grep.

## Validation commands
- .venv/Scripts/python -m pytest tests/test_collect_health.py tests/test_markdown_digest.py tests/test_html_digest.py tests/test_store.py -q
- .venv/Scripts/python -m pytest -q
- .venv/Scripts/python -c "from datetime import datetime, timedelta, timezone; from engine.digest import collect_health, render_markdown, STALE_AFTER_MINUTES; now = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc); stale = collect_health((now - timedelta(hours=74.5)).isoformat(), now=now); fresh = collect_health((now - timedelta(minutes=5)).isoformat(), now=now); unknown = collect_health(None, now=now); assert stale['stale'] and unknown['stale'] and not fresh['stale']; assert STALE_AFTER_MINUTES == 25; empty = render_markdown([], health=stale); assert 'Collection may have stopped' in empty, 'stale banner missing from EMPTY digest (the 2026-07-05 outage shape)'; assert 'Collection may have stopped' not in render_markdown([], health=fresh); assert 'Collection may have stopped' not in render_markdown([]); print('OK: stale banner renders on empty digest; fresh/None stay silent')"
- cd extension && npm run compile
- grep -q 'statusBarItem.warningBackground' extension/out/extension.js && echo 'OK: out/extension.js regenerated with the warning badge state'
