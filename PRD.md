# Agentic Workflow v3 PRD

Date: 2026-07-08 (v1 accepted 2026-07-08; hardened to fully-working 2026-07-09; v2 scope added
2026-07-10 — section 4)
Owner: Kerry Shi
Status: v1 - accepted, built, and hardened to fully-working (2026-07-09). The MVP was reviewed and
its scripts hardened; on 2026-07-09 the diff-capture regression (R14) was fixed, the harness made
deterministically green, the failure loop exercised end-to-end, and `/review` wired. The item H
adapter wave grew the harness to 64 checks (all green) and the seeded + resolved failure cases to
9. Per-phase status is tracked inline in section 3.12. **v2 (the pipeline harness, section 4) was
scoped and approved 2026-07-10** — it deliberately supersedes the "no custom coding harness" v1
non-goal, under conditions stated there.

> Section 1 is the original critique that produced this product decision. It is retained as
> rationale (why v3 is a reliability layer and not a Zed/ACP platform), not as active spec.
> Sections 2 onward are the accepted requirements.

## 1. Hard Critique of the Proposed Zed/ACP Spec

### 1.1 The core idea is good, but the proposed center of gravity is wrong

The spec is strongest when it says the product is not "many agents," but a controlled, observable,
testable coding-agent reliability system. That is exactly the right direction.

The weak part is making Zed/ACP the headline. In this system, the active center is already Claude Code
configuration: global instructions, skills, subagents, hooks, worktrees, sync, and project handoffs.
Making Zed/ACP the new foundation would force a platform rebuild before the reliability loop exists.

Verdict: ACP should be an optional cockpit later. It should not be the MVP.

### 1.2 The MVP in the spec is still too large

The spec says "MVP," but includes:

- ACP gateway
- custom harness
- planner
- executor
- verifier
- local code index
- permission gate
- trace logger
- failure-to-eval loop
- agentic AI engineer
- future model routing
- future fleet

That is not an MVP. It is a multi-quarter platform.

For Kerry's actual system, the MVP should be narrower:

- structured run records
- structured ship/evidence reports
- replayable failure cases
- failure classification
- regression/eval tracking
- lightweight metrics

Everything else is secondary.

### 1.3 It duplicates capabilities that Claude Code already gives you

The proposed harness wants to own:

- file reads
- shell commands
- edits
- tests
- diffs
- planning
- review
- tool permissions
- context retrieval

But the current system already has most of this through Claude Code plus custom skills:

- `/plan`
- `/review`
- `/ship`
- `/worktree`
- `/gnhf`
- `reviewer` subagent
- `explore` subagent
- report-only validation hook
- project `STATUS.md` and central `HANDOFF.md`

Building a full replacement harness now would regress the workflow by turning a working system into
a partially rebuilt one.

Better move: wrap the existing workflow with durable records and evals.

### 1.4 The spec underestimates operational friction on Windows + WSL2 + Mac

The system is not a generic Linux dev box. It has real platform constraints:

- Windows desktop is the canonical machine.
- WSL2 is the ML lab, not the main AgentOS runtime anymore.
- Mac is a thin client / second workspace over Tailscale.
- PowerShell 5.1 mangles quote-bearing multiline strings passed to native exes.
- Windows script execution policy can block PowerShell entrypoints unless bypassed deliberately.
- Git safety checks can fail under alternate users unless safe directories are handled.
- The validation hook has already had a repo-config RCE class issue; any automation that inspects repos
  must respect the trusted-repo allowlist.
- Mac does not run the same PowerShell Stop hook.

The proposed spec ignores too many of these details. A revamp that does not encode these constraints
will look good on paper and fail in daily use.

### 1.5 The local model routing section conflicts with the active decision

The current workflow intentionally dropped local models from the coding loop. Claude does planning,
coding, debugging, and review. Ollama/WSL2 can still be useful, but not as the agent core.

Acceptable local use:

- summarize long logs
- classify failure types
- draft labels/tags
- embeddings/search experiments
- batch metrics summaries

Not acceptable for v3 MVP:

- routing code-generation tasks to local models
- using local models as the main planner/reviewer
- rebuilding Claude Code around Ollama

