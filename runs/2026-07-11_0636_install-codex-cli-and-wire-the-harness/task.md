# 2026-07-11_0636_install-codex-cli-and-wire-the-harness

## Objective
Install Codex CLI and wire the harness codex driver (live, conformance-tested)

## User Prompt Summary


## Repo
- Machine: windows
- Path: C:\Users\PC\agentic-workflow
- Branch/worktree: master
- Status path: 
- Risk level: medium

## Agent Adapter
- Agent ID: claude-code
- Role: executor
- Surface: claude-code
- Model: claude-fable-5
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- harness vitest green
- tsc clean
- live codex exec conformance spike passes
- v1 PS harness 64/64
- independent review