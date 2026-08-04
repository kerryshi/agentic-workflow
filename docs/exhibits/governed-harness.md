# Exhibit — Governed Agent Harness

> **Status (2026-07-23):** the harness repo is FROZEN at its 2026-07-16 peak (ruling
> 2026-07-19); this exhibit documents that peak. The governance unit suite was **re-run
> fresh on 2026-07-23** against a clean extract of the frozen HEAD (`7708ca6`) —
> 33/33 green, red watched first — logs in [`evidence/`](evidence/). The
> browser E2E, judge latencies, and refuse-first hook proof were **not** re-run; they are
> cited from recorded evidence and labeled as such below. Harness source paths are
> relative to the `webllm-agent-harness` repo (local, no public remote); evidence paths
> are relative to this repo.

## An agent whose every tool call has to argue its way out

Most agent demos trust the model with its own tools. This one doesn't. The Governed
Agent Harness is a single-file, in-browser agent — WebLLM running Qwen2.5-1.5B on WebGPU,
no server — where every tool call the model proposes passes through a three-tier
`authorize()` pipeline before it executes, and every decision lands in an append-only,
exportable audit log. The file is `webllm-agent-harness.html`: 953 lines measured, no
build step, one dependency (`@mlc-ai/web-llm` via esm.run).

The framing is deliberate: **deterministic rules for hard limits, an LLM judge for gray
areas, a human for irreversibility** — never judge-only. It's the same premise as the
main workflow (`docs/write-up-draft-2026-07.md`): an actor cannot be its own verifier, so the
verifier has to be structural, not rhetorical.

## Architecture: three tiers, cheapest and least persuadable first

1. **Deterministic policy engine** (no model). Per-tool allowlists, argument schema
   validation, a domain allowlist for `fetch_url`, code-pattern blocks for `js_eval`,
   per-tool and per-run budgets. Deny-by-default: a tool absent from the policy is
   denied, and that is not configurable. It decides most cases at 0 ms and cannot be
   prompt-injected because there is nothing to persuade.
2. **LLM judge**, consulted only for calls the policy marks `review`. Pluggable — any
   OpenAI-compatible endpoint (Ollama over Tailscale is the intended setup). The
   invariant that matters: the judge can only *narrow* Tier 1 (deny or escalate), never
   override a Tier-1 deny — a deny returns before the judge is consulted. A malformed,
   out-of-enum, or unreachable judge fails safe to escalate, never to allow.
3. **Human gate.** Tools flagged `humanGate` (all egress, by default) and judge
   escalations pause the run with a click-to-approve card. A judge "allow" cannot clear
   the gate — there is a unit test whose whole job is proving that.

The audit log records proposal → per-tier verdict (reason, latency, policy revision) →
outcome, exports as JSON, and can be **replayed against an edited policy** in-page, so
the log doubles as a regression suite for policy changes. Privilege separation is
genuine rather than cosmetic: `js_eval` runs in a worker with no DOM, network APIs
nulled, a 5 s hard timeout, and termination after each call; the judge runs in a
different process on a different port; the policy lives outside anything the agent can
touch.

The governance core is a DOM-free section of the HTML, extracted by marker comments and
unit-tested in Node (`tests/governance.test.mjs`, 33 dependency-free tests). A
pre-commit hook (`.githooks/pre-commit`) runs the suite on every commit,
refuse-over-skip: missing node or a missing test file is a named refusal, never a
silent pass.

## The evidence table, honestly labeled