The portfolio story is stronger if the system is a reliability layer around a serious coding agent,
not a half-built local-agent platform.

### 1.6 The local code index is premature

A persistent symbol/call graph sounds impressive, but it is not the current bottleneck.

The current bottleneck is that failures do not automatically become durable evals. The workflow can
already find code using `rg`, `/explore`, repo docs, and normal tool use. A code index becomes valuable
after there are enough repeated failures caused by bad context.

Do not build the index first.

### 1.7 The failure-to-eval loop is the real gold

This is the strongest part of the spec. It should become the first major v3 feature.

The current workflow has:

- strong review discipline
- regression-test expectations
- evidence requirements
- handoff docs
- session history

But it lacks:

- a standard failure case folder
- a reproducible command for each failure
- a failure taxonomy applied consistently
- a report tying a failure to the rule/skill/test that prevents recurrence
- metrics showing reliability improving over time

This is the gap that would make the system portfolio-defensible.

### 1.8 The permission model needs to be real, but not annoying

The current system has full-auto permissions enabled, with human judgment expected for risky actions.
That is productive, but weak as a reliability-platform claim.

Do not switch to constant permission prompts. That creates fatigue.

Instead, define a coding-task policy:

- Auto: read/search, local edits, local tests, local lint/typecheck, local commits when requested.
- Approval: deleting files, migrations, package installs, touching secrets, changing prod config,
  pushing, deploying, sending messages, writing to Mac, writing outside the active repo.
- Blocked: mass outreach, financial actions, secret exfiltration, destructive filesystem operations
  outside explicit task scope.

The policy should live in the workflow docs and be referenced by skills. It does not need a giant
custom tool gateway on day one.

### 1.9 The fleet idea is a distraction

The actual "fleet" is already:

- Windows desktop: canonical execution and heavy work.
- WSL2: ML/CUDA lab.
- Mac: portable client / second workspace.

Do not build a distributed task runner. Finish tmux/persistent sessions and sync discipline first.

### 1.10 The right revamp is not AgentOS 2

AgentOS was a personal automation OS. This is different.

Do not revive AgentOS architecture.
Do not port AgentOS scripts.
Do not rebuild a daily pipeline.

Carry forward patterns only:

- health checks
- atomic writes
- run logs
- routing discipline
- approval policy
- dashboard/reporting instinct

## 2. Product Decision

Build Agentic Workflow v3 as an agent-agnostic reliability layer, with Claude Code as the first
supported adapter.

Do not build a Zed-native ACP platform first.
Do not build a custom coding harness first.
Do not build model routing first.
Do not build a fleet first.

The v3 product is:

> A local-first, agent-agnostic coding-agent reliability workflow that records each meaningful coding
> run, captures failures as replayable eval cases, requires evidence before shipping, and turns
> repeated failures into changes to tests, skills, hooks, adapter contracts, or workflow rules.

## 3. Product Requirements Document

### 3.1 Product Name

Agentic Workflow v3: Reliability Layer

### 3.2 Problem

The current system is strong at performing coding work with Claude Code, but weak at accumulating
structured evidence that it is getting more reliable. The reliability layer should preserve Claude
Code as the strongest current executor while avoiding a hard dependency on any one agent surface.

Failures currently become:

- conversation memory
- ad hoc test additions
- occasional brain notes
- handoff text

They should become:

- replayable eval cases
- structured failure classifications
- regression tests
- metrics
- targeted workflow improvements

### 3.3 Goals

1. Make every substantial coding task leave a durable run record.
2. Make every meaningful failure reproducible or at least inspectable.
3. Make `/ship` produce consistent evidence artifacts.
4. Make failure analysis update the right layer: test, skill, hook, brief, repo code, or project docs.
5. Support Windows desktop, WSL2 lab, and Mac workspace without source-of-truth confusion.
6. Strengthen the portfolio story from "good Claude config" to "agentic coding reliability system."
7. Define a minimal agent adapter contract so Claude Code, Codex, and open-source agents can plug
   into the same run/evidence/failure system over time.

### 3.4 Non-Goals

