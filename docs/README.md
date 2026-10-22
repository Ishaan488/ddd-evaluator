# Documentation

| I want to... | Read |
|---|---|
| **Understand what the agent does and find its code** | [agent.md](agent.md) |
| See how the whole system fits together | [architecture.md](architecture.md) |
| Write or review a scorecard | [scorecard-reference.md](scorecard-reference.md) |
| Install, configure, run, back up, fix problems | [operations.md](operations.md) |
| Call the API from a script | [api.md](api.md) |
| Check what protects the data, and what does not yet | [security.md](security.md) |
| See how this maps to the Agentic Roadmap PDF, page by page | [pdf-traceability.md](pdf-traceability.md) |
| Understand why it was built this way | [decisions.md](decisions.md) |
| Change the code | [development.md](development.md) |

## Reading order

- **Mentor or lead:** [agent.md](agent.md) → [pdf-traceability.md](pdf-traceability.md) → [security.md](security.md)
- **Author submitting work:** [scorecard-reference.md](scorecard-reference.md) → the report (see *Using it* in the main [README](../README.md))
- **Engineer taking it over:** [architecture.md](architecture.md) → [agent.md](agent.md) → [development.md](development.md) → [decisions.md](decisions.md)
- **Whoever runs it:** [operations.md](operations.md) → [security.md](security.md)

## Diagrams

Sources are in [`diagrams/`](diagrams/) (Mermaid) and the rendered SVGs in [`images/`](images/).

| Diagram | Used in |
|---|---|
| `images/architecture.svg` (hand-drawn layered view) | README, architecture.md |
| `01-system-context` | architecture.md |
| `02-agent-pipeline` | agent.md |
| `03-evaluation-sequence` | architecture.md |
| `04-data-model` | architecture.md |
| `05-verdict-rule` | agent.md |
| `06-iteration-loop` | architecture.md |
| `07-trust-boundaries` | security.md |
| `08-deployment` | architecture.md |

Re-render after editing a source: `bash docs/diagrams/render.sh`.
