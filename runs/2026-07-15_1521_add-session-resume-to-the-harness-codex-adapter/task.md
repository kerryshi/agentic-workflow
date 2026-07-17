# Task — 2026-07-15_1521_add-session-resume-to-the-harness-codex-adapter

## Objective
Add session resume to the harness codex adapter (harness/src/adapters/codex.ts): today a resumed run falls back to fresh contexts for codex-driven stages (PORTFOLIO 3.1 plan #6). Mirror the claude adapter's session-resume behavior where the codex CLI supports it (session id / exec resume); when it does not, keep the fresh-context fallback but record it explicitly in the stage log instead of silently. Validation: harness unit/integration suite stays green; new tests cover resume-with-session and the explicit-fallback path.

## Repo
C:/Users/PC/agentic-workflow (branch: master)

## Risk
medium

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: codex
- surface: harness (v2)
