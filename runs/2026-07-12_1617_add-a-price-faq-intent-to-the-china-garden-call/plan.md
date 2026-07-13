## Plan: price-FAQ intent for menu items

**Goal:** callers asking "how much is X" / "what does X cost" get the price straight from `data/menu.json` via a new `item_price` intent, added following the existing `RuleBackend` pattern-matching conventions. Order/read-back flow untouched.

### Design decisions
- New `Intent` kind `"item_price"` (added to `KINDS`, required since `Intent.__post_init__` silently downgrades any kind not in `KINDS` to `"unknown"`).
- `RuleBackend` gets a new `_match_item_price(text)` matcher, hooked in right after the existing `_match_faq` check (same priority slot as generic FAQ, before `done`/`remove`/`set_qty`/`add`) — price questions don't collide with allergen/human/card/goodbye/FAQ keywords, and this slot sits after the READ_BACK short-circuit so the read-back flow is untouched.
- Item extraction: try three regexes in order — `"how much is/are/does/do X"`, `"what('s/is/are/does/do) X cost"`, `"price/cost of/for X"` — capture the item substring, strip filler via the existing `_STRIP` regex, then resolve with `self.menu.find(...)` (same fuzzy/ambiguity-guard lookup `add_item` already uses — ambiguous queries like bare "chicken" already return `None` from `Menu.find`, so ambiguity handling is free).
- Only emit the intent when `menu.find` resolves an item — mirrors how `_parse_items` only emits `add_item` when a match is found. An unmatched item produces no intent, so the utterance falls through to the existing generic "Sorry, I didn't catch that..." fallback — satisfies "never invent a price" and "fallback or clarify" with zero new fallback text needed.
- Multi-size items (wonton soup, hot & sour soup, chicken fried rice, chicken lo mein, white rice): state both prices in one reply, per clarification #1.
- Single utterance = single item, per clarification #2 — no multi-item pricing logic added.
- Price text formatting lives in `menu.py` as a new `price_text(item)` function (mirrors `order.py`'s `describe()`/`read_back()` owning their own `fmt_cents`-based formatting).
- `dialog.py._apply` gets one new `intent.kind == "item_price"` branch: resolve via `self.menu.find` (same double-resolution pattern as `add_item`/`remove_item`/`set_qty`, needed so `HaikuBackend` — which doesn't pre-validate — is handled too), reply with `price_text(item)`, or a "not sure which item" clarification if unresolved. This branch is exercised directly by a stub-Intent regression test (RuleBackend itself won't reach it, same as `add_item`'s not-found branch today).

### Ordered steps
1. `src/china_garden/backends.py`
   - Add `"item_price"` to `KINDS`.
   - Add `_PRICE_QUESTION_PATTERNS` tuple (3 regexes above) near the other module-level patterns.
   - Add `RuleBackend._match_item_price(text) -> Intent | None`.
   - Hook into `RuleBackend.parse()` right after the `_match_faq` block: `price = self._match_item_price(text); if price: return [price, *self._parse_items(text)]`.
   - Update the module docstring's priority ordering comment to include price after FAQ.
   - Optionally add one line to `HaikuBackend`'s system prompt noting `kind=item_price` for price questions (KINDS is shared with its tool schema, so leaving the LLM backend silent about it is a minor consistency gap worth one line).
2. `src/china_garden/menu.py`
   - Import `fmt_cents` from `.money`.
   - Add `price_text(item: MenuItem) -> str`: single line for single-size items, comma-joined "$X.XX for a {size}" clauses for multi-size items.
3. `src/china_garden/dialog.py`
   - Import `price_text` alongside `Menu`.
   - Add the `item_price` branch in `_apply` (resolve → reply with price or clarification).
4. Tests — new `tests/test_price_faq.py` (mirrors `test_faq.py`/`test_menu.py` layout, local `backend` fixture like `test_backends.py`):
   - Backend-level: single-size item price question → `kind == "item_price"`, correct `item_query`; multi-size item question → same; alias phrasing ("what does the egg roll cost"); unmatched item (e.g. "how much is the pepperoni pizza") → falls through, no `item_price` intent produced.
   - Dialog-level: "how much is General Tso's Chicken" → reply contains "$12.50", `session.order.lines == []`; "what does the wonton soup cost" → reply contains both "$3.50" and "$5.95"; unknown item → reply contains no "$" and order stays empty; a StubBackend-style test constructing `Intent("item_price", item_query="pepperoni pizza")` directly to prove the dialog-level not-found branch never invents a price.
   - Confirm pre-existing `test_price_and_availability_questions_do_not_add` (in `test_review_regressions.py`) still passes unmodified.
5. Evidence — run a manual CLI transcript (no file changes) per AGENTS.md's "Dialog changes: paste a CLI transcript" rule:
   `printf 'how much is the general tso\nwhat does the wonton soup cost\nhow much is the pepperoni pizza\nquit\n' | .venv/bin/python -m china_garden.cli`
6. Run full validation suite; fix any lint issues before calling it done.

### Files to touch
- `src/china_garden/backends.py`
- `src/china_garden/menu.py`
- `src/china_garden/dialog.py`
- `tests/test_price_faq.py` (new)

### Validation commands
- `.venv/bin/pytest` (expect 92 baseline + new tests, all green)
- `.venv/bin/ruff check .` (clean)
- `printf 'how much is the general tso\nwhat does the wonton soup cost\nhow much is the pepperoni pizza\nquit\n' | .venv/bin/python -m china_garden.cli` (transcript evidence)

### Risks
- Regex over-matching: "price"/"cost of" patterns could false-positive on unrelated phrasing (e.g. a hypothetical "cost of delivery" colliding with the delivery FAQ) — mitigated by trying the existing FAQ matcher first in `parse()`, so topic FAQs still win ties.
- `_STRIP`-based item extraction may leave stray words for oddly-phrased questions, causing `menu.find` to miss and silently fall back to the generic "didn't catch" message instead of a price-specific clarification — acceptable per clarification #1's "fallback or clarify" allowance, but worth flagging since it's a UX tradeoff, not a bug.
- Combining `[price, *self._parse_items(text)]` (mirroring the FAQ pattern) means a single utterance that both asks a price and orders something else will do both — outside the two clarified scenarios; low risk since it reuses already-tested `_parse_items` logic unchanged.
