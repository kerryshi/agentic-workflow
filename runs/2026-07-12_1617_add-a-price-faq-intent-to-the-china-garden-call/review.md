# Review — 2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call

Reviewer: fresh claude process — same agent as builder, no shared context (honest fallback)
Verdict: approve

## Must fix
- none

## Should fix
- tests/test_price_faq.py: No regression test covers a price question asked while state == READ_BACK. Manually verified safe (falls through to the generic fallback; order/state untouched) but there's no automated pin on that behavior.

## Notes
Implementation matches the plan closely. Ran .venv/bin/pytest -q (115 passed = 92 baseline + 23 new) and .venv/bin/ruff check . (clean) myself. Drove the CLI directly for single-size item, multi-size item (both prices, per clarification #1), unmatched item (graceful clarification, never invents a price), and multi-item questions (answers first-mentioned item, never silently adds the second item to the order, per clarification #2). Also verified order->price-question->read-back->confirm leaves the order/read-back flow untouched, and that a price question asked mid-READ_BACK degrades safely. Traced the regex fallback chain for tricky phrasings ('what's the cost of X') and the 'and'-masking for multi-word dish names (Hot and Sour Soup) — both correct. No must-fix issues found.
