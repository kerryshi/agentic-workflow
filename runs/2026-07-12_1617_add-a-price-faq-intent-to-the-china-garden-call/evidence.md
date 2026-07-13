# Evidence — 2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call

Verify stage ran 3 validation command(s) at 2026-07-12T16:58:25-04:00:

## `.venv/bin/pytest` — PASS
```
tests/test_backends.py .............                                     [ 11%]
tests/test_dialog.py ..........                                          [ 20%]
tests/test_faq.py ....                                                   [ 23%]
tests/test_menu.py ......                                                [ 28%]
tests/test_order.py .......                                              [ 34%]
tests/test_package.py .                                                  [ 35%]
tests/test_price_faq.py .......................                          [ 55%]
tests/test_review_regressions.py ....................................    [ 86%]
tests/test_safety_regressions.py ...............                         [100%]
============================= 115 passed in 0.05s ==============================
```

## `.venv/bin/ruff check .` — PASS
```
All checks passed!
```

## `printf 'how much is the general tso\nwhat does the wonton soup cost\nhow much is the pepperoni pizza\nquit\n' | .venv/bin/python -m china_garden.cli` — PASS
```
AGENT: Thanks for calling China Garden! I'm an automated assistant - I can answer questions and take your pickup order, or say 'person' anytime to talk to a human.
(type 'quit' to exit)
CALLER: AGENT: General Tso's Chicken is $12.50.   [OPEN]
CALLER: AGENT: Wonton Soup is $3.50 for a pint, $5.95 for a quart.   [OPEN]
CALLER: AGENT: Sorry, I'm not sure which item you mean - could you say it another way?   [OPEN]
CALLER:
```

Overall: PASS; working tree surprises: none
