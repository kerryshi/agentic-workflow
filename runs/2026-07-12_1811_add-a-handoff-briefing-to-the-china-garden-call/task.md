# Task — 2026-07-12_1811_add-a-handoff-briefing-to-the-china-garden-call

## Objective
Add a handoff briefing to the china-garden call agent. When the dialog hands off to a human (caller says 'person', ingredient/allergen questions, etc.) and the session has an order in progress, the HANDOFF reply currently carries no order context - the human picking up is blind. Brief them: expose a compact order-so-far summary (items, qty, size, notes) at handoff time, designed so the future telephony layer can surface it to the human (e.g. a structured field on the reply or session, plus a natural caller-facing line confirming the order is saved). Do not change non-handoff flows; never leak internal notation to the caller. Validation: .venv/bin/pytest stays green (115 baseline) and .venv/bin/ruff check . clean; add regression tests that fail before the change.

## Repo
/Users/kerryshi/Projects/china-garden (branch: price-faq-intent)

## Risk
low

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: claude-code
- surface: harness (v2)
