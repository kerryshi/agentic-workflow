# Agentic Workflow — User Manual

For Kerry and any agent instance driving the system. Live state lives in `HANDOFF.md` (flagship)
and each project's `STATUS.md`; cross-project goals in `PORTFOLIO.md`. This file explains **how to
use the system**. Last updated: 2026-07-10.

---

## 1. What this is

One development system, agent-agnostic since 2026-07-10: **coding agents are peers** — Claude Code,
Codex, the Zed ACP agent, and local models all plug into the same run/failure/evidence contract
(`adapters/adapter-contract.md`). Agents get roles per run (planner / executor / reviewer /
verifier / classifier / helper / mixed); no agent owns a role. The compounding assets:

- **The global brief** — `~/.claude/CLAUDE.md` (operating contract, guardrails, promoted rules)
- **9 skills + 2 subagents + hooks** — `~/.claude/skills|agents|hooks`
- **The reliability layer** — this repo: run records, failure cases, metrics, regression harness
- **The brain** — `C:\Users\PC\brain`: capture → distill → retrieve → promote

## 2. Surfaces — where work happens

| Surface | How | Notes |
|---|---|---|
| **Claude Code CLI** | terminal on the desktop | Primary surface; the brief + skills load automatically |
| **Zed Agent Panel** | open Zed → Agent Panel → "Agentic Workflow" | One approved Code prompt = one recorded run (agent `zed-acp`, Sonnet executor, fresh reviewer, fail-closed tool allowlist). Repo: `C:\Users\PC\zed-acp-agents` |
| **Codex Desktop** | Codex app threads | Peer agent. Start a run with `--agent-id codex` so the work is attributed — unattributed agent work is how CASE-0008 happened |
| **Local models** | Ollama etc. | Peer, evidence-gated: start with helper roles (classify, summarize, tag) via `--agent-id local-model` |
| **MacBook** | `ssh mac`, mirrors | Thin client; only commits travel (`git push mac master` / `sync-to-mac.sh`) |

## 3. The working loop

1. **Orient** — `/resume` in a project (rebuilds from STATUS.md + git) or the `state-survey`
   workflow for the whole estate. Read PORTFOLIO.md before cross-project planning.
2. **Plan** — `/plan` for anything multi-file or >~30 lines. When the ask is ambiguous or
   product-shaped, `/plan` opens with a **grill session**: the agent interrogates you until shared
   understanding, *then* plans. Wait for approval.
3. **Open a run record** (substantial tasks): `harness new-run` with an honest `--agent-id`.
4. **Build** — small scoped diffs, one concern per change.
5. **Verify with evidence** — tests/lint AND proof (output, before/after, log). "Tests pass" ≠ done.
6. **Ship** — `/ship` runs a fresh independent `/review` (the author never reviews their own work),
   then commit locally. Pushes are per-request, never assumed.
7. **Close the loop** — `harness complete-run` with evidence; capture learnings to the brain inbox.

## 4. Skills — when to reach for each

| Skill | Use when |
|---|---|
| `/plan` | Non-trivial change ahead — **grill first when ambiguous** (interrogate to shared understanding), then propose and STOP for approval |
| `/review` | Fresh independent review of the current diff (reviewer subagent); serious findings become failure cases when a run is active |
| `/ship` | Change is "done" — independent review + checks + evidence + change report; wired to the run lifecycle |
| `/resume` | Re-entering a project — reconstructs state, shows evidence, confirms before acting |
| `/distill` | Brain inbox has entries (or failure cases unharvested) — turns them into atomic linked notes; promotes ≥3-recurrence lessons to the brief |
| `/scaffold` | New Python / TS-React / Node project skeleton |
| `/worktree` | Parallel work that must not collide — isolated git worktree |
| `/gnhf` | Large evaluable task with a deterministic checker — guarded fresh-context loop |
| `/lavish` | Plan/report/comparison easier reviewed visually — HTML review surface with annotations |
| `/lab`, `/mac` | WSL2 ML lab check; run something on the MacBook |
| `state-survey` (workflow) | Start of a planning session or after time away — parallel readers over config/brain/launchpad/projects |

## 5. Reliability layer — the run lifecycle

