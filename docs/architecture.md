# Architecture: Reliability Core + Agent Adapters

Agentic Workflow and the Zed/ACP agent project are separate products with one shared workflow
contract. They should evolve independently without duplicating each other's responsibilities.

## Two Interconnected Systems

```text
Zed / Claude Code / Codex / local runner
                 |
                 v
        agent-specific adapter
        - protocol and sessions
        - context and tool execution
        - approval enforcement
                 |
                 v
       Agentic Workflow contract
        - start/update/complete run
        - evidence and review
        - failure capture and replay metadata
        - metrics and regression history
                 |
                 v
             project repo
```

The adapter performs the work. The core records whether the work was controlled, verified, and
useful enough to learn from.

## Ownership Boundary

| Concern | Reliability core (`agentic-workflow`) | Agent adapter / Zed-ACP project |
|---|---|---|
| Run and failure schemas | Owns | Consumes |
| Lifecycle and metrics | Owns | Calls and reports into |
| Evidence/review conventions | Owns | Produces compliant artifacts |
| Shared permission policy | Owns policy | Enforces at the tool surface |
| ACP protocol and Zed UI | Does not own | Owns |
| Model/session lifecycle | Does not own | Owns |
| Repo context and tool execution | Does not own | Owns |
| Editor progress/diff presentation | Does not own | Owns |
| Cross-agent reliability comparison | Owns normalized metrics | Supplies agent metadata |

This boundary prevents two failure modes: turning the reliability repo into another editor-specific
agent, and letting each agent invent incompatible evidence/failure formats.

## Shared Lifecycle

Every adapter maps its native events onto the same lifecycle:

1. Frame the objective, repo, risk, validation plan, and primary adapter.
2. Start a run before major edits.
3. Preserve the approved plan.
4. Execute inside the adapter's own tool and permission boundary.
5. Record important commands, decisions, and evidence.
6. Run independent review and verification.
7. Complete the run only with an honest outcome.
8. Capture serious failures and attach durable prevention.

Adapters call the core entry points rather than writing JSON/Markdown formats independently:

```text
new_run.ps1 -> update_run.ps1 -> complete_run.ps1
                    |                  |
                    +-> capture_failure.ps1 -> resolve_failure.ps1
```

A future library or MCP wrapper may replace direct PowerShell invocation, but it must preserve the
same contract and backward-readable artifacts.

## Contract Rules

- `agent` identifies the primary adapter that owns the run, not every actor that participated.
- Use `manual` when the primary adapter is unknown; never silently attribute work to Claude/Codex.
- Independent reviewer identity stays in `review.md` for v1. Add versioned actor events only when
  cross-agent analysis needs them.
- Raw transcripts are not core artifacts. Store sanitized summaries and evidence.
- Permission policy in the core is normative. Enforcement belongs to the adapter/tool surface.
- Contract changes require a version bump and conformance tests before adapters adopt them.

## Design Invariant: a Model-Appreciating Framework

The system is built to be worth MORE as models improve, never less — the counter to "smarter
models will obsolete the scaffolding." Every design decision biases toward mechanisms that
appreciate with model quality (append-only records, human gates, independent fresh review,
native command execution, adapter contracts — structure a better model exploits harder) and away
from mechanisms that depreciate (model-specific prompt tricks, output-format hacks, compensations
for weaknesses a next model won't have). Test for new machinery: *if the underlying model got
twice as good tomorrow, does this component become more valuable or dead weight?* Dead-weight
components need a stronger justification or don't land. (Framing crystallized 2026-07-12 —
"a good framework yields more as the model gets better.")

## Zed/ACP Project Boundary

The Zed/ACP work should be a separate, user-owned experiment (for example `zed-acp-agents`) that
depends on this contract. It may progress in parallel with the reliability core.

The Zed/ACP project owns:

- ACP server/gateway and Zed configuration
- agent session and model selection
- plan/approval/progress/diff messages in Zed
- context retrieval and tool execution
- enforcement of command/file permissions
- translation of native events into core lifecycle calls

It should not own a second run schema, failure taxonomy, metrics store, or ship-report format.

## Readiness Gates

A new adapter is ready for normal use when it can demonstrate one complete task and one failed task:

- complete task: plan -> edit -> test -> review -> evidence -> completed run
- failed task: traceable failure -> failure case -> regression/prevention -> replayable result
- permissions: at least one risky action is blocked or held for explicit approval
- compatibility: core tests remain green and old records remain readable

The Zed/ACP experiment does not need to wait for the core to become a large platform. It only needs
a stable v1 adapter contract. Production positioning should wait until the conformance flow passes.
