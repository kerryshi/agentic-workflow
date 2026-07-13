# Prompt / Situation

runProcess timeout could strand a stage as 'running' forever: 'close' waits for pipe EOF, but the kill only hit the direct child - on POSIX the codex npm shim's native grandchild survives SIGKILL to the launcher and holds the inherited pipes open

## Linked Run
2026-07-11_0636_install-codex-cli-and-wire-the-harness

## Repo
- Machine: windows
- Path: C:\Users\PC\agentic-workflow
- Commit/branch: master