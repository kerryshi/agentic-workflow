# agentic-workflow

[![CI](https://github.com/kerryshi/agentic-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/kerryshi/agentic-workflow/actions/workflows/ci.yml)

A harness that drives coding agents (Claude Code, Codex) through a staged pipeline — grill, plan,
build, review, verify — with each stage in a fresh context, a plan-approval gate, and work passed
only when tests the harness runs itself exit 0. Every run leaves a record: the plan, the review,
the diff, and the evidence.

The bet is that a reviewer who did not write the code has no stake in it, so it catches what the
builder's own tests miss. The records are how that bet gets checked rather than assumed: 24 failure
cases captured, 23 regression tests added, and 1 escaped bug (a change that reached `main` red on
Windows, CASE-0020), root-caused and closed with a merge gate.

TypeScript on Node, zero runtime dependencies: ~3,900 lines of source, ~3,600 lines of tests, CI on
Ubuntu and Windows.

## Start here

- [`CASE-STUDY.md`](CASE-STUDY.md) — how the harness went from 4.3× more expensive than no harness
  to 60% cheaper than its own baseline, and the bug its fresh-context review caught that a green
  test suite missed.
- [`docs/write-up-2026-07.md`](docs/write-up-2026-07.md) — the short version.
- [`harness/src/engine.ts`](harness/src/engine.ts) — the stage pipeline.
- [`failures/`](failures/) and [`metrics/summary.md`](metrics/summary.md) — every captured failure
  and the numbers above.

## Scope

**This is personal infrastructure, published as a working exhibit — not a product.** It exists
so my own coding agents produce work I can trust; it is public so the run records, failure
cases, and metrics behind my write-ups can be inspected, not because it is packaged for
adoption. No releases, no roadmap for external users.

It is agent-agnostic by design: the durable reliability layer for coding agents — run records,
failure cases, ship evidence, metrics, and adapter contracts — that Claude Code, Codex, and local
models plug into.

## Repository map

- `MANUAL.md` - user manual: the working loop, skills, run lifecycle, adapters, guardrails.
- `PRD.md` - Agentic Workflow v3 product decision and scope.
- `docs/architecture.md` - ownership boundary between the reliability core and execution adapters.
- `docs/workflows.md` - how to use the v3 MVP helpers.
- `docs/ai-coding-workflow.md` - the general plan/build/review/ship loop agents plug into.
- `docs/permission-policy.md` - auto / approval / blocked policy for coding tasks.
- `docs/exhibits/` - sibling-project exhibits (CAD print pipeline, Zed ACP agent, governed WebLLM harness), each with watched-red-then-green test evidence.
- `adapters/adapter-contract.md` - common record shape for Claude Code, Codex, and local agents.
- `adapters/zed-acp.md` - contract and conformance target for Kerry's separate Zed/ACP experiment.
- `metrics/summary.md` - generated reliability metrics.

## Layout

```text
harness/     the orchestrator AND the whole reliability layer (Node/TS, zero runtime deps)
runs/        substantial coding-run records
failures/    replayable or inspectable failure cases
adapters/    agent adapter contract + concrete adapter notes
templates/   Markdown reference for hand-written records
metrics/     generated summaries (summary.md/.json) and JSONL events
docs/        operating docs and policies (start with docs/workflows.md)
.githooks/   pre-merge-commit — the cross-platform gate (see below)
```

**The PowerShell layer was retired on 2026-07-13.** `scripts/*.ps1` (1,441 lines) and
`tests/run_tests.ps1` are gone; everything they did is in `harness/` and runs identically on
Windows and macOS. There is now one implementation of the record contract, not two.

## Quick Start

```bash
cd harness && npm ci && npm run build

# Let the harness drive an agent through the whole pipeline:
node dist/cli.js run "add a --json flag to the export command" --repo ../my-project

# Or record work the harness is NOT driving (a manual task, another agent):
node dist/cli.js new-run "describe the task" --repo ../my-project \
  --agent-id claude-code --validate "npm test" --validate "npm run lint"
node dist/cli.js update-run --command "npm test" --result "138 passed"
node dist/cli.js complete-run --status shipped --capture-diff --evidence-link evidence.md

# Capture and close a serious failure; regenerate the metrics:
node dist/cli.js case new --summary "..." --class tool_error --severity must_fix
node dist/cli.js case resolve CASE-0019 --regression "tests/x.test.ts"
node dist/cli.js metrics
```

Omit the run id on `update-run` / `complete-run` and the single in-progress run is used.
**Two in-progress runs is an ambiguity, and ambiguity is refused, never guessed** (CASE-0007).

`harness doctor` tells you what is missing.

## The cross-platform gate

This repo is worked from a Windows desktop *and* a Mac, and harness v2.2 once shipped
Windows-red for a day because it was written on the Mac and nothing ever ran it on Windows.
The desktop is where branches get merged, so the merge is the one moment the other platform is
guaranteed to be present. Install the gate once per clone, on **both** machines:

```bash
git config core.hooksPath .githooks
git config merge.ff false     # so a branch merge always creates a merge commit, and always
                              # trips the hook
```

It runs the suite before a merge lands and refuses a red one. `harness doctor` reports when it
is not installed — a gate you have to remember to invoke is not a gate.
