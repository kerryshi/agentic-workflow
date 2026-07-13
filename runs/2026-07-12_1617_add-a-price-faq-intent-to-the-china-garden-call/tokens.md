# Harness report — 2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call

template: feature · builder: claude · reviewer: claude

| stage | status | agent | in tok | out tok | cache rd | cost USD | minutes | turns |
|---|---|---|---:|---:|---:|---:|---:|---:|
| grill | done | claude | 16 | 7292 | 363977 | 0.4491 | 1.5 | 14 |
| plan | done | claude | 24 | 27209 | 717735 | 0.9780 | 4.8 | 24 |
| approval | done | - | 0 | 0 | 0 | 0.0000 | 0.0 | 0 |
| build | done | claude | 56 | 20523 | 1955788 | 1.2587 | 3.7 | 36 |
| review | done | claude | 34 | 25094 | 1031662 | 1.0603 | 4.7 | 25 |
| build (fix) | done | claude | 52 | 21077 | 1652968 | 1.1180 | 4.2 | 31 |
| review | done | claude | 54 | 23166 | 1764004 | 1.1642 | 4.7 | 27 |
| verify | done | claude | 6 | 1712 | 104005 | 0.1169 | 0.3 | 5 |
| **total** | | | **242** | **126073** | | **6.1453** | **24.0** | |

> CORRECTION (2026-07-12, post-v2.1): this table under-reports the run — the schema-v1 pipeline overwrote re-run review rounds. True total per commands.jsonl events: USD 8.23 across 9 stage executions (4 review rounds, 2 missing above). v2.1 makes this impossible (append-only attempts).
