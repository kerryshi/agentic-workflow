# Evidence

## Commands
| Command | Result | Notes |
|---|---|---|
| `npx tsc --noEmit -p .` (harness) | clean | |
| `npm run build` (harness) | clean | |
| `npx vitest run` (harness) | **165 passed / 24 files** | was 135 / 20 before the port |
| `npx vitest run` x10 consecutive | **165/165 every run** | the bar item G set. The first 10x attempt found run 4 red (161/165) — that is how a hot-spinning barrier in my own new test was caught |
| Node vs PowerShell metrics, real repo | **identical, field for field** | runs 17/17 · shipped 15/15 · evidence rate 82.4/82.4 · avg minutes 68/68 · failures 18/18 · resolved 18/18 · regressions 18/18 · all six failure classes equal |
| merge gate, RED branch | **REFUSED** — exit 1, HEAD unmoved | a real `git merge`, not a simulation |
| merge gate, GREEN branch | **allowed** — exit 0, merged | a gate that blocks valid work gets disabled |
| `harness new-run` / `update-run` / `complete-run` / `metrics` | driven end to end | including `pytest -k "a,b"` surviving the round-trip with its comma intact |

## Proof

**Parity before deletion.** The PowerShell layer (1,931 lines) was not deleted on faith. Both
implementations were run against the real repo (17 runs / 18 cases) and compared field by field —
including the two values easiest to get wrong and most tempting to fudge: the honest evidence rate
(82.4%, not a flattering 100%) and the 68-minute average. Identical.

**The regression that would not fail.** CASE-0019 is a race, and the first two regressions I wrote
for it *passed against the bug* — which means they proved nothing:

- 8 one-shot child processes racing a single id → GREEN (process startup staggers them far wider
  than the nanosecond window between `existsSync` and `mkdir`).
- 4 processes looping 150 contended ids, no barrier → GREEN (each finishes its loop before the next
  has finished importing).
- 4 processes **behind a shared barrier** → RED every single time. 600 claims yielded 530 / 495 /
  583 unique ids across three runs. Each duplicate is one run record silently overwriting another.

A green test I had not watched fail would have shipped the bug with a rubber stamp on it.

**The gate did not work the first time.** It printed `green. Merging.` while merging a branch whose
suite was red. Only testing the guard found that. It is now proven in both directions through a real
`git merge`.

## Artifacts
- `harness/src/claim.ts` — the atomic claim (the directory IS the lock)
- `harness/src/newrun.ts`, `manualrun.ts`, `metrics.ts` — the port
- `harness/tests/run-claim.test.ts`, `newrun.test.ts`, `manualrun.test.ts`, `metrics.test.ts` — 30 new regressions
- `harness/vitest.config.ts` — the A11 fix (worker cap + timeout, Windows only)
- `.githooks/pre-merge-commit` — the cross-platform gate
- `failures/CASE-0019` (data loss under concurrency), `failures/CASE-0020` (first recorded escaped bug)
- master merge commit `d074707` — landed *through* the gate, which ran all 165 tests first

## Defects I introduced, and caught
Recorded because a record that only lists successes is worthless:
1. Committed `c89590a` claiming "165 passed" **after** adding a doctor check I never re-ran — it had
   left 4 doctor tests red. Found while debugging the gate; fixed in `799514d`.
2. My own `run-claim` barrier hot-spun on `readdirSync`, pegging one core per child process and
   starving the other vitest workers — the exact contention bug this branch had just fixed. It made
   the suite flaky (run 4 of 10). Now `Atomics.wait`, which yields.
