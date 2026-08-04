# Exhibit — zed-acp-agents: an ACP v1 coding agent for Zed

> **Status:** FROZEN as a write-up exhibit at its 2026-07-16 peak (Kerry ruling 2026-07-19,
> ratified in the kill/park list on the internal portfolio board); last commit `a671b7a`
> (2026-07-19, CI-gate hardening). The repo lives at `C:\Users\PC\zed-acp-agents` — local-only by choice, no remote,
> backed up as a dated git bundle. Paths written `zed-acp-agents:<path>` refer into that repo;
> everything else links repo-relative inside this one.
>
> **Evidence policy for this page:** everything that can run without a model or live hardware was
> re-run fresh on 2026-07-23 in a clean detached worktree of `a671b7a` (logs in
> [`evidence/`](evidence/)). The fresh runner was itself proven capable of failing — a deliberately
> planted assertion turned the suite red (10 pass / 1 fail, exit 1) before the plant was reverted
> and the green captured — because a green log from a runner never seen red is the exact false-pass
> mode this exhibit documents. Model-driven turns are cited from their recorded run records and
> labeled as such — re-running them would have required live Claude Code spend and was not done.

## The turn that refused instead of pretending

On 2026-07-16 I pointed this agent at its first real project task. Every Code turn failed —
`ENOENT: no such file or directory ... scripts\new_run.ps1`. Three days earlier the flagship repo
had retired its PowerShell lifecycle scripts for a Node CLI, and this adapter — a separate repo,
a separate consumer of that interface — was never migrated. The integration was dead.

The part worth exhibiting is what the agent did about it: nothing. It refused the turn, loudly,
with the real error. It did not fall back to pretending the run was recorded, and it did not
complete work without a record. Fail-closed held exactly when the happy path disappeared. That
became [CASE-0024](../../failures/CASE-0024_zed-acp-reliability-core-still-invoked/failure.json),
with a regression test watched failing first (`zed-acp-agents:test/reliability-cli.test.js` — red
with ENOENT against the pre-fix core, green after the migration in commit `74f5b96`), and the same
task then completed end-to-end through the migrated core.

## What it is

