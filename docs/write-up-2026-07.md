## The test suite was green. The bug was waiting for the first real customer.

I'm a CS/statistics student, and this year I built a harness that drives coding agents — Claude
Code, Codex, in principle anything with a CLI — through gated, recorded, independently-reviewed
pipeline stages. The best argument for it is one run.

The scale, stated up front: every run in the record is on my own projects. The one that matters
here is a phone-order agent I'm building for my family's restaurant — it runs end-to-end in text
and has not taken a live call yet.

An agent added a price-lookup feature to it. It wrote the feature and 23 tests for it. Everything
passed. By the usual standard of "the suite is green," this was done.

The harness doesn't accept that standard. It sends every change to a reviewer that is structurally
independent — a different agent, or at minimum a fresh process that has never seen the code and has
no stake in it being finished. That reviewer found that asking *"how much are the egg rolls and
crab rangoon"* answered with the price of the egg rolls **and silently added crab rangoon to the
in-progress order**. No customer ever saw it — the reviewer caught it while it was still a diff,
not an order. The parser chained item-extraction after a price match. Twenty-three green
tests, written by the author, encoded the author's assumptions — none of them asked a question two
ways at once.

A green suite is the author grading their own homework. That's the entire premise of the system:
**an actor cannot be its own verifier.**

## What it is

The harness is ~4,500 lines of TypeScript, zero runtime dependencies. A task moves through
`grill → plan → approval gate → build → review → verify`. It refuses to start on an ambiguous task
(it writes its questions to disk and parks). It stops at the plan for human approval — not
skippable. Review must-fixes trigger one automated fix cycle; if problems persist it parks for a
human rather than shipping. The verify stage doesn't ask an agent whether the tests passed — the
harness runs the validation commands itself, so a made-up "PASS" is structurally impossible to
express.

Everything lands in append-only records: every run, every stage attempt, every failure case with a
regression test, every dollar. That part matters more than the pipeline, for a reason below.

## The part where it lost

The first measurements were bad, and they're published. On a trivial fixture task the harness cost
**4.3× more** than just running the agent ($0.69 vs $0.16) — five stages each re-bought the same
repository context. On its first real feature it cost $8.23, roughly 5× solo.

The redesign that followed attacked the structural causes (one continuous builder session with the
reviewer still firewalled, native verify at $0, delta re-reviews) and brought a comparable feature
in at **$1.53 vs the $3.87 baseline path — 60% cheaper**. The honest framing, which the case study
keeps: this is not a token saver and never became one. It's **defect insurance with an audit
trail**, and the redesign cut the premium. Whether that's worth it depends on what a defect costs
you. For code meant to answer a real phone line and take real orders, a dollar to find out before
the first live call that price questions mutate orders is not a close call.

## The records caught the system lying about itself

The same real-world run that caught the order-mutation bug also exposed the harness's own defect:
re-run stages overwrote their earlier attempts, so it reported its own cost as $6.15 when the truth
— reconstructable only from the one append-only event log — was $8.23. My reliability tool
under-reported its own cost by 34% and destroyed two rounds of its own review evidence. That's now
a recorded failure case, fixed structurally (every attempt is its own record), with a regression.

There is also exactly one escaped bug in the record — a change that reached master red on Windows
because no cross-platform gate existed yet. It's written up in the README rather than buried,
because a reliability record with zero escaped bugs in it is usually a record that isn't looking.
The gate that now prevents it was itself broken on the first attempt, and I only know that because
I watched it refuse a deliberately red branch before trusting it.

## What I'd generalize

- **A check you didn't watch fail is not a check.** New tests get seen red first; gates get seen
  refusing first. A guard that has never refused anything is decoration.
- **Independence is structural, not rhetorical.** "Please review your work" does nothing; a fresh
  context with no authorship stake changes what gets found.
- **Keep receipts you can't edit.** The append-only log is the only reason I know my own tool's
  real costs — and the only reason you should believe any number in this post.

The repo — code, all 26 run records including the embarrassing ones and two abandoned parks, the
failure log, and the full case study — is public: **github.com/kerryshi/agentic-workflow**.