- No Zed/ACP integration in v3 MVP.
- No custom full coding-agent harness in v3 MVP.
- No open-source/local model coding loop as the default autonomous executor in v3 MVP.
- No distributed fleet.
- No autonomous deploy/push/send behavior.
- No database.
- No copying whole repos into failure cases unless absolutely necessary.
- No public dashboard until the local artifacts are useful.

### 3.5 Target User

Primary user: Kerry Shi.

Use cases:

- build portfolio projects
- harden real systems
- resume interrupted work across sessions and machines
- prove agentic workflow quality in interviews
- learn from agent failures instead of repeating them

### 3.6 Operating Environment

#### Windows desktop

Role: canonical execution machine and source of truth.

Responsibilities:

- primary Claude Code sessions
- project repos
- `.claude` config
- run/failure registry
- validation hooks
- heavy local execution
- Ollama available for helper tasks, not main coding loop

Constraints:

- PowerShell 5.1 quote/multiline issues
- execution policy issues
- Windows paths
- Git safe-directory friction under alternate users
- repo-config RCE risk for automated inspection

#### WSL2

Role: ML/CUDA lab and Linux compatibility environment.

Responsibilities:

- PyTorch/CUDA experiments
- Linux-only tooling
- optional local eval experiments
- optional tmux persistent Claude workflow if proven stable

Constraints:

- not canonical AgentOS runtime
- avoid duplicate source-of-truth repos
- only use WSL paths deliberately

#### MacBook Air

Role: thin client / portable workspace.

Responsibilities:

- inspect/edit synced projects
- drive desktop over Tailscale
- resume/attach to long sessions once the persistent-session work lands (PRD Phase 4 /
  HANDOFF N2)

Constraints:

- commits travel; uncommitted state does not
- Mac hook parity is incomplete
- desktop remains source of truth unless explicitly changed
- remote writes need human care

### 3.7 Information Architecture

Recommended repo: `C:\Users\PC\agentic-workflow`

```text
agentic-workflow/
  HANDOFF.md
  PORTFOLIO.md
  PRD.md
  README.md
  USAGE.md

  docs/
    workflows.md
    permission-policy.md
    path-conventions.md

  runs/
    2026-07-08_1545_example-task/          # id = yyyy-MM-dd_HHmm_slug
      run.json
      task.md
      plan.md
      evidence.md
      review.md
      final.md
      diff.patch
      commands.jsonl

  failures/
    CASE-0001_wrong-order-confirmation/
      failure.json
      prompt.md
      expected.md
      actual.md
      repro.md
      classification.md
      fix.md
      regression.md
      evidence.md

  templates/                               # human reference for hand-written records
    run-record.md
    ship-report.md
    failure-case.md
    postmortem.md

  adapters/
    adapter-contract.md
    claude-code.md
    codex.md
    local-models.md
    zed-acp.md

  scripts/
    _common.ps1                            # shared PS 5.1-safe helpers (dot-sourced)
    new_run.ps1
    update_run.ps1                         # log commands / add evidence links mid-run
    complete_run.ps1
    capture_failure.ps1
    resolve_failure.ps1                    # close a failure case
    summarize_metrics.ps1

  tests/
    run_tests.ps1                          # full-lifecycle + per-bug regression harness

  metrics/
    summary.md
    summary.json
    runs.jsonl
```

Raw transcripts should not be committed by default. Store only sanitized excerpts.

#### Agent Adapter Contract

The core system should not care whether a run was performed by Claude Code, Codex, or an
open-source agent. Each adapter normalizes the same minimum fields:

- `agent_id`: stable name such as `claude-code`, `codex`, `ollama-helper`, or `openhands-local`
- `agent_role`: planner, executor, reviewer, verifier, classifier, helper, or mixed
- `surface`: product/runtime used for the run
- `model`: model name when known
- `artifacts`: plan, diff, evidence, review, final response, failure cases, and metrics
- `approval_boundary`: outward-facing, destructive, or hard-to-reverse actions requiring Kerry
- `result`: shipped, blocked, reverted, failed, or deferred
- `verification`: commands, checks, screenshots, tests, or user-confirmed external state

