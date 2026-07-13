# Orchestration — the Pipeline Harness (v2)

The harness is the orchestrator. No agent is the boss: Claude Code, Codex, and local models are
swappable workers that the harness drives through a task-shaped pipeline. The harness gives each
stage a concrete, minimal brief (less wandering, fewer tokens) and writes every run into the
existing run/failure/evidence layer.

**Boundary (inherited from PRD §1.3 and `docs/architecture.md`, still binding):** the harness owns
*stage sequencing, briefs, gates, and records*. It never re-owns the agents' tools — file access,
shell, context gathering, and permission prompts stay inside each agent surface, per
`adapters/adapter-contract.md`. The harness is a thin conductor, not a replacement executor.

Scope: **coding tasks only.** Non-goals: non-coding goals, parallel sub-runs (deferred), LLM-generated
pipelines (v1 templates are deterministic), daemons/scheduling, notifications, automated pushes.

## v2.1 — session economics + honest re-runs (2026-07-12)

Driven by the first real-size run (`runs/2026-07-12_1617_…`, china-garden price-FAQ): true cost
$8.23 vs ~$1.50 solo, 10.4M cache-read tokens across 9 stage executions — five-plus fresh contexts
re-exploring the same repo — while the records under-reported the total ($6.15) because re-run
stages overwrote their slot. v2.1 keeps the quality gate and cuts the waste:

- **One continuous builder session.** grill → plan → build → fix resume the same claude session
  across human gates (`--resume`; cwd-scoped, per-invocation usage — probe-verified 2026-07-12).
  Exploration happens once. A dead session falls back to a fresh context, recorded honestly.
- **Reviewer firewall (structural).** review/verify are not in the lineage set — no code path can
  hand the reviewer the builder's context. Round-1 reviews stay full and fresh: that is the
  component that caught what the builder's own 112 green tests missed.
- **Delta re-reviews.** Every review round snapshots the tree natively (`review-N.diff`,
  throwaway-index `add -N` so untracked files appear). Re-reviews after a fix verify the prior
  findings and adversarially review only what changed since (both diffs in the brief).
  `--full-rereview` and `--risk high` force full rounds. Re-review rounds were $3.24 of the $8.23.
- **Native verify.** The harness executes the plan's validation commands itself: real exit codes,
  output tails, mechanical git-status surprise check. Zero tokens; vacuous PASS impossible by
  construction. `--agent-verify` keeps the agent path for judgment-needed validation.
- **Isolated workers.** `--setting-sources ""` (NOT `--bare` — it breaks subscription auth
  headless): no user CLAUDE.md/hooks/skills in workers; the harness injects the target repo's
  AGENTS.md/CLAUDE.md into briefs (capped, loud truncation). `--no-isolation` reverts.
- **Append-only attempts.** Every stage execution is a `StageAttempt`; re-runs push, never
  overwrite. `pipeline.json` schema_version 2 (v1 migrates on load); the report renders one row
  per attempt and sums true totals. Review rounds persist as `review-N.md`.
- **Caps.** `--stage-budget-usd` → `--max-budget-usd` per stage, on top of per-stage max-turns.

## CLI

Lives at `harness/` (Node 24 / TypeScript, ESM). Run from the repo:

```
node harness/dist/cli.js run "<task>" --repo <path> [--template feature|bugfix|refactor|review]
                                                    [--agent claude|codex] [--reviewer claude|codex]
                                                    [--model <model>] [--skip <stage>] [--dry-run]
                                                    [--safe-perms]
node harness/dist/cli.js resume <run_id> [--approve]
node harness/dist/cli.js status [<run_id>]
node harness/dist/cli.js report <run_id>          # per-stage tokens/cost/duration table
```

Agents run headless with `--dangerously-skip-permissions` by default — Kerry's standing full-auto
decision (HANDOFF "Decisions locked"); the human gates live in the pipeline (approval park), not
in per-tool prompts. `--safe-perms` keeps the agent's own permission prompts instead.

`--dry-run` prints the chosen template, stage list, and each stage's brief without invoking any
agent — the cheapest way to inspect what the harness would do.

## Pipeline templates (deterministic, v1)

Template selection: keyword classifier over the task text (`fix|bug|crash|regression` → bugfix;
`refactor|rename|extract|cleanup` → refactor; `review` → review; else feature). `--template`
always wins. "Not so strict": templates are default stage lists; stages can be skipped per run
(`--skip <stage>` — recorded as status `skipped`, never erased), and `park` can inject human
course-correction at any gate. **The approval gate is not skippable** — `--skip approval` is
refused (review hardening, 2026-07-10).

| Template | Stages |
|---|---|
| feature  | grill? → plan → **[gate: approval]** → build → review → verify |
| bugfix   | repro → plan → **[gate: approval]** → build (fix + failing-first regression) → review → verify |
| refactor | plan → **[gate: approval]** → build → verify (tests green, no behavior change) → review |
| review   | review |

