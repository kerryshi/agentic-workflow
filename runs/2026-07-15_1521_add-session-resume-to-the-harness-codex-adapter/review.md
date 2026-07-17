# Review — 2026-07-15_1521_add-session-resume-to-the-harness-codex-adapter (round 2)

Reviewer: independent agent (codex) — different from builder (claude)
Verdict: approve

## Must fix
- none

## Should fix
- harness/src/engine.ts: The safe-permissions fallback logs that the installed CLI “cannot resume,” although 0.144.1 can resume but cannot combine resume with the requested read-only sandbox. Use neutral wording and include a reason such as `sandbox_incompatible` in the event.

## Notes
Prior MUST-FIX is resolved: the installed CLI reproduced the `--sandbox` rejection, while the adapter regression test confirmed a fresh read-only fallback with `resume_unsupported: true`. Focused tests passed (22/22), full Vitest passed (171/171), typecheck passed, and `test:all` including build passed.
