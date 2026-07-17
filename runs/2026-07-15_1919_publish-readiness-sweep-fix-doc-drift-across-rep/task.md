# 2026-07-15_1919_publish-readiness-sweep-fix-doc-drift-across-rep

## Objective
publish-readiness sweep: fix doc drift across repo and global config, brain loop integrity (PRD docs/prd-publish-readiness.md WS1+WS3)

## User Prompt Summary
Kerry: okay create a prd and begin (after honest-verdict audit)

## Repo
- Machine: windows
- Path: C:/Users/PC/agentic-workflow
- Branch/worktree: publish-readiness-sweep
- Status path: 
- Risk level: low

## Agent Adapter
- Agent ID: claude
- Role: executor
- Surface: claude-code
- Model: 
- Adapter contract: adapters/adapter-contract.md

## Validation Plan
- cd harness && npm run test:all