Adapters are peers under this contract; no agent owns a role, and roles are assigned per run.
Claude Code was documented first for historical reasons; Codex is likewise active, and
local/open-source agents plug into the same contract as their artifacts prove useful.

### 3.8 Core Workflows

#### Workflow A: Start a Run

Trigger: user starts a substantial coding task.

Steps:

1. Create a run folder.
2. Record task, repo, branch, objective, validation target, risk level, and selected agent adapter.
3. Link to project `STATUS.md`.
4. Optionally create/reuse a worktree.
5. Proceed with the normal agent loop, such as `/plan -> build -> /ship` for Claude Code.

Acceptance criteria:

- run folder exists before major edits
- run has a unique ID
- run links to repo and branch
- run states expected validation

#### Workflow B: Ship a Change

Trigger: user or agent invokes `/ship`.

Steps:

1. Gather diff.
2. Run independent review.
3. Address must-fix findings.
4. Run validation commands.
5. Capture evidence.
6. Write `evidence.md`, `review.md`, `final.md`, and `diff.patch`.

Acceptance criteria:

- no substantial "done" without evidence
- reviewer findings are recorded
- test/lint/typecheck outputs are summarized
- risks and follow-ups are explicit

#### Workflow C: Capture Failure

Trigger: tests fail, reviewer finds a serious issue, user reports a regression, or agent behavior is wrong.

Steps:

1. Create `failures/CASE-####_slug/`.
2. Record expected vs actual behavior.
3. Record repro command or manual reproduction steps.
4. Classify failure.
5. Link to run, repo, commit, branch, and files.
6. Add or specify regression test.
7. Record fix and prevention layer.

Failure taxonomy:

- bad context
- bad plan
- wrong file edited
- syntax/type error
- test failure
- hallucinated API
- unsafe command
- weak verification
- user intent misunderstood
- tool error
- environment/platform issue
- permission issue
- shortcut/gamed check
- regression introduced

Acceptance criteria:

- every serious failure has a case
- every fixed bug has a regression where practical
- every case names a prevention layer

#### Workflow D: Postmortem and Improve

Trigger: failure case is fixed, repeated issue appears, or review catches a pattern.

Steps:

1. Diagnose root cause.
2. Decide improvement layer:
   - project test
   - project code
   - skill update
   - global brief update
   - hook update
   - brain note
   - metrics only
3. Apply improvement with human approval for config/infra changes.
4. Link improvement back to failure case.

Acceptance criteria:

- no vague "agent messed up" labels
- fix is attached to a durable mechanism
- repeated issues become rules or skills

#### Workflow E: Sync Across Machines

Trigger: moving between Windows desktop and Mac.

Steps:

1. Commit project work before switching machines.
2. Sync `agentic-workflow`, `.claude`, and brain according to existing process.
3. Do not treat Mac uncommitted state as canonical unless explicitly decided.
4. Keep raw/private logs local unless sanitized.

Acceptance criteria:

- run/failure artifacts travel intentionally
- no source-of-truth ambiguity
- no credential material is synced

### 3.9 Functional Requirements

#### FR1: Run Records

The system must support creating a run record with:

- run ID
- date/time
- repo
- branch/worktree
- task objective
- user prompt summary
- validation plan
- risk level
- files changed
- commands run
- evidence links
- reviewer result
- final outcome

#### FR2: Failure Cases

The system must support creating failure cases with:

- case ID
- linked run
- summary (one line)
- failure class
- severity (`must_fix` / `should_fix` / `escaped_bug` / `blocker` / `note`)
- expected behavior (case file `expected.md`)
- actual behavior (case file `actual.md`)
- repro steps (case file `repro.md`; `repro_command` in JSON)
- evidence (case file `evidence.md`)
- proposed / applied fix (case file `fix.md`)
- regression test (case file `regression.md`; `regression_test` in JSON)
- prevention layer
- status + resolution (`resolve_failure.ps1` sets `status`, `resolved_at`)

#### FR3: Ship Report

The `/ship` workflow must produce a structured report with:

- original intent
- what changed
- validation performed
- evidence
- independent review notes
- risks
- follow-ups

#### FR4: Permission Policy

