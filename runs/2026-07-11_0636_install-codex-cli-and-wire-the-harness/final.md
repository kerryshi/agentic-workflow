# Final

## Outcome
Codex CLI installed (codex-cli 0.144.1, Codex Desktop auth reused) and the harness codex driver rewritten from stub to live: codex exec --json over stdin, JSONL event fold, honest failure mapping. Engine cross-agent model leak fixed. 3-lens adversarial review: 13/13 findings addressed, CASE-0016/0017 captured+resolved.

## Status
shipped

## Files Changed
- adapters/codex.md
- docs/orchestration.md
- failures/CASE-0016_runprocess-sync-spawn-throw-einval-on/
- failures/CASE-0017_runprocess-timeout-could-strand-a-stage/
- HANDOFF.md
- harness/src/adapters/claude.ts
- harness/src/adapters/codex.ts
- harness/src/adapters/proc.ts
- harness/src/engine.ts
- harness/tests/codex-driver.test.ts
- harness/tests/engine.test.ts
- harness/tests/proc.test.ts
- metrics/runs.jsonl
- PORTFOLIO.md
- runs/2026-07-11_0636_install-codex-cli-and-wire-the-harness/

## Validation / Evidence
Live codex exec spike transcripts (spike/*.jsonl); driver e2e through compiled dist twice (ok:true, parsed JSON, real usage); vitest 68/68; tsc clean; PS harness 64/64; CASE-0016/0017 regressions failing-first by construction (branch tests target the exact pre-fix paths).

## Reviewer Result
Independent 3-lens adversarial review workflow (16 agents): 13 findings raised, 13 confirmed by verifiers, all fixed same-session (1 must-fix, 7 should-fix, rest nits/informational). Post-fix vitest 68/68, live conformance re-passed.

## Risks
codex reports no cost field (cost_usd=0 by construction, tokens carry accounting); POSIX grandchild-orphan kill path verified by replica repro on the Mac, not in CI; ChatGPT-plan rate limits on codex are untested under real pipeline load.

## Follow-ups
Run a REAL-SIZE task through the harness with codex as reviewer (HANDOFF N6); consider per-agent model flags (--codex-model) if cross-agent model choice is ever needed.