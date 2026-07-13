# Claude Code Adapter

Status: first concrete adapter

Claude Code remains the primary coding-agent workflow: planning, edits, review, ship reports,
subagents, hooks, and worktrees. Agentic Workflow wraps it with durable records.

## Start

```bash
node harness/dist/cli.js new-run "Describe the task" 
  --repo /path/to/some-repo 
  --agent-id claude-code 
  --role mixed 
  --surface claude-code 
  --validate "npm test" --validate "npm run lint"
```

## Loop

1. Read project instructions and current status.
2. Start or reuse a run record before major edits.
3. Use the normal `/plan -> build -> /review -> /ship` loop.
4. Append evidence and command notes during the run.
5. Complete the run only after validation and review are recorded.
6. Capture serious misses as failure cases.

## Notes

Claude Code-specific commands may write richer Markdown, but the durable contract is still the
standard `runs/<id>/` folder.