The system must define approval levels for coding tasks.

Minimum policy:

- Auto: local read/search/edit/test/lint/typecheck.
- Approval: delete files, install packages, edit secrets, push, deploy, migrations, external APIs,
  write to Mac, write outside current repo, change global config.
- Blocked: mass messaging, financial actions, credential exfiltration, destructive operations outside
  explicit scope.

#### FR5: Cross-Platform Path Handling

Run and failure records must preserve useful paths across:

- Windows absolute paths
- WSL paths
- Mac paths

Minimum approach:

- store canonical machine: `windows`, `wsl`, or `mac`
- store repo name
- store repo-relative paths whenever possible
- avoid hardcoding WSL paths for Windows-native projects

#### FR6: Metrics

The system must summarize (all produced by `summarize_metrics.ps1` as of v1):

- runs started (`runs_started`)
- runs shipped/complete (`runs_shipped`)
- failed runs, i.e. runs with a linked failure (`failed_runs`)
- failure classes (`failure_classes`)
- must-fix failure count (`must_fix_failures`)
- escaped bugs (`escaped_bugs`)
- regressions added (`regressions_added`)
- open / resolved failures (`failures_open`, `failures_resolved`)
- validation evidence rate (`validation_evidence_rate_percent`) - counts a run only when it
  has a real evidence link or a non-stub `evidence.md`; shipped status alone does NOT count
- average minutes start to ship over shipped/complete runs only (`average_minutes_start_to_ship`)

#### FR7: Sanitization

The system must not commit:

- API keys
- OAuth tokens
- raw private transcripts
- `.env` files
- full email/message contents
- credential-bearing command output

Raw logs may exist locally but should be gitignored.

#### FR8: Hook Compatibility

Windows hook behavior must remain safe:

- trust gate before inspecting repos
- no repo content inspection for untrusted repos
- no mutation from Stop hook
- no blocking on report-only lint
- explicit trusted repo allowlist

Mac hook parity is optional in MVP but must be documented.

### 3.10 Nonfunctional Requirements

- Local-first.
- Git-backed.
- Low friction.
- No database.
- Human-readable markdown.
- Machine-readable JSON where useful.
- No automatic outward-facing actions.
- No new always-on daemon in MVP.
- Works when offline except for Claude/API-dependent work.
- Compatible with Windows-native workflows.

### 3.11 Data Schemas

This is the exact shape emitted by the v1 scripts (kept in sync with `scripts/new_run.ps1`
and `scripts/capture_failure.ps1`). All records are BOM-less UTF-8; arrays stay arrays even
with a single element.

#### run.json

```json
{
  "run_id": "2026-07-08_1545_fix-navbar-test",
  "created_at": "2026-07-08T14:30:00-04:00",
  "completed_at": null,
  "machine": "windows",
  "repo": "C:/Users/PC/example-repo",
  "repo_name": "example-repo",
  "branch": "agent/example-task",
  "worktree": null,
  "objective": "Fix failing navbar test",
  "user_prompt_summary": "",
  "status_path": "STATUS.md",
  "risk_level": "medium",
  "agent": {
    "agent_id": "claude-code",
    "agent_role": "mixed",
    "surface": "claude-code",
    "model": null,
    "adapter_version": "v1"
  },
  "status": "in_progress",
  "validation_plan": ["npm test", "npm run lint"],
  "files_changed": [],
  "linked_failures": [],
  "evidence_links": [],
  "reviewer_result": null,
  "final_outcome": null
}
```

`status` is one of `in_progress`, `shipped`, `complete`, `blocked`, `abandoned`. On
completion `complete_run.ps1` sets `completed_at`; a `-Force` amend adds `last_amended_at`
and preserves the original `completed_at`.

#### failure.json

```json
{
  "case_id": "CASE-0001",
  "created_at": "2026-07-08T15:00:00-04:00",
  "resolved_at": null,
  "machine": "windows",
  "linked_run": "2026-07-08_1545_fix-navbar-test",
  "repo": "C:/Users/PC/example-repo",
  "repo_name": "example-repo",
  "commit_or_branch": "agent/example-task",
  "summary": "Reviewer caught wrong order-confirmation flow",
  "failure_class": "weak_verification",
  "severity": "must_fix",
  "repro_command": "npm test -- navbar",
  "status": "open",
  "prevention_layer": null,
  "regression_test": null
}
```

