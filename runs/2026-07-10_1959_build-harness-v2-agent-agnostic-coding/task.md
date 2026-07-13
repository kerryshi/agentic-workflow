# 2026-07-10_1959_build-harness-v2-agent-agnostic-coding

## Objective
Build harness v2: agent-agnostic coding pipeline (Node/TS) inside agentic-workflow - spec, Claude driver, pipeline engine, Codex spike, proof runs

## User Prompt Summary
approved plan: harness/ in agentic-workflow, fully automated, Node/TS

## Repo
- Machine: windows
- Path: C:\Users\PC\agentic-workflow
- Branch/worktree: master
- Status path: 
- Risk level: medium

## Agent Adapter
- Agent ID: claude-code
- Role: mixed
- Surface: claude-code-cli
- Model: claude-fable-5
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- vitest unit+integration green
- existing PS harness stays green (64+)
- fixture task e2e through claude -p with run record + token log
- independent review before commit