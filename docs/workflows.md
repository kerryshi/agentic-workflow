# Agentic Workflow (reliability layer)

An agent-agnostic reliability layer. Claude Code and Codex are peer adapters; the same run
records, failure cases, ship evidence, and metrics wrap either, or a local model.
See `docs/ai-coding-workflow.md` and `adapters/adapter-contract.md` for the general loop.

> **The PowerShell layer was retired on 2026-07-13.** `scripts/*.ps1` and `tests/run_tests.ps1`
> are gone (1,931 lines); everything they did lives in `harness/` and runs identically on Windows
> and macOS. Parity was proven against the real repo before deleting — field for field, including
> the honest 82.4% evidence rate. The point was not tidiness: the Mac could not create a run record
> or regenerate metrics at all, so half the estate was second-class. There is now **one**
> implementation of the record contract, not two.

## Invocation (read first)

```bash
cd harness && npm ci && npm run build
node dist/cli.js <command>
```

Prefer `node harness/dist/cli.js` (or Git Bash). The npm-installed `harness` shim is unreliable in
desktop PowerShell — the execution policy blocks `harness.ps1`. `harness doctor` reports what is
missing.

Every command takes `--root <path>` (defaults to this repo), so tests and experiments never touch
real records.

## Two kinds of run

**Harness-driven** — the harness owns the pipeline and writes the records itself:

```bash
node dist/cli.js run "add a --json flag to the export command" --repo ../my-project
node dist/cli.js resume <run_id> --approve
```

**Manual** — a record for work the harness is *not* driving (a hand-done task, or another agent
under `adapters/adapter-contract.md`). This replaces `new_run.ps1`:

```bash
node dist/cli.js new-run "Fix failing navbar test" \
  --repo ../my-project \
  --agent-id claude-code --role executor \
  --risk medium \
  --validate "npm test" --validate 'pytest -k "a,b"'
```

`--validate` repeats, and **each occurrence is one whole command**. It is never comma-split:
`pytest -k "a,b"` is a single command, and splitting it would silently produce two broken ones.

An unrecorded agent is written as `manual` — honestly, never guessed. A named agent inherits its
own surface unless you pass `--surface` (CASE-0008).

## During the run

```bash
node dist/cli.js update-run --command "npm test" --result "138 passed" --note "green"
node dist/cli.js update-run --evidence-link evidence.md --file src/cli.ts
```

## Finishing the run

```bash
node dist/cli.js complete-run \
  --status shipped \
  --outcome "ported the reliability layer to Node" \
  --evidence-link evidence.md \
  --capture-diff
```

`complete-run`:

- **appends** a Completion section to `final.md` — it never overwrites hand-written content
  (CASE-0003);
- refuses to complete an already-finished run, because a second `run_completed` event would skew
  the metrics (CASE-0003);
- with `--capture-diff`, writes a `diff.patch` that `git apply` accepts, including files with
  **non-ASCII names** — git enumerates the paths itself on a throwaway index, so filenames never
  round-trip through a shell and mojibake (CASE-0001/R14, CASE-0006).

**Omit the run id** on `update-run` / `complete-run` and it targets the single in-progress run for
that repo. **Two candidates is an ambiguity, and ambiguity is refused, not guessed** — the original
sorted every in-progress run across every repo and silently completed the newest, exiting 0 having
closed the wrong record (CASE-0007).

## Failure cases

```bash
node dist/cli.js case new \
  --summary "verify accepted a PASS it never ran" \
  --class weak_verification --severity must_fix \
  --linked-run 2026-07-13_1042_some-run

node dist/cli.js case resolve CASE-0019 \
  --regression "harness/tests/verify.test.ts::vacuous PASS is rejected" \
  --prevention "native verify: the harness runs the commands itself"
```

Open a case only when the lesson generalises past the one bug. Close it with the regression test
that would fail if it came back — a case without a regression is a diary entry.

## Metrics

```bash
node dist/cli.js metrics          # regenerates metrics/summary.md + summary.json
node dist/cli.js metrics --json
```

Two honesty properties are load-bearing, and both were bugs once:

- **Evidence is proven, never inferred.** It counts a real `evidence_link` or a non-stub bullet in
  `evidence.md`. The original counted `status == shipped` as evidence and reported a flattering
  100%. A metric that grades itself is not a metric.
- **`wont_fix` is closed but NOT resolved.** Counting it as resolved inflated the number.

## Checks

```bash
cd harness
npm test        # the full suite — the whole reliability layer is covered here now
npm run typecheck
npm run build
```

## The merge gate

```bash
git config core.hooksPath .githooks
git config merge.ff false
```

`.githooks/pre-merge-commit` runs the suite before a merge lands and refuses a red one. It exists
because harness v2.2 was written on the Mac, merged, and was red on Windows for a day — nobody
skipped a check; there was no check to skip. `harness doctor` reports when it is not installed.
