# Local / Open-Source Model Adapter

Status: peer adapter — any role, evidence-gated (start with helper roles to build evidence)

Local models should plug into the reliability layer as helpers before they become autonomous coding
executors. Good first roles:

- summarize long logs
- classify failure cases
- draft labels and tags
- summarize metrics
- run retrieval or embedding experiments

## Start

```powershell
& C:\Users\PC\agentic-workflow\scripts\new_run.ps1 `
  -Objective "Classify recent failure cases" `
  -Repo C:\Users\PC\agentic-workflow `
  -AgentId local-model `
  -AgentRole classifier `
  -AgentSurface ollama `
  -AgentModel "llama3.1:8b" `
  -ValidationPlan 'review generated labels'
```

## Guardrail

Do not make local/open-source models the default autonomous coding executor until they can produce
useful run records, evidence, and failure cases under this contract.