`severity` is one of `must_fix`, `should_fix`, `escaped_bug`, `blocker`, `note`.
`status` is `open` until `resolve_failure.ps1` sets it to `fixed`, `wont_fix`, or `resolved`
(and stamps `resolved_at`, `regression_test`, `prevention_layer`). Narrative fields
(expected/actual/repro/evidence/fix/regression) live in the case's Markdown files, not in
this JSON.

### 3.12 Phased Roadmap

#### Phase 0: Safety and scope reset

Status (2026-07-09): done — the last open item (retired-credential debt) closed 2026-07-09.

Tasks:

- Keep AgentOS retired. **[done]**
- Revoke/delete retired AgentOS OAuth credential material. **[done 2026-07-09]** Google OAuth
  refresh token revoked; local `gmail_creds.json` / `gmail_token.json` removed from AgentOS; exact
  retired project/client IDs absent from local searches; Kerry confirmed the remaining Google-side
  surface was gone, including the last Google Calendar API. Console state was user-confirmed because
  `gcloud` was not installed/configured in this environment.
- Confirm active repos are in the validation hook trusted allowlist. **[done]**
- Document coding-task permission policy. **[done]** - `docs/permission-policy.md`.
- Add this PRD to `agentic-workflow`. **[done]** - committed with the v1 build.

Done when:

- no retired credential debt remains **[done 2026-07-09]**
- the revamp direction is committed **[done]**
- Zed/ACP is explicitly deferred **[done - section 3.15]**

#### Phase 1: Run records and ship reports

Status (2026-07-08): **done.**

Tasks:

- Add `runs/`, `templates/`, and `metrics/`. **[done]**
- Add `new_run` helper. **[done]** - plus `update_run`, `complete_run`.
- Update `/ship` to write structured evidence artifacts. **[done]** - the `ship` skill now
  detects an active run and writes `final.md`/`evidence.md` + calls `complete_run.ps1`.
- Require substantial tasks to link to a run record. **[done]** - documented in USAGE +
  the ship skill.

Done when:

- one real project change ships with a complete run record **[done - the v1 build itself]**
- evidence/report is readable without opening chat history **[done]**

#### Phase 2: Failure-to-eval capture

Status (2026-07-09): **done.** Capture + resolve mechanics are done and tested; 3 real cases
(CASE-0001..0003) seeded + resolved 2026-07-09, and `/review` is wired (step 5).

Tasks:

- Add `failures/`. **[done]**
- Add failure template. **[done]** - `templates/failure-case.md`.
- Add `capture_failure` helper. **[done]** - plus `resolve_failure` to close cases.
- Update `/review` and `/ship` to create/link failure cases for serious findings.
  **[done]** - `/ship` step 6 + `/review` step 5 both route serious findings to `capture_failure`.
- Add first three real failure cases from recent known issues if worth preserving.
  **[done]** - CASE-0001..0003 seeded 2026-07-09 (R14 diff drop, D4 crash, overwrite+dup events),
  each resolved with a regression test + prevention layer.

Done when:

- a failed task can be reproduced or inspected from the failure folder **[done]**
- fix links back to a regression or workflow improvement **[done - `resolve_failure`
  records `regression_test` + `prevention_layer`]**

#### Phase 3: Metrics and postmortem loop

Status (2026-07-10): **done.** Metrics helper is built and honest; the postmortem/distill wiring
landed 2026-07-10 — `/distill` (step 6) harvests resolved failure cases into brain notes by
CASE-#### id (CASE-0001..0009 distilled on the first run).

Tasks:

- Add `summarize_metrics` helper. **[done]**
- Produce `metrics/summary.md`. **[done]** - plus `summary.json`.
- Add `/postmortem` or extend `/distill` for failure lessons. **[deferred]**
- Track repeated failure classes. **[done]** - `failure_classes` rollup.

Done when:

