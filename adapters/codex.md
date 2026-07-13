# Codex Adapter

Status: active peer agent

Codex can use the same reliability layer by starting a run record, preserving evidence, and closing
with a ship report. Codex should not be treated as a separate MVP; it is another adapter into the
same run/failure/evidence system.

## Start

```powershell
& C:\Users\PC\agentic-workflow\scripts\new_run.ps1 `
  -Objective "Describe the task" `
  -Repo C:\Users\PC\some-repo `
  -AgentId codex `
  -AgentRole mixed `
  -AgentSurface codex `
  -ValidationPlan 'pytest', 'ruff check .'
```

## Headless driver (v2 harness)

Installed 2026-07-11: `npm i -g @openai/codex` → codex-cli 0.144.1. Auth reused the existing
`~/.codex/auth.json` from Codex Desktop (`codex login status` → "Logged in using ChatGPT") — no
re-login was needed.

`harness/src/adapters/codex.ts` drives it headless:

- Invocation: `codex exec --json --skip-git-repo-check [-m <model>] [--dangerously-bypass-approvals-and-sandbox] -`
  with the stage brief on **stdin** (never argv — Windows quoting) and spawn `cwd` = target repo.
- On Windows the npm `codex.cmd` shim can't be spawned without a shell (Node's CVE-2024-27980
  guard), so the driver runs the package's `bin/codex.js` through node — resolved off PATH
  (quote-stripped per entry; Windows PATH entries may legally be quoted) with `%APPDATA%\npm` as
  a fixed fallback candidate. `HARNESS_CODEX_BIN` overrides; a `.js` value runs through this same
  node, which is how the driver-level tests stub the CLI.
- `--dangerously-bypass-approvals-and-sandbox` maps the harness's `skipPermissions` default
  (Kerry's standing full-auto decision); `--safe-perms` pins an EXPLICIT `--sandbox read-only` —
  codex's *default* sandbox is read-only today but `~/.codex/config.toml` (which Codex Desktop
  rewrites) can override it, so the guardrail is passed by construction. `codex exec` is
  non-interactive, so there is no prompt-based middle ground.
- JSONL contract (captured live, fixtures in `harness/tests/codex-driver.test.ts`): last
  `item.completed`/`agent_message` is the result text; `turn.completed.usage` sums to token
  accounting (`cached_input_tokens` → `cache_read`); `error` / `turn.failed` become honest stage
  failures with the raw tail preserved. No cost field exists, so `cost_usd` = 0 by construction.
- The run-level `--model` only applies to the builder agent's stages; a cross-agent reviewer runs
  on its own default model (a claude model name would make `codex exec -m` exit 1).

Live conformance (run `2026-07-11_0636`): `available()` → true, sandboxed `run()` returned
`ok:true` with parsed stage JSON and real usage. The engine's reviewer fallback rule is now
actually exercisable: claude builds, codex reviews.

Hardened same-day by a 3-lens adversarial review (13 confirmed findings, all addressed):
sync `spawn` throws now resolve as `spawnError` instead of rejecting (CASE-0016 — the .cmd
EINVAL path could previously crash `harness run` pre-run), timeouts can no longer strand a
stage as `running` (CASE-0017 — POSIX process-group kill + grace force-finish), and a run-level
`--model` that targets the builder is dropped for cross-agent stages *with a log line*, never
silently.

## Responsibilities

- Use `AGENTS.md` and project docs as the task contract.
- Keep file edits scoped.
- Record important commands through `update_run.ps1`.
- Complete through `complete_run.ps1` after validation.
- Link serious misses to `capture_failure.ps1`.

## History

Codex work predates this adapter doc: the v3 MVP build
(`runs/2026-07-08_1545_build-agentic-workflow-v3-mvp`), most of the item H adapter wave
(2026-07-09 evening Codex Desktop threads), and the AgentOS OAuth revocation ran without
attribution. The run records were backfilled on 2026-07-10 (marked inferred); from here on,
attribution is recorded at run start — CASE-0008's regressions guard the defaults.
