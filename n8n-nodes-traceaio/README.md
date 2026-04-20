# n8n-nodes-traceaio

[n8n](https://n8n.io/) community node for [TraceAIO](https://github.com/jakubsuchy/traceaio) — track your brand mentions across LLM providers.

## Nodes

### TraceAIO Trigger

Polling trigger that fires when a new analysis run completes. Outputs run metadata (ID, brand name, prompts, response count, timestamps).

### TraceAIO

Action node with resource/operation pattern:

| Resource | Operation | Description |
|----------|-----------|-------------|
| **Metrics** | Get | Brand mention rate, top competitor, source counts |
| **Metrics** | Get Visibility Score | Visibility score with model/run count |
| **Metrics** | Get By Model | Per-model mention rates |
| **Competitors** | Get All | Competitor ranking with mention rates |
| **Sources** | Get All | Source domains with citation counts and types |
| **Analysis** | Start | Kick off a new analysis run |

## Credentials

- **Instance URL** — Your TraceAIO instance (e.g. `https://traceaio.example.com`)
- **API Key** — Generate from TraceAIO sidebar → "Chat with your data" → Generate API Key

## Example Workflow

1. **TraceAIO Trigger** (polls every 5 min) → detects new completed run
2. **TraceAIO** (Get Metrics, runId from trigger) → fetches mention rate
3. **IF** (mention rate < threshold) → conditional
4. **Slack** → send alert

## Installation

### In n8n

Go to **Settings → Community Nodes** and install `n8n-nodes-traceaio`.

### Local Development

```bash
cd n8n-nodes-traceaio
npm install
npm run build
npm link
# Then in your n8n installation directory:
npm link n8n-nodes-traceaio
n8n start
```

## License

Apache-2.0
