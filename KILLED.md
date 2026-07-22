# KILLED

Killing things on purpose is part of this workflow. Every component earns its keep against
the run record, and when the record says a thing isn't paying for its maintenance, it gets a
dated retirement memo instead of a quiet rot. A reliability system that never retires anything
is either perfect or not looking. These are the kills so far, with the actual reasons.

## AgentOS — retired 2026-06-27

The predecessor flagship: a local-first personal-automation OS that ran a 13-step morning
pipeline daily (email triage, calendar, job scoring, news digests) with hybrid local-model →
cloud routing and two background daemons. Killed because its value stopped matching the
sustainability it needed to be a daily driver: the job spider was producing zero results, there
were no automated tests, the cost tracking turned out to be fictional, and maintenance overhead
ran high relative to what it delivered. The good ideas — hybrid local/cloud routing with
documented thresholds, atomic-write discipline, health-check gates before automated runs — were
carried forward into this workflow as patterns, not code. The repo is archived offline as a
reference, not deleted.

## headroom-ai proxy — removed 2026-06-27

A context-compression proxy adopted to cut token costs. Removed after testing showed the
compression never actually engaged in real use — the feature that justified the dependency
never fired once. A component that never does its one job is pure risk surface: it can still
break, it still has to be understood, and it still sits in the request path. Standing rule
recorded at removal: don't re-adopt without new evidence that it engages.

## Haystack (as agent orchestration) — evaluated and skipped 2026-06-29

Evaluated as the orchestration layer for three planned systems. Skipped for all three: its
pipeline abstraction has the wrong control-flow shape for gated agent workflows (which need
hard stops, human approval gates, and park-and-resume, not a DAG of components), and its
dependency weight was out of proportion to what it would replace. The skip is scoped, not
dogmatic: the note kept open the one case where it might come back — transcript/document RAG —
with a lighter-weight option to try first.

## /lab command — retired 2026-07-16

A shortcut into a WSL2 machine-learning lab environment. Retired with exactly zero recorded
uses: the workflow's direction moved away from local training/fine-tuning, and a command nobody
has ever run is not a capability, it's inventory that has to be kept correct. The lab itself
remains available; the dead pointer to it does not.

## /gnhf and /worktree skills — retired 2026-07-19

Two skills built ahead of need: a guarded fresh-context loop for large evaluable tasks with
deterministic checkers (/gnhf), and parallel worktree isolation (/worktree). After 27 recorded
runs they had 0–1 real uses between them — the workloads they were designed for never arrived
at volume, and the run record, not intuition, made the call. Keeping the skill set small and
high-signal beats keeping it complete: every unused skill is documentation that can drift and a
choice the operator has to keep re-reading past.
