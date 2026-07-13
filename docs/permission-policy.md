# Coding Task Permission Policy

This policy keeps the workflow productive while making the reliability story honest.

## Auto
Allowed without an extra prompt when scoped to the active repo or current task:

- Read/search local files.
- Create or edit local project files.
- Run local tests, lint, typecheck, formatters, and build checks.
- Inspect git status, diff, log, branches, and worktrees.
- Create run/failure records in this repo.
- Make local commits only when Kerry explicitly asked for a commit.

## Approval
Ask Kerry first:

- Delete files or perform destructive filesystem operations.
- Install packages or change package managers.
- Change global config, hooks, shells, scheduled tasks, or machine policy.
- Touch secrets, OAuth tokens, `.env`, key material, credentials, or prod config.
- Push, deploy, publish, send messages, email, or call external APIs with side effects.
- Run migrations or irreversible data changes.
- Write to the Mac over SSH.
- Write outside the active repo or outside an explicitly named target directory.

## Blocked
Do not do these:

- Mass messaging/outreach without explicit human approval at send time.
- Financial actions.
- Credential exfiltration or secret printing.
- Destructive operations outside the explicit task scope.
- Repo inspection that bypasses the trusted-repo gate for hooks.

## Notes

- The default posture is local-first and reversible.
- Full-auto tooling does not override human judgment for outward-facing or hard-to-reverse actions.
- Config/infra changes must be documented with what changed, why, and how it was verified.

