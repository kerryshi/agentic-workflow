# Plan: Handoff order briefing

## Goal
When the dialog hands off to a human (`allergen` or `request_human` intents) while an order is in progress, the `HANDOFF` `Reply` should carry a compact, caller-safe, structured order summary (item, qty, size, notes) plus a natural caller-facing line confirming the order is saved. No other states/intents change, and no internal notation (item ids, snake_case keys, etc.) reaches `reply.text`.

## Steps

1. **`src/china_garden/order.py`** — add `Order.summary()`:
   ```python
   def summary(self) -> list[dict[str, str | int]]:
       """Compact, caller-safe snapshot for a human handoff briefing."""
       return [
           {"item": line.item.name, "qty": line.qty, "size": line.size.name, "notes": line.notes}
           for line in self.lines
       ]
   ```
   Reuses `item.name` / `size.name` / `notes` — the same caller-safe fields `describe()` already uses, so no ids or internal codes leak. Empty order → `[]`.

2. **`src/china_garden/dialog.py`** — extend `Reply`:
   ```python
   @dataclass
   class Reply:
       text: str
       state: str
       done: bool = False
       order_summary: list[dict] | None = None
   ```
   Default `None` everywhere else, so non-handoff flows are provably unaffected.

3. **`src/china_garden/dialog.py`** — factor the two `HANDOFF` branches through one helper on `DialogSession`:
   ```python
   def _handoff(self, message: str) -> Reply:
       self.state = "HANDOFF"
       order_summary = self.order.summary() if self.order.lines else None
       text = message
       if order_summary:
           text += ("\nI've saved your order so far - the person you're speaking "
                     "with can see it.")
       return Reply(text, self.state, done=True, order_summary=order_summary)
   ```
   Then:
   ```python
   if intent.kind == "allergen":
       return self._handoff(self.restaurant.allergen_policy)
   if intent.kind == "request_human":
       return self._handoff("No problem - one moment while I get a person for you.")
   ```
   This is a pure refactor of the two existing branches (reuse, no behavior change when the order is empty) plus the new briefing when it isn't. `goodbye`'s own READ_BACK-before-hangup safeguard is untouched.

4. **`tests/test_handoff_briefing.py`** (new file, following the repo's existing convention of dedicated regression files like `test_safety_regressions.py`, `test_review_regressions.py`) — add tests that fail against current `main` (no `order_summary` attribute exists yet, so any access raises `AttributeError`, and today's handoff text has no confirmation line):
   - Allergen handoff **with** an order in progress: `reply.order_summary == [{"item": ..., "qty": ..., "size": ..., "notes": ...}]` matching what was ordered; `reply.text` contains a natural confirmation phrase (e.g. "saved"); `session.state == "HANDOFF"` and `reply.done`.
   - `request_human` handoff **with** an order in progress: same assertions.
   - Multi-line order (two different items, one with a size, one with notes) surfaces all lines correctly in `order_summary`.
   - Allergen / `request_human` handoff **with no order** (mirrors existing `test_dialog.py`/`test_review_regressions.py`/`test_safety_regressions.py` cases): `reply.order_summary is None` and no confirmation line is appended — i.e. behavior is byte-identical to today.
   - No internal notation leak: none of the menu item **ids** (e.g. `"egg_roll"`, `"general_tso"`) or dict-literal punctuation appear in `reply.text` — only `order_summary` (the structured field) carries the raw data.
   - Non-handoff reply untouched: after `add_item`/`done_ordering` (`ORDERING`/`READ_BACK` states), `reply.order_summary is None`, proving the field is handoff-only.

5. Run validation (see commands below); capture a CLI transcript showing an ordered-then-handoff flow per AGENTS.md's "dialog changes" evidence rule, e.g. piping `two egg rolls\nis there peanut oil in that\n` into `python -m china_garden.cli` and confirming the `AGENT:` line for the handoff turn includes the new confirmation sentence (the CLI only prints `reply.text`/`reply.state` today, not `order_summary`, since telephony surfacing is future work per the task — this is expected and consistent with "designed so the future telephony layer can surface it").

## Files to touch
- `src/china_garden/order.py` (add `Order.summary()`)
- `src/china_garden/dialog.py` (extend `Reply`, add `_handoff()` helper, update the two branches)
- `tests/test_handoff_briefing.py` (new regression tests)

## Validation commands
- `.venv/bin/pytest -q` — must show `115 passed` becoming `115 + N passed` (N = new tests), 0 failures.
- `.venv/bin/ruff check .` — must be clean.
- `printf 'two egg rolls\nis there peanut oil in that\n' | .venv/bin/python -m china_garden.cli` — CLI transcript evidence: the handoff turn's `AGENT:` line must show the allergen policy text plus the new order-saved confirmation line, with `[HANDOFF]` state.
- (Sanity, no-order path) `printf 'is there peanut oil in the lo mein\n' | .venv/bin/python -m china_garden.cli` — confirms no confirmation line/summary is added when there is no order, matching current behavior.

## Risks
- **Test coupling to exact wording**: existing tests assert substrings (`"person"`, `"hand you"`) in handoff text — appending text after the original message (not replacing it) preserves these substrings, but must double-check by running the full suite, not just the new file.
- **`order_summary` mutability**: returning `self.order.summary()` produces a fresh list of plain dicts (a snapshot), not a live reference to `order.lines`, so later order mutations after handoff (shouldn't happen since `done=True`, but defensively) won't retroactively alter a previously returned `Reply`.
- **Multi-intent turns**: `handle()` returns immediately when `state == "HANDOFF"` (dialog.py:47), so only the intent that actually triggers the handoff produces the final `Reply` — no risk of a later intent's `Reply` (without `order_summary`) silently overwriting the briefing within the same turn.
- **Scope creep**: must resist the urge to also surface `order_summary` in `ticket.py` or `cli.py` output — task only requires the field/line to exist on the `Reply` contract for a future telephony layer to consume; wiring it further is out of scope.
