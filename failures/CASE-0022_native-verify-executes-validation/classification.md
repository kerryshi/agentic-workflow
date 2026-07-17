# Classification

- Failure class: environment_platform_issue
- Severity: should_fix
- Prevention layer: plan-stage brief should state that validation commands execute under bash on Windows (forward slashes, echo for piped input), or native verify should normalize backslash paths before exec; same class as the brain's claude-code-hooks-bash-backslash lesson - third sighting

## Root Cause
The plan stage and native verify disagreed about the execution environment. The planner,
running on Windows, authored idiomatic Windows paths (.venv\Scripts\python); native verify
executes every command through `bash -c`, where a bare backslash is an escape character —
the paths collapsed (.venvScriptspython) and all three commands exited 127, parking a
green change as "verification failed". Nothing in the plan brief said commands would run
under bash.

## Contributing Factors
- Fourth sighting of the backslashes-die-in-bash class (brain:
  claude-code-hooks-bash-backslash — hooks 2026-07-02/05, OEM decode 2026-07-09); the
  lesson lived in the brain but not in the brief that authors the commands.
- One command also piped a bare string ('"utterance" | cmd') without echo — same gap:
  the brief never stated the shell contract.
- Native verify treats any non-zero exit as failure (by design), so an environment
  mismatch is indistinguishable from a real red without reading evidence.md.
