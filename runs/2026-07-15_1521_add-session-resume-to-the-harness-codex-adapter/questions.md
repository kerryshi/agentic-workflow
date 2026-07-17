# Grill questions

Answer inline under each question, then resume the run.

1. When the installed codex CLI cannot resume (no `resume` subcommand in `codex exec --help`), how should the fallback be recorded so it counts as being 'in the stage events' — a structured field on the returned StageResult (adapter-observable, matching the stub-driven adapter test style), a run-event emitted via logRunEvent (engine-side), or both? This determines the types.ts/engine.ts footprint and how the new fallback test asserts.
   A: Both. Add a structured field on the returned StageResult (so the stub-driven adapter tests assert it directly) AND emit a run event via logRunEvent so the fallback is visible in the run's event log. 'Stage events' in the task means the run-event log; the StageResult field is the test-observable surface.

2. Is editing engine.ts in scope for this stage, or should the change stay confined to codex.ts (plus types.ts and tests)? The happy-path resume works with only supportsResume=true + session_id emission since the engine already gates on supportsResume and captures result.session_id generically, but recording the fallback in the run-event log would require an engine.ts edit.
   A: Yes, engine.ts is in scope - the logRunEvent recording requires it. Keep the engine diff minimal: emit the event where the resume decision is made (the resumeId / builder_session_id gate around lines 591-617); everything else stays in codex.ts + types.ts + tests.
