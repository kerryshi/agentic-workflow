# Task — 2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call

## Objective
Add a price-FAQ intent to the china-garden call agent. Callers asking the price of a menu item ('how much is General Tso's Chicken', 'what does the egg roll cost') currently get the generic fallback; they should get the item's price from data/menu.json. Follow the existing RuleBackend intent-pattern conventions in src/china_garden; handle unknown/ambiguous items gracefully (fallback or clarify, never invent a price); do not change the order/read-back flow. Validation: .venv/bin/pytest must stay green (92 baseline) and .venv/bin/ruff check . clean; add regression tests that fail before the fix and pass after.

## Repo
/Users/kerryshi/Projects/china-garden (branch: master)

## Risk
low

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: claude-code
- surface: harness (v2)
