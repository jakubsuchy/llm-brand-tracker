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
4. **Models** — Enable the LLM providers you want to track
5. **Prompts** — Use the Prompt Generator to create brand-neutral prompts
6. **Run** — Start your first analysis

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