One CLI, `harness`, running identically on Windows and macOS. (The PowerShell scripts were retired
2026-07-13 — they only ever ran on the desktop, so the Mac could not open a run record at all.)

```bash
cd harness && npm ci && npm run build   # once

# open (records agent attribution — required honesty)
node dist/cli.js new-run "..." --repo /path --agent-id claude-code --role executor \
  --model claude-fable-5 --validate "npm test" --validate 'pytest -k "a,b"'

# during: log commands / attach evidence
node dist/cli.js update-run --command "npm test" --result "138 passed" --evidence-link evidence.md

# close with evidence (captures an appliable diff, non-ASCII filenames included)
node dist/cli.js complete-run --status shipped --outcome "..." --capture-diff

# metrics
node dist/cli.js metrics
```

Omit the run id and the **single** in-progress run for that repo is used. Two candidates is an
ambiguity, and ambiguity is **refused, never guessed** — the old script sorted every in-progress run
across every repo and silently completed the newest, exiting 0 having closed the wrong record
(CASE-0007).

`--validate` repeats and each occurrence is one whole command; it is never comma-split, because
`pytest -k "a,b"` is one command.

**When does a task get a run record?** Substantial work: multi-file changes, anything shipping to a
project, anything an agent executes autonomously. Not for one-line answers.

**Statuses are honest:** `shipped` (accepted), `complete` (done, human acceptance pending — the Zed
adapter always uses this), `blocked`, `abandoned`. Never report done without evidence.

## 6. The failure → learning cycle

1. A review or run surfaces a serious defect → `harness case new` (taxonomy in PRD §3.8),
   linked to the run.
2. Fix ships **with a regression test that fails before and passes after** — no exceptions.
3. `harness case resolve` names the regression + prevention layer; regenerate metrics.
4. `/distill` harvests resolved cases into brain notes (by CASE-#### id) when the lesson
   generalizes; a lesson that bites ≥3 times gets promoted into the global brief.

## 7. Guardrails (non-negotiable)

- **Ask first:** destructive/irreversible actions, pushes, new remotes, anything outward-facing,
  anything in prod. Never auto-send email.
- **Evidence before "done";** honest incomplete beats confident wrong; gaming a check = failure.
- **Escalate ambiguity:** product/UX, API/data-model, security tradeoffs — bring options, don't guess.
- **Attribution is required:** every run names its agent at start (`manual` when unknown — never a
  flattering default).
- **2 failed attempts on the same error → stop,** summarize, hypothesize; don't flail.
- **Local-first git:** committing is the baseline; remotes/pushes are per-project decisions.

## 8. Multi-session protocol

Parallel sessions run from `C:\Users\PC`. Before acting: read PORTFOLIO.md + the project's
STATUS.md; check the shared task list (claim before working); don't touch files another live
session is mid-change on; escalations stay escalated until Kerry rules; update STATUS/PORTFOLIO
when the picture changes.

## 9. Quick reference

| I want to… | Do |
|---|---|
| Get back into a project | `/resume` in its directory |
| See the whole estate | `state-survey` workflow, or read `PORTFOLIO.md` |
| Start real work | `/plan` → approval → `harness new-run` → build |
| Finish real work | evidence → `/ship` → `harness complete-run` → commit |
| Code from Zed | Agent Panel → "Agentic Workflow" → approve the Code turn |
| Attribute Codex work | `harness new-run "..." --agent-id codex --surface codex-desktop` |
| Capture a lesson | one dated line in `brain\LEARNINGS.md` → `/distill` later |
| Drive a task through the v2 pipeline | `cd <repo>` → `harness run "<task>"` → read `plan.md` → `harness resume <id> --approve` (global command since 2026-07-11) |
| …from Windows PowerShell | WORKS since 2026-07-16 — CurrentUser policy is `RemoteSigned`, verified in a clean `powershell.exe -NoProfile` (`harness status` listed runs); if it ever regresses to Restricted, fall back to Git Bash / `harness.cmd` / `node harness/dist/cli.js`. The task must be a full sentence (goal + context), never a slash command like `/plan` — skills run inside Claude Code, not the harness |
| Check system health | `npm test` in `harness/` (165 checks) · `harness doctor` · `metrics/summary.md` |
| Sync the Mac | `git push mac master` per repo · `bash ~/sync-to-mac.sh` |
