# CLAUDE.md

## Project Overview

LLM Brand Tracker — a web app that analyzes how your brand and competitors are mentioned in ChatGPT responses. It generates brand-neutral prompts, sends them to OpenAI, and tracks which brands get mentioned organically.

## Tech Stack

- **Backend**: Node.js/Express, TypeScript, ESM modules
- **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, wouter (routing), TanStack Query
- **Database**: PostgreSQL with Drizzle ORM
- **API**: OpenAI GPT-4o for prompt generation and response analysis
- **Deployment**: Docker + docker-compose (app + postgres)

## Commands

```bash
npm run dev          # Start dev server (tsx, port 3000)
npm run build        # Vite build + esbuild server bundle
npm run start        # Production server (node dist/index.js)
npm run db:push      # Push schema to DB (drizzle-kit push)
docker compose up --build  # Build and run with postgres
docker compose down -v     # Wipe DB and stop
```

## Project Structure

```
shared/schema.ts          # Drizzle schema — single source of truth for all tables
server/routes.ts           # All API endpoints + launchAnalysis() helper
server/services/analyzer.ts # BrandAnalyzer class — runs analysis with concurrency
server/services/openai.ts  # GPT-4 calls: prompt generation, response analysis
server/services/scraper.ts # URL extraction, domain parsing
server/database-storage.ts # All DB queries (implements IStorage interface)
server/storage.ts          # IStorage interface + in-memory implementation
client/src/pages/          # Page components (dashboard, competitors, sources, etc.)
client/src/components/     # Shared UI components (metrics, topic analysis, etc.)
```

## Database Schema

All tables defined in `shared/schema.ts`. Key relationships:

```
topics (id, name, description, deleted)
  └── prompts (id, text, topic_id FK, deleted)
        └── responses (id, prompt_id FK, analysis_run_id FK, text, brand_mentioned, competitors_mentioned[], sources[])
              └── competitor_mentions (id, competitor_id FK, analysis_run_id FK, response_id FK)

competitors (id, name, name_key UNIQUE, domain, category)
  └── competitor_mentions (links competitors to responses and runs)

sources (id, domain, url, title)
  └── source_urls (id, source_id FK, analysis_run_id FK, url)

analysis_runs (id, started_at, completed_at, status, brand_name, brand_url, total_prompts, completed_prompts)

app_settings (id, key UNIQUE, value)  — stores brandName, brandUrl
analytics (id, date, total_prompts, brand_mention_rate, top_competitor, ...)
```

## Critical Design Decisions

### Brand detection
- Brand name is extracted from the URL domain: `www.stripe.com` → strip `www.` → `stripe.com` → split on `.` → `stripe`
- Stored in `app_settings` table, loaded on server startup
- GPT-4 is told the brand name so it can distinguish "brand mentioned" from "competitor"
- The analyzer filters competitors case-insensitively: if the name contains the brand or vice versa, it's excluded

### Competitor deduplication
- `competitors.name_key` column = lowercased name, has UNIQUE constraint
- `createCompetitor` catches constraint violation (23505) and returns existing record
- This handles concurrent worker races — Postgres is the single source of truth
- Display name (`name`) keeps original casing from first insert

### Prompts must be brand-neutral
- The whole point is testing organic mentions — prompts must NEVER contain the brand name or competitor names
- Prompts should be simple and natural: "What's the best payment processor for online businesses?" not "Struggling to configure payment gateway settings for beginners"
- The `generatePromptsForTopic` system prompt explicitly forbids brand names

### Analysis runs
- Each analysis creates an `analysis_runs` record
- All responses, competitor_mentions, and source_urls link to the run via FK
- Old data is NEVER deleted — runs accumulate
- The only thing that deletes data is the explicit "Start Over" / `/api/data/clear` endpoint
- All API endpoints accept `?runId=X` to scope data to a specific run

### Soft delete
- `topics.deleted` and `prompts.deleted` — boolean columns, default false
- `getTopics()` and `getPrompts()` filter out deleted records
- Old responses still reference deleted prompts — historical data preserved
- DELETE endpoints: `/api/topics/:id`, `/api/prompts/:id`

### Source classification
- Sources (cited URLs) are classified dynamically at query time, NOT stored
- Classification: match source domain against brand name → "brand", against competitor domains/names → "competitor", else → "neutral"
- `competitors.domain` is auto-populated when a source URL matches a competitor by name
- Never store `source_type` on the sources table — it must stay dynamic so reclassification happens automatically when competitors change

### Analysis concurrency
- 3 concurrent workers process prompts in parallel
- Rate limit errors (429) trigger exponential backoff: 2s, 4s, 8s, 16s, 32s
- Each prompt makes 2 OpenAI calls: generate response + analyze for brand/competitor mentions
- Competitor categorization is an additional call, but only for new competitors (checked before calling)

## Common Pitfalls

- **Server bind**: Must be `0.0.0.0`, not `localhost`, for Docker
- **`www.` prefix**: `extractDomainFromUrl` strips it — without this, brand name becomes "www"
- **JSON truncation**: GPT-4 `response_format: json_object` + low `max_tokens` = truncated JSON. Keep analysis responses small (no URLs in the JSON)
- **Duplicate routes**: Express uses first match. Never register the same path twice.
- **localStorage**: Fully removed. All state comes from DB. Don't reintroduce it.
- **FK constraints**: Can't delete responses without first deleting competitor_mentions and source_urls that reference them. Prefer soft delete.
- **`response_format: json_object`**: Always returns an object `{...}`, never a bare array. Always extract arrays with `Object.values(parsed).find(v => Array.isArray(v))`.

## Environment Variables

```
DATABASE_URL=postgresql://admin:password@db:5432/brand_tracker
OPENAI_API_KEY=sk-...
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```
