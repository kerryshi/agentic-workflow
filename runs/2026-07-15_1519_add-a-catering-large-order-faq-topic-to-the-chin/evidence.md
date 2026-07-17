# Evidence — 2026-07-15_1519_add-a-catering-large-order-faq-topic-to-the-chin

Native verify (harness-executed, no agent) ran 3 validation command(s) at 2026-07-15T15:54:54-04:00:

## `.venv/Scripts/python -m pytest -q` — PASS (exit 0)
```
........................................................................ [ 56%]
.......................................................                  [100%]
127 passed in 0.10s
```

## `.venv/Scripts/ruff check --no-cache .` — PASS (exit 0)
```
All checks passed!
```

## `echo "do you do catering?" | .venv/Scripts/python -m china_garden.cli` — PASS (exit 0)
```
AGENT: Thanks for calling China Garden! I'm an automated assistant - I can answer questions and take your pickup order, or say 'person' anytime to talk to a human.
(type 'quit' to exit)
CALLER: AGENT: We don't offer catering or large-party orders - but I'm glad to take a regular pickup order for you, or say 'person' if you'd like to talk to someone about it.   [OPEN]
CALLER:
```

Overall: PASS; working tree surprises: none
