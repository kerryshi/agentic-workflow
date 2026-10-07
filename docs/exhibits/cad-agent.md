# Exhibit — cad-agent: English in, a verified physical part out

> **Update 2026-10-07:** the repo is now public at
> [github.com/kerryshi/cad-agent](https://github.com/kerryshi/cad-agent). The page below is
> unchanged from when it was written.

> **Status:** ACTIVE project, frozen read-only for this sprint; this page documents the
> committed HEAD `897f965` ("Merge review-page", 2026-07-21) and nothing newer — an
> uncommitted working-tree edit in the main checkout is out of scope. The repo lives at
> `C:\Users\PC\cad-agent` (local, no remote by choice). Paths written `cad-agent:<path>`
> refer into that repo; everything else links repo-relative inside this one.
>
> **Evidence policy for this page:** everything that runs without an LLM backend or the
> printer was re-run fresh on 2026-07-23 in a clean detached worktree of `897f965` with a
> fresh Python 3.12.10 venv (logs in [`evidence/`](evidence/)). The fresh runner was
> itself proven capable of failing — a deliberately planted assertion turned the suite
> red (1 failed / 79 passed, exit 1) before the plant was reverted and the green
> captured. Benchmark rows and live-printer legs are cited from recorded artifacts and
> labeled as such — re-running them would have required hours of live LLM spend and a
> printer on the LAN, and was not done.

## The pipeline closed. The one-shot command still refuses to.

On 2026-07-21 the whole path ran for real: an English request became a pydantic spec,
agent-written CadQuery code, a deterministically verified STEP, a thermally gated PETG
slice, an FTPS upload to the Bambu P2S (899,052 bytes, byte-exact), and a remote start —
state read back RUNNING with the part's own name 8 s after publish, bed readback
70.0 °C mid-print, exactly the setpoint the thermal gate exists to guarantee. The first
physical print had already run to FINISH earlier that day (a different part, started
from the touchscreen, per design). All recorded, `cad-agent:STATUS.md`.

And yet `harness.make --send` — build and print in one invocation — cannot succeed, by
construction. Every build stages a self-contained `review.html`; printing requires an
approval recorded by `harness.review` *after* the artifacts exist, and the approval is
sha256-bound to the staged `.step` and `.gcode.3mf` files, so any rebuild or re-slice
makes it stale and the send refuses again at exit 10. A machine that can print plastic
unattended is exactly the machine that should not be able to; the interesting
engineering here is the refusing.

## What it is

English request → frozen spec (pydantic) → agent-written CadQuery in a sandboxed
subprocess → deterministic verification derived only from the spec → headless OrcaSlicer
slice check → human review gate → FTPS upload + remote start. Two part families
(parametric project enclosures; flat X-quad drone-frame plates), registered in
`cad-agent:toolchain/families.py`; the harness is family-agnostic.

The design invariant is the workflow's premise (`docs/write-up-draft-2026-07.md`) applied to
CAD: **the codegen agent never sees or writes verification code.** Verifiers derive
every assertion from the frozen spec — probe points at known depths inside walls,
4-point rings around standoff axes, boolean lid/body interference, mesh watertightness
(`cad-agent:toolchain/verify.py`) — and every check ships with refuse-first evidence: a
sabotage hook in the reference builder that the specific owning check must refuse.

The production mode is a measured division of labour: **local extraction, frontier
codegen.** Schema-constrained decoding (Ollama `format` + temperature 0) makes an 8B
model a reliable spec extractor; CadQuery codegen is where the frontier gap lives. Same
tasks, same sandbox, same verifier throughout:

| backend | extract (encl + frame) | codegen (encl + frame) |
|---|---|---|
| llama3.1:8b, freeform prose | 5/8 | 0/8 |
| llama3.1:8b, schema-constrained | **8/8 + 5/5** | — |
| qwen3-coder:30b, schema-constrained | 13/13 | **0/13** at the 3-iter cap |
| claude-code:sonnet | 13/13 | 13/13, every task iter=1 |
| **hybrid: llama3.1:8b extract + sonnet codegen** | **13/13** | **13/13, every task iter=1** |

(`cad-agent:results/*.json`; re-tallied from the raw rows 2026-07-23 — the tally is
reproducible from the JSONs alone.) The fairness row is the thesis in one line: the strongest local code
model this GPU runs is simultaneously a perfect extractor and a 0% CadQuery model. The
cautionary row is `qwen3-4b-instruct-2507` — the leaderboard pick for structured
extraction — scoring **1/8** under the schema grammar it was nominated for
(`cad-agent:results/ollama-qwen3-4b-instruct-2507-q4_K_M.json`): constrained decoding
fixes shape, not values, and on some checkpoints it changes the values.

## Architecture

- `cad-agent:toolchain/` — deterministic, zero-LLM: specs, reference builders with
  sabotage hooks, spec-derived verifiers, VTK offscreen renderer, OrcaSlicer slice check
  with a thermal gate.
- `cad-agent:harness/` — swappable backends (`claude-code` headless CLI, `anthropic`
  API, `ollama`, scripted-for-tests) behind one protocol; prompts that embed the spec
  source verbatim; a sandboxed runner (subprocess `-I`, temp cwd, timeout, a static gate
  rejecting `toolchain` imports); the extract/codegen loop; the golden benchmark; and
  the product surface `harness.make` / `harness.review` / `harness.send`, each gate
  refusing with its own exit code.
- `cad-agent:printleg/` — P2S control: read-only probe, physical preflight, implicit-FTPS
  client, correct MQTT command envelopes.

Two humans-in-the-loop are load-bearing, not ceremonial: the hash-bound review approval
covers *what* is printed; `--plate-clear`, a mandatory per-invocation attestation,
covers *the moment* — no sensor reports an empty plate, so an autonomous session must
never pass it on its own authority (`cad-agent:harness/send.py`).

The slice leg carries the project's best silent-degradation catch: OrcaSlicer's CLI
resolves profile `inherits` against vendor directories the portable build doesn't ship,
so every parent key quietly fell back to slicer defaults — PETG became PLA in the gcode,
the 70 °C bed became 35 °C, the build plate shrank 256→200 mm — while the slice reported
ok with plausible stats. Two frames were staged with a first-layer-release bed
temperature before this was caught. The fix flattens the chain before invoking the CLI
(`cad-agent:toolchain/profiles.py`, mechanism documented precisely — the CLI does not
"ignore" inherits, it fails lookup and degrades quietly); the gate that now owns it
refuses any gcode whose filament type or bed temps (first-layer and steady, separately —
the reviewer caught that `max()` over the body accepted a 35 °C first layer under a
correct steady 70) disagree with the resolved profile.

## The evidence table, honestly labeled

| Claim | Status | Evidence |
|---|---|---|
| Test suite 80/80 green at `897f965`, 0 skips (the conftest skip-guard turns slicecheck skips into failure), fresh venv, Python 3.12.10 | **Fresh re-run 2026-07-23**, red watched first (planted assertion → 1 failed/79 passed, exit 1; reverted → 80 passed, exit 0) | red: [`evidence/cad-agent-pytest-red-plant-2026-07-23.log`](evidence/cad-agent-pytest-red-plant-2026-07-23.log) · green: [`evidence/cad-agent-pytest-green-2026-07-23.log`](evidence/cad-agent-pytest-green-2026-07-23.log) · pre-plant green: [`evidence/cad-agent-pytest-green1-preplant-2026-07-23.log`](evidence/cad-agent-pytest-green1-preplant-2026-07-23.log) |
| Hybrid benchmark: 13/13 extract + 13/13 codegen, every task iter=1, all 21 part slices thermally gated ok | **Recorded 2026-07-21**; raw JSONs re-tallied 2026-07-23, numbers match | `cad-agent:results/hybrid--ollama-llama3_1-8b--claude-code-sonnet.json` + `--frame_tasks.json` |
| qwen3-coder:30b: 13/13 extract, 0/13 codegen at the 3-iter cap | **Recorded 2026-07-21**; re-tallied 2026-07-23 | `cad-agent:results/ollama-qwen3-coder-30b.json` + `--frame_tasks.json` |
| Same model, same tasks, 5/8 → 8/8 extraction from moving the schema into the decoder | **Recorded 2026-07-17/21**; re-tallied 2026-07-23 | `cad-agent:results/ollama-llama3_1-8b--freeform-2026-07-17.json` vs `results/ollama-llama3_1-8b.json` |
| Same task, same sandbox: sonnet codegen PASS iter=1 vs haiku FAIL at cap (final error a hallucinated CadQuery API, `rotateZ`) | **Recorded 2026-07-20** | `cad-agent:results/claude-code-sonnet--f5.json` vs `results/claude-code-haiku--f5.json` |
| First physical print ran to FINISH (f2, 20/20 layers); auto-print leg live: byte-exact FTPS upload, remote start confirmed RUNNING from printer state in 8 s, human plate-clear given, 70.0 °C bed readback | **Recorded 2026-07-21** — not re-run (needs the P2S on the LAN + human attestations) | `cad-agent:STATUS.md`, 2026-07-21 entries |
| The send gate refuses live: `harness.send out/demo-review --plate-clear` → exit 10 with remediation text | **Recorded 2026-07-21** (the demo build dir is gitignored); same behavior covered by the fresh 80-green suite | `cad-agent:STATUS.md`; `cad-agent:tests/test_review.py`, `tests/test_make.py` |

One asymmetry stated outright: the live prints predate the review gate (it merged last,
the same day). The gate has **refused** live and passes its suite fresh; it has never
**approved** a live print — the demo build's verdict was left PENDING deliberately, so
the first real approval on record is the owner's, not an agent's.

## The negative finding, stated plainly

**Vision-model critique of the renders has no discriminative signal at the local scale
tried, and is shelved.** The idea was cheap gross-error review: render the part
(4 body + 2 lid views), ask a VLM whether it grossly matches the spec. qwen2.5vl:7b,
two prompt shapes, stopped per the two-strikes rule: with 6 views it hallucinates
defects on a known-good part; with 2 views it **passes a missing-post sabotage** — wrong
in both directions, worse than no signal, since a plausible-sounding pass is exactly how
a bad part would reach the printer. The module survives (`cad-agent:harness/critique.py`,
negative result in its docstring) but is NOT wired into the loop, and the project's
review surface went to a human page plus deterministic probes instead. Revisit only with
a frontier vision model — and the same sabotage protocol.

## The finding worth stealing: FTPS against the printer

The P2S speaks implicit FTPS on :990 (encrypted from the first byte — stdlib `ftplib`
only does explicit `AUTH TLS`, so it won't even connect), and its vsftpd runs
`require_ssl_reuse`: the data channel must resume the control connection's TLS session
or every transfer dies with `522 SSL connection failed: session reuse required`. The
symptom is the trap — **login succeeds and every directory operation fails**, which
reads exactly like a permissions problem and isn't. `cad-agent:printleg/ftps.py` wraps
the control socket at connect and re-uses its TLS session on each data connection; its
first live exercise was the byte-exact 899,052-byte upload above. The companion finding
(`cad-agent:printleg/commands.py`): bambulabs_api 2.6.6's light-control publishes a
payload with no `command` field, which the firmware silently ignores while the library
reports the *broker's* ack as success — two days were spent on "writes are dropped"
before a raw, fully formed envelope toggled the chamber light live. Success is now only
ever reported from observed printer state, never from an ack.

Named holes, on record in `cad-agent:STATUS.md`: physical QA of the printed parts is
pending (hole fit vs the guessed `fit_clearance=0.2`); the thermal gate proves gcode
coherent with the profile, not that the part comes out good; verify's oracles assume
cooperative, not adversarial, codegen; camera liveview returned no frames on this
model; the merge gate's GUI-client commit path has never been exercised.

## Why this exhibit earns its place

It is the workflow's argument run all the way into atoms: an actor that cannot verify
itself (codegen never writes checks), gates that were each watched refusing before being
trusted (sabotage parts, planted merges, a cold-bed slice), measurements preferred over
reputation (the leaderboard extractor at 1/8; the 30B code model at 0/13; the decode
config worth more than a model swap) — and, at the end, a machine that can physically
make things being structurally denied a one-shot path from prompt to print. The most
honest line in the repo is the gap the record keeps visible: the pipeline has printed,
and the review gate has only ever said no.

**Paths.** cad-agent repo (local): `README.md`, `STATUS.md`, `toolchain/verify.py`,
`toolchain/profiles.py`, `harness/make.py`, `harness/review.py`, `harness/send.py`,
`harness/critique.py`, `printleg/ftps.py`, `results/*.json`. This repo: fresh-run logs
under [`evidence/`](evidence/) (full method capture — venv/toolchain versions, worktree
method, cleanup proof — in the sprint lane's `EVIDENCE.md`).
