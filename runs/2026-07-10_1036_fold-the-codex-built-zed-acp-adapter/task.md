# 2026-07-10_1036_fold-the-codex-built-zed-acp-adapter

## Objective
Fold the Codex-built Zed/ACP adapter spike into a standalone repo: fresh history, tests green, docs reconciled, independent review

## User Prompt Summary
start a real run on the zed-acp spike fold-in

## Repo
- Machine: windows
- Path: C:\Users\PC\zed-acp-agents
- Branch/worktree: unknown
- Status path: 
- Risk level: medium

## Agent Adapter
- Agent ID: claude-code
- Role: executor
- Surface: claude-code-cli
- Model: claude-fable-5
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- npm run test:all green (check + node --test + build)
- independent reviewer pass over the Codex-authored code (no MUST-FIX)
- STATUS.md present; README paths point at the new home