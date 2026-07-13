# AI Coding Workflow

This is the general workflow for plugging Claude Code, Codex, or local/open-source agents into
Agentic Workflow. It is inspired by the practical AI-coding loop: give the agent clear context,
make it plan, let it build in a bounded scope, review the result, verify with evidence, and preserve
what happened.

## Loop

1. **Frame**
   - Define the objective, repo, branch/worktree, risk level, and validation target.
   - Start a run with the selected adapter before major edits.

2. **Context**
   - Read local instructions first: `AGENTS.md`, `README`, `STATUS`, `HANDOFF`, relevant docs.
   - Record only the useful summary in `task.md`; do not store raw private transcript by default.

3. **Plan**
   - Write or preserve a short plan in `plan.md`.
   - Identify approval boundaries before the agent acts.

4. **Build**
   - Let the selected agent work inside the repo/worktree.
   - Keep edits scoped to the objective.
   - Append important commands or checks with `update_run.ps1`.

5. **Review**
   - Run an independent review pass.
   - Put findings in `review.md`.
   - Capture serious misses as failure cases instead of leaving them in chat.

6. **Verify**
   - Run the stated validation plan.
   - Save evidence in `evidence.md` and links in `run.json`.
   - Be explicit when validation is user-confirmed or externally verified.

7. **Ship**
   - Complete the run with `complete_run.ps1`.
   - Capture a safe diff when useful.
   - Leave `final.md` readable without chat history.

8. **Learn**
   - If the agent failed in a meaningful way, create or resolve a `failures/CASE-####_*`.
   - Update the right prevention layer: test, hook, skill, adapter doc, project doc, or workflow rule.

## Agent Selection

Agents are peers: no agent owns a role. Any adapter can plan, build, review, or verify; the role is
assigned per run (`-AgentRole`), never fixed per agent. Pick the agent for a run by fit, cost, and
availability.

- `claude-code`, `codex`, and local/open-source agents plug in through the same contract.
- Helper roles (summarization, classification, tagging, metrics) are a cheap way to bring a new
  agent or model online and build evidence before it takes higher-risk executor runs.
- Add new agents by documenting them under `adapters/` and using the adapter contract.

## Done Means

A run is not done because an agent says it is done. A run is done when the record contains:

- objective
- selected agent adapter
- plan
- changed files or clear no-op result
- validation evidence
- review result
- final outcome
- failure case links when applicable
