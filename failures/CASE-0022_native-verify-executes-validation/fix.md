# Fix

## Proposed Fix
Two layers (both halves of the prevention note):
1. **Plan brief** (`harness/src/brief.ts`): the plan stage now carries VALIDATION COMMAND
   RULES stating commands execute later under non-interactive `bash -c` from the repo
   root on EVERY platform (Git Bash on Windows) — forward-slash paths only, stdin piped
   explicitly via `echo '...' | cmd`, every command unattended and non-zero on failure.
2. **Native verify guard** (`harness/src/verify.ts`): `normalizeCommandForBash()` rewrites
   a whitespace-delimited token to forward slashes only when it is Windows-path-shaped
   (2+ `\`-joined bare segments, no quotes/spaces) AND the FULL forward-slash form
   resolves in the repo as-is or with a Windows executable extension (`python` →
   `python.exe`). Requiring the full path — never just its dirname — keeps regex escapes
   (`foo\.py`) untouched even when `foo/` is a real directory (reviewer finding,
   2026-07-15). The original command is preserved in `results[].command`; the executed
   form is recorded as `normalized_command` and shown in evidence.md as "_ran as ..._".
   Known limits (deliberate — the brief rule is the primary prevention): drive-absolute
   tokens (`C:\x\y`), `--flag=path\to\x` forms, and paths that don't exist yet are NOT
   rewritten.

## Applied Fix
Applied as proposed on branch fix-case-0021-0022 (2026-07-15):
- `harness/src/brief.ts` — plan-stage VALIDATION COMMAND RULES block
- `harness/src/verify.ts` — `normalizeCommandForBash()` + `normalized_command` result field
- `harness/src/engine.ts` — evidence.md "ran as" line when normalization fired

## Verification
`npm run typecheck` clean; full suite `npx vitest run` 177/177 green (25 files) including
the 4 new CASE-0022 regressions; `npm run build` clean. See regression.md for
failing-first and passing output.

## Resolution (2026-07-15T17:39:29-04:00)
- Status: fixed
- Regression test: harness/tests/verify.test.ts: 'runs a plan-authored backslash path after normalizing it for bash', 'normalizes only path-shaped tokens that resolve in the repo', 'normalizes backslash paths and says so in evidence (CASE-0022)'; harness/tests/briefs.test.ts: 'plan brief validation-command rules (CASE-0022)'
- Prevention layer: plan brief states the bash execution environment; native verify normalizes resolvable backslash-path tokens as defense-in-depth
