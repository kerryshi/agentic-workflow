# Evidence — 2026-07-12_1811_add-a-handoff-briefing-to-the-china-garden-call

Native verify (harness-executed, no agent) ran 4 validation command(s) at 2026-07-12T18:16:36-04:00:

## `.venv/bin/pytest -q` — PASS (exit 0)
```
........................................................................ [ 59%]
..................................................                       [100%]
122 passed in 0.05s
```

## `.venv/bin/ruff check .` — PASS (exit 0)
```
All checks passed!
```

## `printf 'two egg rolls\nis there peanut oil in that\n' | .venv/bin/python -m china_garden.cli` — PASS (exit 0)
```
AGENT: Thanks for calling China Garden! I'm an automated assistant - I can answer questions and take your pickup order, or say 'person' anytime to talk to a human.
(type 'quit' to exit)
CALLER: AGENT: Got it - 2 Egg Roll. Anything else?   [ORDERING]
CALLER: AGENT: For any allergy or ingredient-safety question I need to hand you to a person - your safety matters too much for me to guess.
I've saved your order so far - the person you're speaking with can see it.   [HANDOFF]
```

## `printf 'is there peanut oil in the lo mein\n' | .venv/bin/python -m china_garden.cli` — PASS (exit 0)
```
AGENT: Thanks for calling China Garden! I'm an automated assistant - I can answer questions and take your pickup order, or say 'person' anytime to talk to a human.
(type 'quit' to exit)
CALLER: AGENT: For any allergy or ingredient-safety question I need to hand you to a person - your safety matters too much for me to guess.   [HANDOFF]
```

Overall: PASS; working tree surprises: none
