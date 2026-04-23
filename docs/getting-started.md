# Getting Started

TraceAIO tracks how your brand is mentioned across LLM providers — ChatGPT, Perplexity, Google Gemini, and Google AI Mode.

## Quick Start with Docker

```bash
curl -O https://raw.githubusercontent.com/jakubsuchy/traceaio/main/docker-compose.yml
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your admin account.

## Setup Steps

1. **Brand** — Enter your brand URL and name in Settings > Brand
2. **Credentials** — Add an OpenAI or Anthropic API key for analysis
3. **Browser Mode** — Choose Apify Cloud (recommended) or local container
4. **Models** — Enable the LLM providers you want to track ([see below](#choosing-models))
5. **Prompts** — Use the Prompt Generator to create brand-neutral prompts
6. **Run** — Start your first analysis

## Choosing Models

TraceAIO queries each prompt against every enabled model. You don't have to pick one — enabling both an API model and a browser model for the same provider gives you quick signal plus ground truth.

There are two transport types:

### API Models

Fastest to set up — just an API key, no browser actor, no proxies. Runs in-process and returns real web citations via the provider's built-in search tool.

| Model | Requires | Best for |
|-------|----------|----------|
| **OpenAI API — GPT-5** | OpenAI API key | First-run testing, high-volume runs, CI/scheduled analyses |
| **Anthropic API — Claude Sonnet 4.6** | Anthropic API key | Cross-checking OpenAI results, longer-context reasoning |

API models are auto-enabled the first time a matching key is present. They're the cheapest path to coverage and the right default if you're just getting started.

### Browser Models

Slower but more accurate — replays what a real user sees in the chat UI, which is the only way to capture the exact response ChatGPT, Perplexity, Gemini, and Google AI Mode actually surface to end-users. Requires an Apify token (Cloud mode, recommended) or a local browser container.

| Model | Best for |
|-------|----------|
| **ChatGPT** | Tracking what logged-in users see on chat.openai.com |
| **Perplexity** | Source-rich answers with inline citations |
| **Google Gemini** | Google's consumer assistant surface |
| **Google AI Mode** | Google Search's AI-generated overview |

Use browser models when you need ground truth — API output can drift from the UI surface, and the UI is what your customers experience.

### When to pick what

- **Just evaluating the product?** Enable the API models you have keys for. No Apify account needed.
- **Tracking competitive visibility for real?** Enable both — API models give you cheap, high-cadence coverage and browser models give you ground truth for the providers you actually care about.
- **Running on a budget?** API-only. Browser runs cost ~10–50× more per prompt on Apify Cloud.
- **Need to match what a user literally sees?** Browser-only for that provider. API responses can include sources or phrasing that differ from the chat UI.

You can change model selection any time in **Settings → Models** without losing history — prior responses stay tied to the model that produced them.

## Requirements

| Component | Purpose |
|-----------|---------|
| Docker + Docker Compose | Run the application and PostgreSQL |
| OpenAI or Anthropic API key | Prompt generation and competitor extraction |
| Apify Cloud token (recommended) | Browser-based LLM querying with residential proxies |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Configurable via UI | OpenAI API key |
| `ANTHROPIC_API_KEY` | Configurable via UI | Anthropic API key |
| `APIFY_TOKEN` | Configurable via UI | Apify Cloud token |
| `SESSION_SECRET` | Recommended | Session encryption secret |
