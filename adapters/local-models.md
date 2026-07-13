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

```bash
node harness/dist/cli.js new-run "Classify recent failure cases" 
  --repo /path/to/some-repo 
  --agent-id local-model 
  --role helper 
  --surface ollama 
  --validate "npm test" --validate "npm run lint"
```

## Guardrail

Do not make local/open-source models the default autonomous coding executor until they can produce
useful run records, evidence, and failure cases under this contract.
