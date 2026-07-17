# Task — 2026-07-15_1519_add-a-catering-large-order-faq-topic-to-the-chin

## Objective
Add a catering / large-order FAQ topic to the china-garden call agent. Callers ask 'do you do catering?' or 'can I place a big order for pickup?'. Follow the existing faq.py topic pattern (hours/address/phone/delivery/payment): answer from a new optional catering field in data/restaurant.json, with the standard safe fallback when the key is absent, and route detection through the same intent classification as the other FAQ topics in dialog.py. Do not touch the allergen handoff path or the ordering flow. Validation: full pytest suite stays green; new unit tests cover topic detection, the data-backed answer, and the absent-key fallback.

## Repo
C:/Users/PC/china-garden (branch: master)

## Risk
medium

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: codex
- surface: harness (v2)
