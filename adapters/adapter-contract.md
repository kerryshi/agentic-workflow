# Agent Adapter Contract

Agentic Workflow is a reliability control plane, not a replacement executor. Any coding agent can
plug in if it can produce the same durable records.

## System Boundary

Keep the reliability core and execution adapters separate:

- **Agentic Workflow core** owns run/failure schemas, lifecycle scripts, evidence conventions,
  metrics, and the shared permission policy.
- **Adapters** own protocol and surface integration, model/session lifecycle, context acquisition,
  tool execution, and enforcement of approval boundaries.

Adapters should call the core scripts or a future stable core API. They should not fork or
reimplement the run/failure format. See `docs/architecture.md`.

## Required Run Fields

Every run must identify its **primary adapter**: the agent/surface responsible for owning the run
and producing the final artifact set. Use `manual` when no automation owns the run; never guess a
specific agent.

```json
{
  "agent": {
    "agent_id": "claude-code",
    "agent_role": "mixed",
    "surface": "claude-code",
    "model": null,
    "adapter_version": "v1"
  }
}
```

Fields:

- `agent_id`: stable primary-adapter name, for example `claude-code`, `codex`, `zed-acp`,
  `local-model`, `openhands-local`, or `manual`.
- `agent_role`: the primary adapter's role: `planner`, `executor`, `reviewer`, `verifier`,
  `classifier`, `helper`, or `mixed`.
- `surface`: product or runtime surface used for the run.
- `model`: model name when known; otherwise `null`.
- `adapter_version`: adapter-contract version emitted by the adapter.

### Multi-actor Runs

The v1 `agent` block identifies the primary run owner; it does not imply that the same actor
performed independent review. Record the reviewer in `review.md` today. If cross-agent metrics
become necessary, add versioned actor metadata/events rather than overloading the primary `agent`
block.

## Required Artifacts

Each adapter should write or preserve the standard run folder:

- `task.md`: objective, prompt summary, repo, risk, validation target, and agent adapter.
- `plan.md`: intended approach before major edits.
- `commands.jsonl`: commands/checks worth preserving.
- `evidence.md`: verification proof and links.
- `review.md`: independent review result and must-fix status.
- `final.md`: ship report.
- `diff.patch`: optional captured diff when safe.

## Approval Boundary

Adapters must not perform outward-facing, destructive, or hard-to-reverse actions without Kerry's
approval. Examples include credential revocation, deleting remote resources, sending email,
deploying public services, pushing to shared remotes, or changing billing/security settings.

The core policy is normative; it is not itself a tool sandbox. Each adapter must enforce the
boundary at its execution surface and record human approval in the run evidence. A Zed/ACP adapter,
for example, owns command/file approval prompts even though the shared policy lives here.

## Transcript Policy

Raw private transcripts are not part of the contract. Store concise summaries, sanitized command
events, evidence links, and failure cases. Only quote transcript snippets when they are necessary to
reproduce a failure.

## Adapter Readiness

A new adapter is ready when it can:

1. Start a run with agent metadata.
2. Preserve the plan/build/review/ship loop in the standard artifacts.
3. Record validation evidence before marking a run shipped.
4. Capture serious misses as `failures/CASE-####_*`.
5. Respect `docs/permission-policy.md`.
6. Pass the core lifecycle tests plus adapter-specific conformance tests without changing the
   shared artifact meaning.
