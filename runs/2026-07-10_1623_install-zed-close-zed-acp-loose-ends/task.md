# 2026-07-10_1623_install-zed-close-zed-acp-loose-ends

## Objective
Install Zed, close zed-acp loose ends (redaction breadth, integration smoke, spike cleanup), then run a real Claude Code turn end-to-end through the system

## User Prompt Summary
install zed, tie all loose ends, then use the system ourselves (claude code)

## Repo
- Machine: windows
- Path: C:\Users\PC\zed-acp-agents
- Branch/worktree: master
- Status path: 
- Risk level: medium

## Agent Adapter
- Agent ID: claude-code
- Role: executor
- Surface: claude-code-cli
- Model: claude-fable-5
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- Zed installed and launches; agent entry present in Zed settings
- npm run test:all green incl. broadened redaction tests
- one real end-to-end Code turn produces a run record with evidence