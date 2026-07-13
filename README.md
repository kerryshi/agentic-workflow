# agentic-workflow

**A pipeline harness that drives coding agents through gated, recorded, independently-reviewed
stages — and keeps the receipts.**

Coding agents are good at writing code and bad at knowing when they are wrong. A green test suite
is not evidence: it is the author grading their own homework. This repository is the system I built
to fix that — an orchestrator that treats agents (Claude Code, Codex, local models) as swappable
workers, drives them headless through a task-shaped pipeline, gates the risky transitions, and
records what actually happened.

The harness is ~4,400 lines of TypeScript with **zero runtime dependencies**. Everything below is
reproducible from the records in this repo.

---

## The case for it, in one run

Run [`2026-07-12_1617`](runs/2026-07-12_1617_add-a-price-faq-intent-to-the-china-garden-call/) added
a price-lookup feature to a phone-order agent for a restaurant. The building agent wrote the feature
*and* its tests, and the suite was green.

The harness's independent review stage caught two bugs the suite did not:

1. **A price question silently mutated a live order.** Asking *"how much are the egg rolls and crab
   rangoon"* answered with the price of the egg rolls **and added crab rangoon to the customer's
   order.** The parse function chained item-extraction after a price match.
2. **A pattern-starvation regression** in the follow-up fix.

Both were closed with regressions that fail against the pre-fix code and pass after. The suite
finished at 115 tests. The harness refused to approve the run while must-fix findings were open, and
parked for a human twice rather than shipping.

Across 16 recorded runs: **20 failure cases, 20 regressions, 93.8% evidence rate — and exactly one
escaped bug, recorded as such.** (See *The one that got away*, below. A reliability record with no
escaped bugs in it is usually a record that isn't looking.)
See [`metrics/summary.md`](metrics/summary.md).

---

## The pipeline

```
grill ──► plan ──► [approval gate] ──► build ──► review ──► verify ──► ship
  │        │              │              │         │          │
  │        │              │              │         │          └─ harness runs the validation
  │        │              │              │         │             commands itself. Real exit
  │        │              │              │         │             codes. $0. A vacuous PASS is
  │        │              │              │         │             structurally impossible.
  │        │              │              │         │
  │        │              │              │         └─ a DIFFERENT agent, or at minimum a fresh
  │        │              │              │            process with no shared context. Must-fix
  │        │              │              │            findings trigger one automated fix cycle,
  │        │              │              │            then park for a human.
  │        │              │              │
  │        │              │              └─ one continuous builder session (grill→plan→build→fix
  │        │              │                 resume it), so context is not re-bought per stage.
  │        │              │
  │        │              └─ the run stops. A human reads plan.md and approves. Not skippable.
  │        │
  │        └─ writes plan.md before touching code.
  │
  └─ refuses to start on an ambiguous task. Writes questions.md and parks.
```

Every stage writes an append-only attempt record. Park and resume work **across processes** — the
run survives the machine being turned off.

---

## What makes this different: it publishes its own losses

Most agent tooling reports its wins. Here is the full arc, including the part where it lost.

| | task | cost | vs. unharnessed agent |
|---|---|---:|---|
| **v2, trivial fixture** | one-line median fix | $0.69 | **4.3× worse** ($0.16) |
| **v2, first real task** | price-FAQ feature | $8.23 | ~5× worse (~$1.50) |
| **v2.1, after redesign** | handoff-briefing feature | **$1.53** | **60% better** than the v2 path ($3.87) |

The v2 harness was **expensive and I said so.** Five stages each opened a fresh context and re-read
the repository, so the harness paid for the same context five times. The first real-size run cost
$8.23 — of which **$4.30 was review rounds alone.**

That same run also exposed a defect in the harness itself: schema-v1 pipeline records let a re-run
stage *overwrite* its own slot, so the cost table under-reported by $2.08 and two review rounds'
findings were destroyed. The system lied about its own cost, and its own records caught it.

**v2.1 fixed the economics structurally, not by trimming prompts:**

- **One continuous builder session.** grill → plan → build → fix resume the same session instead of
  starting fresh contexts. Review and verify stay structurally firewalled from it — that isolation
  is the whole point and is enforced by test.
- **Native verify.** The harness executes the validation commands itself. Real exit codes, $0 cost,
  and an agent can no longer *claim* a passing verify.
- **Delta re-reviews.** Round *n* verifies the prior findings and reviews only the change since.
- **Append-only attempts.** The overwrite that hid $2.08 is now impossible.

The causal evidence is the turn collapse on comparable work: plan 24→9 turns, build 36→20, review
25→12. Full accounting in [`CASE-STUDY.md`](CASE-STUDY.md).

**The honest framing:** this is not a token saver. It is **defect insurance with an audit trail.**
v2.1 cut the premium by 60%.

---

## The reliability layer

Underneath the harness sits the thing that makes the numbers above trustworthy: every run leaves a
record, and every serious defect becomes a case with a regression test.

```
runs/       16 real run records — task, plan, review rounds, diff, evidence, cost
failures/   20 cases — root cause, the regression that pins it, the prevention layer
metrics/    generated from the event log, not hand-written
```

Twenty failure cases, twenty regressions, zero open. Most are bugs the system found **in itself** —
including the one that made it under-report its own cost. Browse [`failures/`](failures/); each case
names the test that would fail if the bug came back.

## The one that got away

[`CASE-0020`](failures/) is the only **escaped bug** in the record: a change was merged to `main`
while its test suite was red on Windows, and it stayed that way for a day.

Nobody skipped a check. **There was no check to skip.** The project is worked from two machines — a
Windows desktop and a Mac — and the change was written on the Mac, where it was green. The repo had
no cross-platform gate, so the other half of the estate was never exercised.

The interesting part is the root cause, because the first explanation was wrong. It was originally
logged as CPU load and an antivirus scan. It wasn't: `vitest` spawns one worker per core (16 on that
machine), these suites spawn real processes, and **Windows process creation costs about an order of
magnitude more than POSIX** — so the workers starved each other. That is why it reproduced on a
quiet box, and why it never reproduced in CI: a GitHub Windows runner has 2 cores, so it only ever
spawned 2 workers. The bug needed a big machine.

