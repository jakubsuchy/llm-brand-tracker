# LLM Brand Tracker

Track how your brand is mentioned across ChatGPT, Perplexity, Google Gemini, and other LLM providers. Generate prompts, run them against multiple providers, and analyze where your brand appears — and where it doesn't.

## What it does

1. **Analyze your brand** — enter your website URL, the system scrapes it and identifies competitors
2. **Generate prompts** — AI creates brand-neutral prompts across topics relevant to your industry
3. **Run against LLM providers** — sends each prompt to Perplexity, ChatGPT, Gemini (configurable)
4. **Track results** — brand mention rate, competitor analysis, source citations, topic breakdowns
5. **Compare providers** — see which LLM mentions your brand most, which competitors dominate where
6. **Find gaps** — identify prompts where your brand should be mentioned but isn't

## Quick start

```bash
curl -O https://raw.githubusercontent.com/jakubsuchy/llm-brand-tracker/main/docker-compose.yml
docker compose up -d
```

Open `http://localhost:3000`. Create an admin account, then configure your OpenAI API key and brand details in the setup wizard. Everything is configurable in the web UI — no `.env` file needed.

### With local browser provider (free)

```bash
docker compose --profile browser up -d
```

## Launch with Claude Code

You can set up LLM Brand Tracker directly from Claude Code:

```
Download docker-compose.yml from
https://raw.githubusercontent.com/jakubsuchy/llm-brand-tracker/main/docker-compose.yml
and run docker compose up -d. Then open http://localhost:3000
```

After setup, connect Claude to your data via MCP:

```
claude mcp add --transport http brand-tracker http://localhost:3000/mcp --header "Authorization:Bearer YOUR_API_KEY"
```

Then ask questions like:
- "What's my brand mention rate?"
- "Which provider performs best for us?"
- "What prompts don't mention us?"
- "Which sources cite competitors but not us?"

## Running prompts: Local vs Cloud

You choose how browser-based prompts are executed:

### Local (free, ~1 prompt/min)
Run a browser container alongside the app. One prompt at a time. May get blocked by anti-bot protections.

```bash
docker compose --profile browser up -d
```

### Apify Cloud (~$0.05/prompt, ~15 prompts/min)
Use [Apify](https://apify.com/?fpr=1lkb9a) for parallel execution with residential proxies. No anti-bot issues. Set your Apify token in Settings → Credentials.

Switch between modes in Settings → Credentials → Browser Analysis Mode.

## Features

### Dashboard
- Brand mention rate across all providers
- Per-provider performance comparison
- Top competitors with mention rates
- Topic-level analysis
- Source citations with brand/competitor/neutral classification
- Filter by provider and analysis run

### Prompt Generator
- AI-generated brand-neutral prompts across configurable topics
- Add custom write-in prompts
- Prompts saved to DB, reusable across runs

### Analysis
- PostgreSQL job queue with retry logic
- Concurrent workers (30 for cloud, 1 for local browser)
- Real-time progress with job-level detail
- Failed job tracking with full error messages
- Crash recovery — resumes interrupted runs on restart

### Competitors
- Auto-detected from LLM responses
- Merge duplicates (auto-suggested)
- Block irrelevant entries
- Per-prompt comparison (brand vs competitor)
- Source overlap analysis

### Authentication
- Local login (email/password)
- Google OAuth 2.0
- SAML SSO
- Role-based access: user, analyst, admin
- Auth provider config manageable via UI

### Settings
- Brand configuration
- API keys (OpenAI, Apify) — all configurable in the UI
- Provider enable/disable (Perplexity, ChatGPT, Gemini)
- Competitor source recognition rules
- Danger zone (delete results or everything)

## MCP Server

The app includes an [MCP](https://modelcontextprotocol.io/) endpoint for querying brand data from Claude Desktop, Claude Code, or any MCP client.

### Setup

```bash
claude mcp add --transport http brand-tracker http://localhost:3000/mcp --header "Authorization:Bearer YOUR_API_KEY"
```

Your API key is in the sidebar (click the key icon next to your name).

### Available tools (16)

| Tool | Description |
|------|-------------|
| `brand-snapshot` | Quick health check: mention rate, top competitor, sources |
| `brand-audit` | Comprehensive assessment with per-provider/topic/competitor breakdown |
| `list-providers` | Provider mention rates |
| `list-competitors` | Ranked competitors by mention rate |
| `list-topics` | Topic breakdown with rates |
| `list-sources` | Top sources with classification |
| `list-runs` | Analysis run history |
| `get-competitor` | Deep dive on a single competitor |
| `get-source` | Deep dive on a source domain |
| `get-response` | Full response text for a specific prompt |
| `search-prompts` | Search prompt/response text with filters |
| `find-unmentioned` | Prompts where brand is NOT mentioned |
| `compare-providers` | Side-by-side provider comparison |
| `compare-competitor` | Brand vs specific competitor head-to-head |
| `compare-sources` | Source overlap (brand-only, competitor-only, shared) |
| `get-run` | Single run details with metrics |

## Tech stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, wouter
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI API (GPT-4o) for prompt generation and response analysis
- **Browser automation**: Apify actors with Camoufox (anti-detect Firefox)
- **Auth**: PassportJS (local, Google OAuth, SAML)
- **MCP**: Model Context Protocol server for LLM tool integration
- **Deployment**: Docker Compose

## Development

```bash
# Build from source instead of pulling images
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Or run directly
npm install
npm run dev          # Dev server (port 3000)
npm run build        # Production build
npm run db:push      # Push schema changes to DB
```