- **grill?** — the agent is asked whether the task is ambiguous; if yes it returns pointed
  questions, the harness parks with `questions.md`, Kerry answers in the file, `resume` continues.
  If unambiguous, the stage passes through silently.
- **[gate: approval]** — the harness always parks after `plan` and waits for
  `resume --approve`. Plan-before-build is Kerry's operating contract; the gate is ON by default.
- **review** — must run in an independent context: a *different agent* than the builder when one is
  available, otherwise a fresh process of the same agent (fresh context ≠ fresh eyes, but it is the
  honest fallback and is recorded as such in `review.md`).
- **verify** — runs the validation plan (tests/lint/typecheck via the agent) and writes
  `evidence.md`. A stage result without evidence fails the stage — the engine parks a PASS claim
  with zero results or any result lacking real command output (regression-tested).
- **fix cycle** — one automatic build(fix)+re-review insertion on a must-fix verdict, and ONLY
  when a Kerry-approved plan exists (a review-only pipeline parks instead — no ungated
  repo-mutating build). If verify already ran before the review (refactor template), a fresh
  verify is inserted after the re-review so the shipped state is the verified state.

## Stage briefs

Each stage gets ONLY:

1. the task statement (+ grill answers, if any),
2. the stage goal + done-criteria from the template,
3. the artifacts of prior stages it actually needs (build gets `plan.md`; review gets the diff +
   plan; verify gets the validation plan) — never the whole conversation,
4. constraints: the approval boundary (`docs/permission-policy.md`), no pushes, park rules,
5. an output contract: final message must be JSON matching the stage schema; file artifacts are
   written into the run folder.

This is the token-savings mechanism: lean, scoped context per stage instead of one long
accumulating conversation.

## State machine

Per-run state lives in the standard run folder as `pipeline.json`:

```json
{
  "run_id": "2026-07-10_2010_example",
  "template": "feature",
  "current_stage": 2,
  "stages": [
    {"name": "grill", "status": "done", "agent": "claude", "model": "...",
     "tokens": {"input": 0, "output": 0}, "cost_usd": 0.0, "duration_ms": 0,
     "artifacts": ["questions.md"]},
    {"name": "plan", "status": "done", "...": "..."},
    {"name": "approval", "status": "parked", "park_reason": "awaiting plan approval"}
  ]
}
```

Stage status: `pending | running | done | parked | failed | skipped`. Parking writes
`PARKED.md` (why, what Kerry must do, the resume command) and exits 0 — park-and-wait is the ONLY
escalation path; there are no notifications. The process holds no state: `resume` reconstructs
everything from `pipeline.json`, so a crash mid-stage is recoverable (`running` on load = that
stage is re-run).

## Adapter drivers

`harness/src/adapters/` implements `adapters/adapter-contract.md` in code:

```ts
interface AgentDriver {
  id: string;                      // "claude" | "codex" | ...
  available(): Promise<boolean>;   // CLI present + auth OK
  run(brief: StageBrief, opts: DriveOpts): Promise<StageResult>; // headless, one stage
}
```

- **claude**: `claude -p <brief> --output-format json` with `cwd` = target repo; parses result
  text (JSON per output contract) + `usage`/`total_cost_usd`/`duration_ms`/`num_turns`.
- **codex**: `codex exec --json --skip-git-repo-check -` with the brief on stdin and `cwd` =
  target repo; folds the JSONL event stream (last `agent_message` = result text; `turn.completed`
  usage summed; `error`/`turn.failed` surfaced). `available()` = `codex login status` (CLI present
  AND auth OK). No cost field in the stream, so `cost_usd` is an honest 0 — tokens carry the
  accounting. Passed live conformance on this machine 2026-07-11 (codex-cli 0.144.1, run
  `2026-07-11_0636`).
- Drivers surface the agent's own failure honestly: nonzero exit, malformed output, or a
  token-limit stop become a `failed` stage with the raw tail preserved in the run folder — never a
  silently-swallowed retry loop.

## Records

The harness writes the standard artifacts natively (BOM-less UTF-8, schema per PRD §3.11):
`run.json` (with `agent` block; `agent_role` = the builder; `validation_plan` synced from the plan
stage), `task.md`, `plan.md` (plan stage), `review.md` (review stage), `evidence.md` (verify
stage), `commands.jsonl` (one event per stage transition + agent invocation), and appends
`run_started`/`run_completed` to `metrics/runs.jsonl` (v1 event names). Agent output tails pass a
conservative secret scrub (`src/secrets.ts`, PRD FR7) before landing in committed records.
`harness metrics` must parse harness-written records unchanged — enforced by
`harness/tests/metrics-compat.test.ts`, which drives the real PS script over a harness-written
run. The PS scripts remain the human/manual CLI; the harness does not shell out to them (keeps
prompts out of PS 5.1 quoting entirely).

## Failure loop

A `failed` stage or a serious reviewer finding routes to the existing `failures/CASE-####` flow.
v1: the harness prints the exact `capture_failure.ps1` invocation into `PARKED.md` — on failed
stages AND on must-fix review parks; auto-capture is a later step once the failure JSON writer is
ported to TS.
