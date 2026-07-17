# Plan: Catering / large-order FAQ topic

## Goal
Add a `catering` FAQ topic that follows the existing hours/address/phone/delivery/payment pattern. Detection flows through the same intent classification (`_match_faq` in `backends.py`); the answer is data-backed from a new optional `catering` field in `data/restaurant.json`. Per Kerry (authoritative, 2026-07-15): China Garden does **not** offer catering/large orders — the confirmed `catering` value is a polite decline that offers a regular pickup order and points to the existing person-handoff. When the key is absent, callers get the standard safe fallback. Do not touch the allergen handoff path or the ordering flow. `dialog.py` needs no edits (it already routes `faq` intents generically).

## Ordered steps
1. **`data/restaurant.json`** — Add a confirmed `catering` string field holding the decline message, e.g. `"catering": "We don't offer catering or large-party orders - but I'm glad to take a regular pickup order for you, or say 'person' if you'd like to talk to someone about it."` This is confirmed family fact, not a placeholder (no invented lead times/minimums). Leave the `_comment` placeholder note as-is.
2. **`src/china_garden/faq.py`** — (a) Add `catering: str | None = None` as the **last** field of the frozen `Restaurant` dataclass (must be last since it's the only field with a default). (b) In `Restaurant.load`, add `catering=raw.get("catering")` so an absent key loads as `None`. (c) In `answer()`, add `if topic == "catering" and r.catering: return r.catering` before the final `return` — so an absent value falls through to the existing generic safe-fallback line (reused, not duplicated).
3. **`src/china_garden/backends.py`** — (a) Add `"catering"` to the `FAQ_TOPICS` tuple (this also extends the HaikuBackend topic enum, which is built from `FAQ_TOPICS`, keeping both backends consistent). (b) In `_match_faq`, add a `("catering", <pattern>)` entry to the topic loop matching catering/large-order phrasings, e.g. `r"\b(cater\w*|large order|big order|bulk order|party (tray|order|platter)|feed a (crowd|party))\b"`. Place it first in the loop so it takes priority. No collision with existing FAQ patterns (`\bpay\b` does not match inside `pickup`; `catering`/`big order` are absent from hours/delivery/address/phone patterns).
4. **`tests/test_catering_faq.py`** (new) — Mirror `test_price_faq.py` structure using the shared `menu`/`restaurant`/`session` fixtures from `conftest.py`:
   - **Topic detection (RuleBackend):** `backend.parse("do you do catering?", Context())[0]` has `kind == "faq"` and `topic == "catering"`; same for `"can I place a big order for pickup"`.
   - **Data-backed answer:** `faq.answer("catering", restaurant)` contains `"cater"` (case-insensitive) and is not the generic fallback (assert `"not sure about that one"` NOT in it); confirms the decline text loads from data.
   - **Absent-key fallback:** `dataclasses.replace(restaurant, catering=None)` then `faq.answer("catering", r)` contains `"person"` (the safe fallback).
   - **Dialog level:** `session.handle("do you do catering?")` returns the decline text, leaves `session.order.lines == []`, and does not enter HANDOFF (state stays `OPEN`) — proving the ordering flow and allergen/handoff paths are untouched.

## Files to touch
- `data/restaurant.json` (add confirmed `catering` field)
- `src/china_garden/faq.py` (dataclass field + load + answer branch)
- `src/china_garden/backends.py` (`FAQ_TOPICS` + `_match_faq` pattern)
- `tests/test_catering_faq.py` (new)
- **No change** to `dialog.py`, allergen path, or ordering flow.

## Validation (commands run in session, results reported)
1. Full suite green: `.venv\Scripts\python -m pytest -q`
2. Lint clean: `.venv\Scripts\ruff check --no-cache .`
3. CLI transcript evidence (AGENTS.md dialog rule): pipe a catering utterance through the interactive CLI, e.g. `"do you do catering?" | .venv\Scripts\python -m china_garden.cli` — expect the decline reply with state `[OPEN]` and no order created.

## Risks
- **Phrasing collision:** matching `big order`/`large order` could catch a genuine order like "a big order of fried rice" and emit the catering decline alongside any parsed item. Mitigation: keep the pattern scoped to catering-specific terms; `_match_faq` still returns `[faq, *items]` so the ordering flow itself is not broken, only the reply is chatty. Documented as accepted; wording example in task ("big order for pickup") requires matching `big order`.
- **Dataclass field ordering:** `catering` must be the last field (only one with a default) or Python raises at import. Covered in step 2.
- **Test brittleness:** assert on stable substrings (`"cater"`, `"person"`, absence of the generic fallback) rather than exact copy, so wording tweaks to the family-confirmed message don't break tests.
- **Absent-key fallback correctness:** `raw.get("catering")` yields `None` when absent; `answer()`'s `and r.catering` guard then falls through to the existing generic fallback — verified by the `replace(..., catering=None)` test.

## Validation commands
- .venv\Scripts\python -m pytest -q
- .venv\Scripts\ruff check --no-cache .
- "do you do catering?" | .venv\Scripts\python -m china_garden.cli
