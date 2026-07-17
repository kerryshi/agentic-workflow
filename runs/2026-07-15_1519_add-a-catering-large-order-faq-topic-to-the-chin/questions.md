# Grill questions

Answer inline under each question, then resume the run.

1. Should data/restaurant.json ship WITHOUT a catering value for now — so production callers get the safe fallback and the data-backed answer is proven only via a test fixture — rather than me inventing customer-facing catering policy wording (lead time / minimums / whether they even cater), which AGENTS.md treats as a family/escalation call?
   A: No - ship WITH a confirmed catering value. Owner confirmed 2026-07-15: China Garden does NOT offer catering or large-order service. Store that as data in restaurant.json (a catering field whose confirmed value means 'none'), and have the agent politely decline, offer the regular menu, and offer a handoff to a person if the caller pushes. This is confirmed fact from the family, not a placeholder; do not invent lead times or minimums. Keep the safe fallback for repos/data files where the field is absent.