- the system can say what improved over time **[partial - metrics exist; needs run history]**
- repeated issues are visible **[done]**

#### Phase 4: Cross-machine hardening

Status (2026-07-08): **deferred.** Records are BOM-less and use repo-relative + `machine`
fields (so they sync cleanly), but the persistent-session decision and Mac hook parity are
not started. Note the scripts are Windows PowerShell; a WSL/Mac helper is not yet ported.

Tasks:

- Finish Mac -> desktop persistent session decision.
- Decide Mac hook parity.
- Add path mapping conventions.
- Confirm run/failure artifacts sync cleanly.

Done when:

- a task can start on desktop, be reviewed from Mac, and preserve run state cleanly

#### Phase 5: Optional cockpit integrations

Status (2026-07-08): **not started (gated).** Entry criteria below are not yet met (fewer
than 10 run records, fewer than 3 failure-to-improvement cases).

Candidates:

- Zed/ACP adapter conformance (separate user-owned project; the core owns only the shared
  contract and normalized artifacts)
- HTML/Lavish run dashboard
- lightweight local dashboard
- MCP wrappers
- local code index

Entry criteria:

- Phases 1-3 are used habitually.
- At least 10 run records exist.
- At least 3 failure cases have led to durable improvements.

### 3.13 Success Metrics

After 30 days:

- 10+ completed run records
- 90%+ substantial tasks have evidence artifacts
- 100% serious bugs have regression tests or a documented reason not to
- 3+ failure cases converted into durable improvements
- 0 accidental pushes/deploys/sends
- 0 credential leaks into tracked artifacts
- at least one cross-machine handoff tested end-to-end

### 3.14 Risks

#### Risk: Process overhead kills usage

Mitigation:

- make run records lightweight
- use templates
- only require full records for substantial tasks

#### Risk: The system becomes documentation theater

Mitigation:

- every record must link to evidence, diff, test output, or failure case
- metrics should count actual shipped changes and regressions

#### Risk: Raw traces expose private data

Mitigation:

- commit summaries, not raw transcripts
- gitignore raw logs
- sanitize excerpts

#### Risk: Rebuilding a harness distracts from useful work

Mitigation:

- no custom executor in MVP
- start from the agents already in use (Claude Code and its skills, Codex) rather than building new ones
- keep the core run/failure/evidence format agent-agnostic
- build recordkeeping first

#### Risk: Windows/Mac/WSL split causes path drift

Mitigation:

- canonical repo-relative paths
- machine field in JSON
- desktop remains source of truth unless explicitly changed

### 3.15 Explicit Decision on Zed/ACP

Zed/ACP is **separate from the reliability-core MVP**, not abandoned. It may proceed as a
user-owned adapter experiment in parallel once it targets the stable adapter contract. Production
positioning remains gated on an end-to-end conformance demo.

Rationale:

- The active workflow is Claude Code-centered, but the product should be agent-agnostic.
- Reliability artifacts are missing regardless of editor.
- The core should not absorb ACP transport, Zed UI, model sessions, or editor-specific tool code.
- ACP integration would create a second control surface before the first one has durable evals.
- A separate adapter lets Kerry learn and experiment with ACP without forking the workflow contract.
- If Zed is added later, it should call into the existing run/failure system, not replace it.

Future Zed story:

```text
Zed = optional cockpit
Claude Code / Codex / Zed-ACP / local runners = separate agent adapters
Agentic Workflow v3 = agent-agnostic reliability/eval core
Project repos = execution targets
```

See `docs/architecture.md` and `adapters/zed-acp.md` for the ownership boundary and conformance
flow.

### 3.16 Final Recommendation

Build v3 as an adapter-ready reliability layer, not a new executor platform. **v1 of that layer is built and hardened to
fully-working** (run/failure/metrics scripts hardened under PS 5.1, a **64-check regression harness,
deterministically green**, `/ship` + `/review` wired to run records). What remains, in order:

1. **Use it on real tasks** to accumulate run history (target: 10+ records) - the metrics only
   tell a story once there is history.
2. **Seed 2-3 failure cases** from the v1 script bugs found in this review pass, each linked
   to its regression in `tests/run_tests.ps1`. **[done 2026-07-09]** - CASE-0001..0003.
