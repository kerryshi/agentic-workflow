# 2026-07-13_1537_converge-the-reliability-layer-on-node-retire-po

## Objective
Converge the reliability layer on Node, retire PowerShell, install the cross-platform merge gate

## User Prompt Summary
Kerry: find the best area for both Windows and Mac operations, or keep them different but connected.

## Repo
- Machine: windows
- Path: C:/Users/PC/agentic-workflow
- Branch/worktree: master
- Status path: 
- Risk level: high

## Agent Adapter
- Agent ID: claude-code
- Role: executor
- Surface: claude-code
- Model: claude-opus-4-8
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- npm test (harness)
- npx tsc --noEmit -p .
- 10x consecutive full-suite runs, 165/165
- Node-vs-PowerShell metrics parity on the real repo
- merge gate proven both ways through a real git merge