The fix is structural rather than a patch:

- a **pre-merge hook** that runs the suite on the machine doing the merge and refuses a red branch —
  proven in both directions through a real `git merge`, because it was **silently broken on the
  first attempt** and only testing the guard revealed it;
- worker and timeout limits scoped to Windows, verified by **10 consecutive green runs**;
- and the entire Windows-only PowerShell layer (1,931 lines) retired in favour of one Node
  implementation, after proving field-for-field output parity against the real repo — so there is no
  longer a half of this system that only one machine can run.

A reliability record with zero escaped bugs in it is usually a record that isn't looking.

---

## Why this doesn't depreciate as models improve

The obvious objection: *won't a smarter model make the scaffolding pointless?*

No — and the design is deliberately built to make that true. A better model writes better code, but
it does not give itself an adversarial reviewer with no stake in the work, it does not gate its own
risky transitions, and it does not leave a record you can audit. Those properties come from
structure, not from intelligence, and they get **more** valuable as agents are trusted with more.

What *would* depreciate is model-specific cleverness — prompt tricks, quirk workarounds, tuned
context stuffing. **This system deliberately contains none.** Agents sit behind an adapter contract
([`adapters/adapter-contract.md`](adapters/adapter-contract.md)); Claude Code and Codex are both
live drivers today, and swapping in a new one is a file, not a rewrite. The invariant is written
down in [`docs/architecture.md`](docs/architecture.md): the harness owns sequencing, briefs, gates,
and records — **never** the agents' tools or reasoning.

---

## Quick start

Requires Node ≥ 22 and at least one agent CLI on PATH (`claude` or `codex`).

```bash
cd harness
npm ci
npm run build

# See the briefs without spending anything
node dist/cli.js run "add a --json flag to the export command" --repo ../my-project --dry-run

# Run it for real; it will park at the approval gate
node dist/cli.js run "add a --json flag to the export command" --repo ../my-project

# Read plan.md, then approve
node dist/cli.js resume <run-id> --approve

node dist/cli.js status <run-id>
node dist/cli.js report <run-id>
```

Tests: `npm test` → **165 passing** across 24 files.

---

## Honest limits

- ~~The reliability scripts are PowerShell and Windows-only.~~ **Fixed 2026-07-13:** all 1,931 lines
  of PowerShell were retired and ported to Node, after proving field-for-field output parity against
  the real repo. There is now one implementation of the record contract, and it runs on both
  platforms.
- **The Codex driver has no session resume.** It falls back to fresh contexts per stage, and the
  records say so rather than hiding it.
- **Delta re-review is proven by test, not yet by a real fix cycle** — the run that would have
  exercised it end-to-end was approved in round one.
- **14 runs is a small sample.** The cost comparisons are honest but they are not a benchmark, and
  the v2.1 proof task was somewhat smaller than the v2 baseline it is measured against. The turn
  collapse, not the headline dollar figure, is the load-bearing evidence.
- Cost figures are Anthropic API pricing as billed at the time of each run.

---

## Repo map

| path | what |
|---|---|
| `harness/` | the orchestrator AND the whole reliability layer — Node/TS, zero runtime deps, 165 tests |
| `harness/src/engine.ts` | the state machine: stages, gates, fix cycles, park/resume |
| `harness/src/adapters/` | `claude.ts`, `codex.ts` — swappable drivers behind one interface |
| `adapters/` | the agent-agnostic contract every driver conforms to |
| `docs/architecture.md` | the ownership boundary, and the invariant that keeps it durable |
| `docs/orchestration.md` | templates, the stage-brief contract, the state machine |
| `runs/` | 14 real run records |
| `failures/` | 17 closed cases, each pinned by a regression |
| `PRD.md` | the product spec the system was built against |
| `MANUAL.md` | the working loop, end to end |

---

## A note on provenance

This is a curated public extract of a private working repository. The excluded material is client
work and personal planning — not code. Nothing in the system was removed.

The code here was written by coding agents, driven by me, through this harness. That is the point of
the project, and pretending otherwise would be strange. What I built is the system that makes their
output trustworthy: the pipeline, the gates, the adapter contract, the failure discipline, and the
measurements — including the ones that made it look bad.

## License

MIT — see [LICENSE](LICENSE).