3. **Wire `/review`** to offer `capture_failure` on serious findings. **[done 2026-07-09, step 5]**
   Still open: extend `/distill` for failure lessons (Phase 3 remainder).
4. **Use the adapter contract on real tasks** - Claude Code first, then Codex/local helpers once the
   evidence format proves useful.
5. **Build the Zed/ACP experiment separately against the adapter contract.** It may proceed in
   parallel; treat it as production-ready only after it completes the success, failure, and
   permission conformance flows in `adapters/zed-acp.md`.

## 4. v2 Scope — Pipeline Harness (approved 2026-07-10)

### 4.1 Decision and supersession

Kerry's direction (2026-07-10): the flagship becomes an **orchestration system** — a harness that
is itself the boss, driving swappable coding agents (Claude Code, Codex, local models) through a
task-shaped pipeline. This deliberately supersedes the v1 non-goal "no custom full coding-agent
harness" (§1.3, §3.4), which was conditioned on the reliability layer not existing yet. Those
conditions no longer hold: v1 is built, deterministically green (64-check regression harness), and
exercised (9 runs, 10 resolved failure cases with regressions).

The core warning of §1.3 remains binding and is restated as a v2 invariant:

> The harness owns stage sequencing, briefs, gates, and records. It never re-owns the agents'
> tools — file access, shell, context gathering, and permission enforcement stay inside each agent
> surface per `adapters/adapter-contract.md`. Thin conductor, not a replacement executor.

### 4.2 What v2 is

A Node/TypeScript CLI at `harness/` that, given a coding task:

1. classifies it and generates a pipeline from **deterministic templates** (feature / bugfix /
   refactor / review) — loose, not rigid: stages skip or park per task;
2. drives agents **headless** through the stages (`claude -p`, `codex exec`), each stage receiving
   a concrete, minimal brief (only the artifacts it needs) — the token-savings and
   concreteness mechanism;
3. enforces the human gates: plan approval is ON by default; escalation is always
   **park-to-disk and wait for Kerry** (exit 0, `PARKED.md`, `resume` to continue) — no
   notifications, nothing always-on;
4. requires an independent review stage (different agent than the builder when available) and
   evidence at verify — a stage claiming "tests pass" without output fails;
5. writes the standard v1 records natively (run.json / plan.md / review.md / evidence.md /
   commands.jsonl / runs.jsonl, BOM-less UTF-8, schema §3.11) — `summarize_metrics.ps1` parses
   harness runs unchanged.

Full spec: `docs/orchestration.md`.

**Thesis (made explicit 2026-07-12):** the harness is a *model-appreciating framework* — its
mechanisms (append-only records, human gates, independent fresh review, native verification,
adapter contracts) gain value as the underlying models improve, rather than being obsoleted by
them. Components that would depreciate with a better model (prompt tricks, weakness workarounds)
are deliberately out of scope; see the design invariant in `docs/architecture.md`. The v2.1
economics pass (2026-07-12) reframed the value claim honestly: the harness is **defect insurance
with an audit trail** — on its first real-size run the fresh reviewer caught bugs a green test
suite missed, while session continuity, delta re-reviews, and native verify cut the token premium
(see `docs/orchestration.md` §v2.1).

### 4.3 v2 non-goals

Coding tasks only (no AgentOS territory: no personal automation, comms, scheduling). No parallel
sub-runs (deferred). No LLM-generated pipelines (templates are deterministic in v1). No daemons,
schedulers, or notifications. No automated pushes or outward-facing actions. The PS scripts stay
as the human/manual CLI; the harness does not shell out to them.

### 4.4 v2 success criteria

- One real coding task end-to-end through the harness driving **Claude Code**, and one driving
  **Codex** (gated on the headless capability spike), each with a complete run record.
- Per-stage token/cost accounting captured from agent output — the "saves tokens" claim is
  **measured against an unharnessed baseline of the same task**, not asserted.
- Existing 64-check PS harness stays green; harness unit/integration suite green.
- Park/resume proven: a run parked at the plan gate resumes cleanly in a fresh process.
