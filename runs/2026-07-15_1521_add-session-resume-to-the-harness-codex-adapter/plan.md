## Goal
Make `CodexDriver` participate in builder-session resume: emit the codex `thread_id` as `StageResult.session_id` after every drive, honor `DriveOpts.resumeSession` when the installed `codex exec` CLI exposes a `resume` subcommand, and when it does not, run a fresh context but surface that explicitly — a structured `StageResult` flag the adapter tests assert PLUS a `logRunEvent` in the engine run-event log. Engine diff stays minimal, at the resume-decision gate (engine.ts 591-644).

### Facts confirmed from the code
- `codex exec resume [SESSION_ID] [PROMPT]` exists on codex-cli 0.144.1 and accepts `--json`, `--skip-git-repo-check`, `--dangerously-bypass-approvals-and-sandbox`, so the existing JSONL parse pipeline still applies. The resumable id is the UUID `thread_id` from the `thread.started` event.
- Engine already: gates resume on `driver.supportsResume === true` (594), passes `resumeSession` (617), captures `result.session_id` into `pipeline.builder_session_id` (660/664), and has a *distinct* GC'd-session fallback `session_resume_failed` (630). So happy-path resume needs only `supportsResume=true` + `session_id` emission; the new fallback event is separate.
- `logRunEvent(handle, event: Record<string, unknown>)` is free-form (records.ts:191).

## Ordered steps
1. **types.ts** — add `resume_unsupported?: boolean` to `StageResult` (snake_case like `session_id`/`num_turns`), documented: set by the codex adapter when `opts.resumeSession` was requested but the installed CLI lacks a `resume` subcommand; the engine logs it to the run-event stream. `session_id` already exists — no other type change.
2. **codex.ts — capture session id.** Add `thread_id?: string` to `CodexEvent`; add `sessionId?: string` to `CodexParse`; add `case 'thread.started':` in the fold setting `parsed.sessionId = ev.thread_id` (first wins).
3. **codex.ts — supportsResume + capability probe.** Set `readonly supportsResume = true` on `CodexDriver`. Add memoized `private async cliCanResume(): Promise<boolean>` that runs `codex exec --help` via the existing `codexCommand()` + `runProcess` (honors HARNESS_CODEX_BIN stubs) and matches a resume subcommand line with `/^\s*resume\b/im`. Memoize on an instance field to avoid re-spawning across builder stages.
4. **codex.ts — resume-aware args.** Extend the pure builder to `buildExecArgs(opts: DriveOpts = {}, resumeSessionId?: string)`: when `resumeSessionId` is given, emit `['exec','resume', resumeSessionId, '--json','--skip-git-repo-check', <perms>, '-']`; otherwise unchanged. Existing `buildExecArgs()`/`buildExecArgs({model})` assertions stay green (new param defaults to none). Capability logic stays out of the pure builder.
5. **codex.ts — wire run().** If `opts.resumeSession` is set, `await this.cliCanResume()`. If capable → `buildExecArgs(opts, opts.resumeSession)`. If not → fresh args (no id) and set `result.resume_unsupported = true` on the returned StageResult. On the successful result, set `result.session_id = events.sessionId` when present (mirrors claude.ts: session_id on success only).
6. **engine.ts — explicit fallback event (minimal).** Immediately after the existing no-conversation-found block (after line 644): if `result.resume_unsupported`, `this.log(...)` + `logRunEvent(handle, { event: 'session_resume_unsupported', stage: stage.name, agent: agentId, session_id: resumeId })`. Distinct from `session_resume_failed` (the GC'd-session case). No other engine change.
7. **codex-driver.test.ts — new tests, existing style.** Extend `STUB` to answer `exec --help` (print help WITH or WITHOUT a `resume` subcommand keyed off `CODEX_STUB_RESUME=yes|no`) and to detect `resume` in argv (echo the resumed id into `agent_message` text so the test confirms the resume path). Add: (a) `buildExecArgs({}, 'sess-123')` asserts `['exec','resume','sess-123','--json','--skip-git-repo-check',…,'-']`; (b) `parseCodexEvents` extracts `sessionId` from `thread.started`; (c) **resume-with-session**: `CODEX_STUB_RESUME=yes`, `run(brief,{resumeSession:'sess-123'})` → ok:true, `session_id` from thread_id, `resume_unsupported` falsy, echoed text confirms id passed to resume; (d) **explicit-fallback**: `CODEX_STUB_RESUME=no`, same call → `resume_unsupported===true`, ok:true, `session_id` still emitted from the fresh run.

## Files to touch
- harness/src/adapters/types.ts
- harness/src/adapters/codex.ts
- harness/src/engine.ts
- harness/tests/codex-driver.test.ts

## Validation
From repo root: typecheck, full vitest suite (must stay green — task requirement), focused adapter test, and the combined `test:all` (typecheck + test + build).

## Risks / mitigations
- **resume may reject `--sandbox read-only`** (safe-perms): `resume --help` lists no `-s/--sandbox`. Builder-lineage runs with skip_permissions (default → bypass, which resume accepts), so the real path is safe; safe-perms+resume is an edge — keep the perms mapping identical and rely on the never-throw contract to surface any codex rejection honestly (code comment).
- **thread_id == resumable SESSION_ID**: assumed same (help says UUID; fixture thread_id is a UUID). Low risk.
- **probe regex** false pos/neg: pinned to a resume *subcommand* line `/^\s*resume\b/im`, not a loose substring.
- **extra --help spawn per resume stage**: negligible, memoized per instance.
- **event double-fire**: `session_resume_unsupported` fires only on `result.resume_unsupported`; `session_resume_failed` is the GC'd-session case — no overlap.
- **cross-platform spawn**: probe reuses `codexCommand()`, so `.cmd`/`.js` resolution and `HARNESS_CODEX_BIN` overrides already apply.

## Validation commands
- npm --prefix harness run typecheck
- npm --prefix harness test
- npm --prefix harness test -- codex-driver
- npm --prefix harness run test:all
