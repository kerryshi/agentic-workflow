# Task — 2026-07-15_1936_add-the-deferred-collect-staleness-health-check

## Objective
Add the deferred collect-staleness health check to the ai-news-spider VS Code digest surface: warn visibly when the last successful collect is older than 25 minutes, because the 2026-07-05 Jetson ICS outage proved silent staleness is this system's real failure mode; read STATUS.md and existing digest code first, follow the repo's existing conventions and test style, and do not touch the Jetson deploy path (blocked on JETSON_HOST, a Kerry-only env var).

## Repo
C:/Users/PC/Desktop/Sandbox Testing/ai news spider (branch: master)

## Risk
low

## Validation plan
- TBD

## Agent Adapter
- pipeline template: feature
- builder: claude-code
- reviewer: codex
- surface: harness (v2)