An [ACP](https://agentclientprotocol.com) v1 agent that plugs Zed's Agent Panel into the same
reliability contract as every other agent in this workflow ([adapter contract:
`adapters/zed-acp.md`](../../adapters/zed-acp.md)). Five source files, ~770 lines of Node, zero
npm dependencies (`wc -l zed-acp-agents:src/*.js` at `a671b7a`). It speaks newline-delimited
JSON-RPC over stdio, drives Claude Code (Sonnet by default) as the executor, and:

- runs three modes — **Ask** (read-only), **Code** (plan → explicit Zed permission → scoped edits
  → allowlisted validation → fresh read-only review → recorded run), **Review** (read-only);
- enforces a fail-closed tool allowlist under Claude Code's `dontAsk` mode — no commits, pushes,
  installs, network, or arbitrary shell;
- redacts credential forms (JSON-quoted keys, provider tokens, PEM blocks, connection strings)
  from every reliability summary on the real write path;
- records every approved Code prompt as one run in the flagship's append-only records, closing it
  as `complete` or `blocked` — never `shipped`, because acceptance stays human.

## Architecture

```text
Zed Agent Panel
    | ACP v1 over newline-delimited JSON-RPC/stdio
    v
zed-acp-agents  (editor/executor layer)
    |-- session modes + permission UX
    |-- Claude Code process (executor), fresh read-only reviewer
    |-- constrained local edit/validation tools
    v
agentic-workflow harness CLI  (reliability control plane)
    `-- new-run / update-run / complete-run -> normalized run, evidence, review, diff records
```

The adapter owns protocol, sessions, model invocation, and permission enforcement; the core owns
schemas, taxonomy, and history. The adapter never grows a competing reliability schema
(`zed-acp-agents:docs/architecture.md`).

## The evidence, honestly

| Claim | Fresh or recorded | Evidence |
|---|---|---|
| Suite green at `a671b7a`: syntax check + 11/11 `node:test` + dependency-free build (includes both CASE-0024 regression tests) | **Fresh re-run 2026-07-23**, clean detached worktree, Node v24.17.0; runner watched fail first via a planted assertion | green: [`evidence/zed-acp-test-all-2026-07-23.log`](evidence/zed-acp-test-all-2026-07-23.log) · red: [`evidence/zed-acp-test-red-plant-2026-07-23.log`](evidence/zed-acp-test-red-plant-2026-07-23.log) |
| Live lifecycle integration: `new-run → update-run → complete-run` against a disposable copy of the real harness CLI completes a run with `agent_id zed-acp` | **Fresh re-run 2026-07-23** | [`evidence/zed-acp-test-integration-2026-07-23.log`](evidence/zed-acp-test-integration-2026-07-23.log) |
| Real end-to-end Code turn: Sonnet fixed a failing even-length-median test (npm test 2/2), fresh reviewer confirmed — and was itself denied Bash, live proof the allowlist fail-closes | **Recorded 2026-07-10** — headless driver playing Zed's role | [`runs/2026-07-10_1628_npm-test-fails-the-even-length-median/`](../../runs/2026-07-10_1628_npm-test-fails-the-even-length-median/) |
| First real project task: `.gitattributes` LF-pinning in the brain repo; agent honestly reported **partial** (allowlist refused `git add` — correct), independent review clean | **Recorded 2026-07-16** | [`runs/2026-07-16_2055_.../run.json`](../../runs/2026-07-16_2055_real-task-in-this-repo-c-users-pc-brain-a-markdo/run.json) |
| CASE-0024: dead integration refused with ENOENT rather than degrading; regression watched red first | **Recorded 2026-07-16** (regression itself re-ran green in row 1) | [`failures/CASE-0024_.../`](../../failures/CASE-0024_zed-acp-reliability-core-still-invoked/failure.json) |
| Pre-commit gate refuses a red tree: planted failing test → `git commit` exit 1, HEAD unmoved at `e181681`; refuse + pass re-proven under `env -i` | **Recorded 2026-07-19** | `zed-acp-agents:STATUS.md` §CI gate |
| Zed Agent Panel GUI drives the agent | **Never run** — see below | none exists |

## A Windows finding worth publishing: the forward-slash COMSPEC false pass

While installing the pre-commit gate under a stripped environment, the hook ran `npm run test:all`
and exited 0 — with **zero tests run**. Cause: the hook's env pinned `COMSPEC` in forward-slash
form (`C:/WINDOWS/system32/cmd.exe`). Node hands ComSpec verbatim into the CreateProcess command
line, and the mangled spawn turned the npm script into `mkdir` calls — junk directories named
`.exe`, `-c`, and `npm run check && ...` appeared in the repo root, and the exit code was a clean
0. Commit `75ef2b7` landed on that false pass (the tree was separately verified green, so no bad
code shipped — but the gate had approved without checking anything).

The fix pins `SYSTEMROOT`/`COMSPEC` in backslash form (`zed-acp-agents:.githooks/env.sh`), and the
re-proof shows the stripped-env red refusing with real test output and the green visibly running
all 11 tests (`zed-acp-agents:STATUS.md`). The general lesson: on Windows, a gate that shells out
through npm can silently become a no-op that exits 0 — a gate you haven't watched refuse is
decoration, and this one was decoration for exactly one commit.

## The part that was never proven

**The Zed Agent Panel — the actual product surface — has never driven this agent.** Both "real
end-to-end" proofs used a headless driver playing Zed's role over stdio. That proves the protocol,
the executor, the allowlist, and the records; it proves nothing about the panel UX, Zed's
`agent_servers` schema handling in anger, or a human clicking the permission prompt. The repo froze
with that hole open, and this exhibit does not paper over it. Smaller accepted holes are named in
`zed-acp-agents:STATUS.md`: `--no-verify` bypasses the gate, rewritten commits land unchecked, the
budget cap is per-CLI-invocation and soft, and `test:integration` is deliberately ungated (it
couples to the sibling repo and has gone red for that repo's reasons — a gate red for someone
else's reasons trains bypass).

## What I'd generalize

- **Fail-closed is a feature you prove with a dead dependency, not a promise.** The best evidence
  in this repo is a three-day-dead integration that produced refusals instead of unrecorded work.
- **Cross-repo consumers of a migrated interface need their own regression against the new
  interface.** The flagship's migration was fine; the consumer died silently until a real task hit
  it (CASE-0024's prevention note).
- **An exit code is not evidence.** The COMSPEC false pass exited 0 with zero tests run; the
  refuse-first re-proof — watching the gate reject a planted red with real output — is what made it
  a gate.
