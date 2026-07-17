# Review — 2026-07-15_1519_add-a-catering-large-order-faq-topic-to-the-chin (round 1)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: approve

## Must fix
- none

## Should fix
- src/china_garden/backends.py: Catering detection only matches singular forms such as "large order" and "party tray"; natural plural requests like "do you take large orders?" and "do you have party trays?" return unknown.
- tests/test_catering_faq.py: The absent-key test replaces the loaded value with None, so it does not verify that Restaurant.load accepts JSON where the catering key is genuinely absent. An absent-key fixture would protect the optional-loading contract.

## Notes
Core requirements work correctly. Full pytest: 127 passed. Ruff: all checks passed. CLI returned the data-backed decline in OPEN state. A mocked load with the catering key removed produced None and the standard safe fallback. No allergen, ordering, or dialog-flow code was changed.