| Claim | Status | Evidence |
|---|---|---|
| Governance suite 33/33 green at frozen HEAD `7708ca6`, node v24.17.0, zero deps installed | **Fresh re-run 2026-07-23**, red watched first (planted assertion → FAIL + exit 1, then reverted from the frozen HEAD blob → 33/33, exit 0) | red: [`evidence/governed-harness-suite-red-plant-2026-07-23.log`](evidence/governed-harness-suite-red-plant-2026-07-23.log) · green: [`evidence/governed-harness-suite-green-2026-07-23.log`](evidence/governed-harness-suite-green-2026-07-23.log) |
| Browser E2E 10/10: model loaded in-browser, 4 demo tasks, human-gate cards approved, blocked-domain deny, live policy edit rev 1→2, 36-entry audit export, replay 0 changed verdicts | **Recorded 2026-07-16** (Playwright driving headed Chrome, WebGPU on the RTX 5070) — not re-run | `runs/2026-07-16_2044_browser-e2e-smoke-of-the-governed-agent-harness/evidence/results.json`, screenshots `01`–`09` |
| Real llama3.2 judge verdict in ~1.1 s warm ("allow — js_eval is configured to allow…") | **Recorded 2026-07-16** — not re-run | same run, `09-judge-llama32-real-verdict.png`, `final.md` |
| qwen3:4b judge unusable: every judge consult in the E2E audit log hit the 90 s timeout and escalated | **Recorded 2026-07-16** | same run, `audit-export.json` entries a1/a2/a10, judge tier `ms: 90001` (a10: `90001.5`) |
| Deny-by-default absorbing model flailing: 12 consecutive proposals of the literal placeholder `tool.name` all denied at Tier 1 in 0 ms; fetch budget exhausted and enforced at 4/4 | **Recorded 2026-07-16** | same run, `audit-export.json` entries a25–a36, a7 |
| Pre-commit gate refuses a red suite: planted crash → "pre-commit REFUSAL: governance suite failed (exit 1)", HEAD unmoved at `ea68f1f` | **Recorded 2026-07-19** — not re-proved (the hook's committed `env.sh` pins the main checkout, which is frozen) | harness repo `STATUS.md`, CI-gate block |

Nothing in the fresh column required a browser, a GPU, or a model — which is the point
of extracting the core. Everything that does require them is labeled recorded; a fresh
browser run would have required a live headed-Chrome session against the frozen repo and
was not performed.

## The negative finding, stated plainly

**The judge tier's planned default model was unusable, and the shipped "real judge"
number comes from a fallback.** qwen3:4b — the model first wired as judge — burns
45–90 s per verdict in thinking mode. In the recorded E2E, every judge consultation in
the 36-entry audit log timed out at 90 s and escalated to the human
(`audit-export.json` a1/a2/a10); that log contains **zero** sub-second judge verdicts.
The ~1.1 s figure belongs to llama3.2, wired and verified at the end of the same session
and captured in one screenshot, not across the demo arc. Two honest readings coexist:
the fail-safe did exactly what it was designed to do (timeout → escalate, never allow —
the invariant held under real failure), and also a judge that always times out is not a
judge, it's a human gate with a 90-second tax. The judge tier is proven *safe*; it is
only spot-proven *useful*.

Named holes, accepted and on record in the harness `STATUS.md`: `--no-verify` bypasses
the pre-commit gate; rebase/cherry-pick run no hooks; a fresh clone must re-run the
`core.hooksPath` install; the browser E2E stays a manual evidence run (WebGPU + local
judge are un-CI-able on any hosted runner); a GUI-client commit has never been
exercised.

## Why this exhibit earns its place

The harness is the workflow's premise turned inward and miniaturized: the same
actor/verifier separation the pipeline enforces between agents, enforced here between an
agent and its own tools — with the deterministic tier doing the boring 0 ms work, the
judge narrowing but never widening, the human owning irreversibility, and an audit log
you can replay as a regression suite. And its record keeps the house style: the failure
(qwen3:4b) is in the log next to the successes, because a governance demo whose audit
trail only contains allows would be decoration.

**Paths.** Harness repo (local): `webllm-agent-harness.html`, `tests/governance.test.mjs`,
`.githooks/pre-commit`, `README.md`, `STATUS.md`. This repo: recorded evidence under
`runs/2026-07-16_2044_browser-e2e-smoke-of-the-governed-agent-harness/evidence/`; fresh
re-run logs under [`evidence/`](evidence/) (full method capture — extract method, toolchain,
cleanup proof — in the sprint lane's `EVIDENCE.md`).
