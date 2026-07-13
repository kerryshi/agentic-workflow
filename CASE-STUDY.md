# Case study: making an agent harness pay for itself

How the pipeline harness went from **4.3× more expensive than no harness at all** to **60% cheaper
than its own baseline** — and what the failure in between actually taught.

Every number here is reproducible from the run records in [`runs/`](runs/).

---

## 1. The hypothesis, and why it was wrong

The harness splits a coding task into stages — grill, plan, build, review, verify — and runs each in
a **fresh agent context**. The reasoning was sound: a fresh reviewer has no stake in the code and no
memory of having written it, which is exactly what makes the review worth anything.

The hypothesis was that fresh, narrow contexts would also be *cheaper* than one long conversation
that drags an ever-growing history behind it.

**That was wrong, and the first measurement said so.**

On a trivial fixture task (a one-line median bug), run
[`2026-07-10_2017`](runs/2026-07-10_2017_fix-the-failing-test-median-returns-the-wrong-va/):

| | cost |
|---|---:|
| unharnessed `claude -p` | $0.16 |
| through the harness | **$0.69** |

**4.3× worse.** Five stages each opened a fresh context and re-read the repository, so the harness
bought the same context five times over. I published the number and moved on to the real test,
because a trivial task is exactly where a harness *should* look worst — the overhead is fixed and
there is no defect for it to catch.

## 2. The real test, where it got worse and simultaneously proved its worth

Run [`2026-07-12_1617`](runs/2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call/) — a
genuine feature on a real project: add a price-lookup intent to a restaurant phone-order agent.

**Cost: $8.23.** Roughly 5× what the task would have cost solo. Of that, **$4.30 was review rounds**
— four of them.

And it was worth it.

The building agent wrote the feature *and* 23 new tests for it. The suite was green — 115 passing.
The independent review stage caught two defects those tests did not:

**Bug 1 — a price question silently mutated a live order.**
`RuleBackend.parse` chained `*self._parse_items(text)` after an `item_price` match. So a customer
asking *"how much are the egg rolls and crab rangoon"* got the price of the egg rolls **and had crab
rangoon added to their order.** On a real phone line taking real takeout orders. Fixed to return the
price answer only; two regressions added that fail against the pre-fix code.

**Bug 2 — a pattern-starvation regression** introduced while fixing Bug 1.

The harness would not approve the run while must-fix findings were open. It ran one automated fix
cycle, and when review *still* found must-fix issues, it **parked and demanded a human** rather than
shipping. Twice.

Final state: 115 tests green, both bugs pinned by failing-first regressions.
(Corroborated independently by the downstream commit `e1c098f`, written at the time.)

> This is the whole argument in one run. A green suite told the author they were done. The
> structurally-independent reviewer told them a customer would be charged for food they never
> ordered.

## 3. The run also caught the harness lying about itself

The same run exposed a defect in the harness's own records.

Schema-v1 pipeline records stored **one slot per stage**. Re-run a stage — as a fix cycle does — and
it *overwrote* the previous attempt. Consequences:

- `tokens.md` reported **$6.15**. The true cost, reconstructed from the append-only event log, was
  **$8.23**. Two review rounds had been erased from the cost table.
- The findings of those two review rounds were destroyed with them.

The system under-reported its own cost by 34% and lost its own evidence. The event log — the one
record that was append-only — is the only reason I know that.

The fix was structural, not a patch: **every stage attempt is now its own append-only record**
(`schema_version 2`, v1 migrates on load; `review-N.md` per round). The class of bug is gone, not
the instance. It is [`CASE-0011`–`CASE-0017`](failures/) in the failure log.

## 4. The redesign

Four changes, each aimed at a *structural* cause rather than at prompt size.

**One continuous builder session.** grill → plan → build → fix now `--resume` the same agent session
instead of opening fresh contexts. The repository is read once, not five times. Review and verify
remain **structurally firewalled** — a separate process with no shared context — because that
isolation is the entire source of the review's value. There is a test that fails if the firewall
leaks.

**Native verify.** The harness executes the validation commands itself rather than asking an agent
whether they passed. Real exit codes, **$0**, and a vacuous "PASS" becomes impossible to express.
This deleted an entire failure class ([`CASE-0013`](failures/)): an agent had previously reported a
passing verify it never ran.

**Delta re-reviews.** Round *n* verifies the prior round's findings and reviews only the change
since, instead of re-reading the whole diff. (`--full-rereview` and `risk=high` force a full pass.)

**Append-only attempts.** From §3.

Getting there required probing what the tooling actually does rather than assuming:
`claude -p --resume` does work across processes with a stable session id and **per-invocation**
usage accounting; `--bare` breaks subscription auth headless; `--setting-sources ""` keeps auth but
drops user *and* project config — so the repo's own conventions get injected into the brief
explicitly. Those probes cost about $0.05 and saved the redesign from being built on a guess.

## 5. The result

Run [`2026-07-12_1811`](runs/2026-07-12_1811_add-a-handoff-briefing-to-the-china-garden-call/) — a
comparable feature on the same codebase.

| stage | v2 (run 1617) | v2.1 (run 1811) |
|---|---:|---:|
| grill | $0.45 · 14 turns | $0.19 · 6 turns |
| plan | $0.98 · 24 turns | $0.35 · **9 turns** |
| build | $1.26 · 36 turns | $0.62 · **20 turns** |
| review | $1.06 · 25 turns | $0.37 · **12 turns** |
| verify | $0.12 · 5 turns | **$0.00** · native |
| **comparable clean path** | **$3.87** | **$1.53** |

**60% cheaper.** 4.7 minutes wall-clock.

The load-bearing evidence is not the dollar figure — the v2.1 task was somewhat smaller, and I am
not going to pretend otherwise. It is the **turn collapse**: plan 24→9, build 36→20, review 25→12,
on comparable work. An agent that already holds the context does not spend turns rediscovering it.
That is a causal mechanism, not a correlation.

Feature shipped, 122 tests green (7 new, failing-first), lint clean.

## 6. What I actually concluded

**The harness is not a token saver. It is defect insurance with an audit trail.** v2.1 cut the
premium by 60%; it did not turn the premium into a profit, and a harness that claimed otherwise
would be lying.

Whether that trade is worth it is a function of what a defect costs you. For a throwaway script it
is obviously not. For code that answers a real phone line and takes real money, an extra dollar to
find out that price questions silently add items to a customer's order is not a close call.

The most useful thing I built was not the pipeline. It was the **record**: every run, every failure
case, every regression, every cost — append-only, and honest enough to catch the system in its own
lie.

---

## Appendix: what a skeptic should check

- **"The reviewer is the same model — that's not independent."** Correct, and the records say so
  (`Reviewer: fresh claude process — same agent as builder, no shared context (honest fallback)`).
  A *different* agent is used when one is available; the Codex driver exists for exactly this.
  Fresh-process-same-model is the honest fallback, labelled as such, and it still caught both bugs.
- **"Cherry-picked runs."** All 16 are in [`runs/`](runs/), including the ones where the harness
  looked bad. `metrics/summary.md` is generated from the event log, not typed by hand.
- **"The bug claims are unverifiable."** Each is pinned by a named regression test, and the
  downstream project's commit history records the same two bugs independently of the harness.
- **"n=16."** Yes. This is an engineering artifact with honest measurements, not a benchmark paper.
- **"You would hide a real miss."** The record contains one escaped bug (CASE-0020: a change reached
  `main` red on Windows because there was no cross-platform gate). It is written up in the README,
  root-caused past its own first wrong explanation, and closed with a merge gate that was itself
  broken on the first attempt and only fixed because I tested the guard.
