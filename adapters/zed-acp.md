# Zed / ACP Adapter

Status: user-owned experiment; separate project, shared reliability contract
Implementation: `C:\Users\PC\zed-acp-agents` (standalone repo since 2026-07-10; Codex-built spike,
folded in with fresh history and an independent review — see run `2026-07-10_1036`.)
Conformance: PASSED headless 2026-07-10 — Zed 1.10.1 installed (Kerry-approved), agent registered
in Zed settings, and a real Code turn (Sonnet executor + fresh reviewer, allowlist verified
fail-closed live) completed run `2026-07-10_1628` with agent_id `zed-acp`. Remaining: exercise the
Zed Agent Panel GUI itself.

The Zed/ACP project is not part of the Agentic Workflow core. It is an execution adapter and cockpit
that should run the same frame/context/plan/build/review/verify/ship/learn workflow as Claude Code
and Codex.

## Goal

From Zed, complete a small bug-fix task while producing the standard run, evidence, review, diff,
and failure artifacts in `agentic-workflow`.

## Adapter Identity

Start runs with explicit metadata:

```powershell
& C:\Users\PC\agentic-workflow\scripts\new_run.ps1 `
  -Objective "Fix the failing navbar test" `
  -Repo C:\Users\PC\some-repo `
  -AgentId zed-acp `
  -AgentRole mixed `
  -AgentSurface zed `
  -ValidationPlan 'npm test', 'npm run lint'
```

## Adapter Responsibilities

The separate Zed/ACP project owns:

- ACP protocol implementation and Zed external-agent configuration
- model/session lifecycle
- plan display and human approval UX
- context acquisition and repo tool execution
- command/file permission enforcement
- progress, diff, test, and final-result presentation
- lifecycle calls into Agentic Workflow

## Core Mapping

| Zed/ACP event | Agentic Workflow action |
|---|---|
| Task accepted | `new_run.ps1` |
| Plan proposed/approved | preserve `plan.md` and approval evidence |
| Important command or check | `update_run.ps1` |
| Serious agent/reviewer miss | `capture_failure.ps1` |
| Verification and review complete | populate `evidence.md` / `review.md` |
| Task completed, blocked, or abandoned | `complete_run.ps1` with honest status |
| Durable fix lands | `resolve_failure.ps1` + metrics refresh |

## Non-Goals

Do not rebuild inside the Zed project:

- run/failure schemas
- failure taxonomy
- metrics aggregation
- evidence/ship report format
- portfolio history

If the adapter needs a contract change, propose it in `agentic-workflow` and keep backward-readable
records.

## First Conformance Demo

1. Start a run from a Zed task.
2. Show and approve a plan.
3. Retrieve targeted context and edit a task branch/worktree.
4. Run validation and an independent review.
5. Complete the run with diff and evidence.
6. Repeat with a controlled failure that creates a failure case.
7. Demonstrate that a risky command waits for explicit approval.

When those pass, the Zed/ACP project is a working adapter over the scoped MVP rather than a second,
competing workflow system.
