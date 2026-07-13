# Path Conventions

Use paths that survive Windows, WSL, and Mac handoffs.

## Required Fields

Every run and failure JSON record should keep:

- `machine`: `windows`, `wsl`, or `mac`
- `repo`: canonical path on the machine where work ran
- `repo_name`: stable short repo name
- repo-relative file paths in Markdown sections whenever possible

## Machine Rules

- Windows desktop is canonical unless Kerry explicitly changes the source of truth.
- WSL paths are only canonical for WSL-native work.
- Mac work should be committed before switching machines; uncommitted state does not travel safely.
- Do not hardcode WSL paths for Windows-native projects.
- Do not treat Mac hook behavior as equivalent to Windows until parity is intentionally built.

