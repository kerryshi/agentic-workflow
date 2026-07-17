# Review — 2026-07-15_1521_add-session-resume-to-the-harness-codex-adapter (round 1)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: must_fix

## Must fix
- harness/src/adapters/codex.ts: Resume with `skipPermissions:false` is broken: buildExecArgs adds `--sandbox read-only`, but installed codex-cli 0.144.1 rejects that option for `codex exec resume` (`unexpected argument '--sandbox'`). Engine supports `skipPermissions:false`, so this valid DriveOpts combination fails instead of resuming or explicitly falling back. The stub currently masks the incompatibility.

## Should fix
- harness/src/engine.ts: When resume is unsupported and the adapter runs fresh, `resumeId` remains defined, so the saved StageAttempt incorrectly records `resumed:true`, contradicting the fallback event.

## Notes
Installed CLI capability and help were checked. Typecheck, focused adapter tests (20), full Vitest suite (169), test:all, build, and scoped diff check passed.
