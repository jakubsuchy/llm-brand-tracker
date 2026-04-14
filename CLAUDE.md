# CLAUDE.md

## Project Overview

TraceAIO — a web app that analyzes how your brand and competitors are mentioned across LLM providers (Perplexity, ChatGPT, Google Gemini). Generates brand-neutral prompts, runs them against multiple providers via browser automation (local or Apify Cloud), and tracks which brands get mentioned organically.

## Tech Stack

- **Backend**: Node.js/Express, TypeScript, ESM modules
- **Frontend**: React 18, Vite, Tailwind CSS, Radix UI, wouter (routing), TanStack Query
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: OpenAI GPT-4o for prompt generation and response analysis
- **Browser**: Apify actors with Camoufox (local container or Apify Cloud)
- **Auth**: PassportJS (local login, Google OAuth, SAML SSO)
- **MCP**: Model Context Protocol server at `/mcp` for Claude AI integration
- **Deployment**: Docker Compose (app + postgres + optional browser-actor)

## Commands

```bash
npm run dev                          # Start dev server (tsx, port 3000)
npm run build                        # Vite build + esbuild server bundle
npm run start                        # Production server (node dist/index.js)
npm run db:push                      # Push schema to DB (drizzle-kit push)
docker compose up --build            # Build and run with postgres
docker compose up                    # Includes local browser container
docker compose down -v               # Wipe DB and stop
```

## Project Structure

```
shared/schema.ts            # Drizzle schema — single source of truth for all tables
server/routes.ts            # All API endpoints + launchAnalysis() helper
server/mcp.ts               # MCP server with 16 tools for Claude AI integration
server/services/analyzer.ts # BrandAnalyzer class — job queue worker loop
server/services/auth.ts     # PassportJS config, user CRUD, API key generation
server/services/settings.ts # DB-stored settings (override env vars)
server/services/analysis.ts # Generic analysis utilities (brand detection, URL extraction, similarity)
server/services/openai.ts   # OpenAI-specific LLM calls: prompt generation, competitor extraction
server/services/chatgpt-browser.ts  # Browser actor client (local + Apify Cloud)
server/config.ts            # Public API paths config
server/database-storage.ts  # All DB queries (implements IStorage interface)
server/storage.ts           # IStorage interface + in-memory implementation
client/src/pages/           # Page components (dashboard, competitors, sources, etc.)
client/src/components/      # Shared UI components (metrics, topic analysis, etc.)
client/src/hooks/use-auth.ts # Auth context + hook (AuthProvider, useAuth)
browser-actor/              # Apify actor for browser-based prompt execution (gitignored)
```

## Database Schema

All tables defined in `shared/schema.ts`. Key tables:

```
topics → prompts → responses (with model, brand_mentioned, competitors_mentioned[])
                 → competitor_mentions (junction: competitor × response × run)
competitors (name, name_key UNIQUE, domain, category, merged_into)
sources → source_urls (per-run, per-model)
analysis_runs (status, brand_name, total_prompts, completed_prompts)
job_queue (prompt_text, model, status, attempts, original_job_id for retry chains)
users (email, full_name, hashed_password, salt, google_id, api_key)
roles → user_roles (user × role mapping)
app_settings (key-value store for all config)
apify_usage (cost tracking per Apify run)
api_usage (OpenAI token tracking)
```

## Critical Design Decisions

### Multi-model analysis
- Prompts are sent to multiple LLM models (Perplexity, ChatGPT, Gemini)
- Model config stored in DB (`app_settings` key `modelsConfig`), manageable via Settings → Models
- Each (prompt, model) pair is a separate job in the queue
- Browser models run via local container or Apify Cloud (configurable per-deployment)

### Job queue
- PostgreSQL-based with `SELECT FOR UPDATE SKIP LOCKED` for dequeuing
- Jobs have status: pending → processing → completed/failed/cancelled
- Failed jobs create new retry jobs (preserving failure history via `original_job_id`)
- 429/busy errors don't count as real attempts
- Cloud mode: 30 concurrent workers. Local: 1 (browser singleton)
- Stall recovery runs every 2 minutes during analysis

### Brand detection
- Brand name matched via regex (`isBrandMentioned` in `server/services/analysis.ts`) — no LLM needed
- Metrics use unique prompt counting (not raw response count across models/runs)

### Unique prompt counting — CRITICAL
- Each prompt is sent to multiple models (Perplexity, ChatGPT, Gemini), producing multiple responses
- ALL metrics, percentages, and counts MUST use unique prompts (deduplicated by `prompt.text.toLowerCase().trim()`)
- NEVER show raw response counts to users — always deduplicate first
- **"X of Y prompts"**: Y = total unique prompts. X = unique prompts where the condition is true in ANY response (across all models). A prompt "mentions brand" if at least one model's response mentioned it.
- The server endpoints (`/api/metrics`, `/api/competitors/analysis`) already return unique prompt counts
- Client pages should use the server's numbers, NOT count `responses.length` directly

### Prompts must be brand-neutral
- Prompts must NEVER contain brand or competitor names
- The `generatePromptsForTopic` system prompt explicitly forbids brand names
- Mix generic ("Recommend a load balancer") with enterprise-qualified prompts

### Authentication & Route Protection

All API routes protected by PassportJS session auth. The guard in `server/routes.ts` checks authentication on all `/api/*` routes.

- **Auth routes** (`/api/auth/*`, `/api/initialize`) registered BEFORE the guard — automatically exempt
- **Public API paths** in `server/config.ts` → `PUBLIC_API_PATHS`
- **`/mcp` endpoint** uses its own API key auth (not session-based) — exempt from guard since it's not under `/api`
- **Role-based access**: `requireRole('admin')` or `requireRole('analyst')` per-route
- Routes without `requireRole` are accessible to any authenticated user
- Admin always passes any role check

**IMPORTANT: When adding new API routes, ALWAYS add `requireRole('admin')` by default.** Then ask the user which role should actually have access. Roles: `admin` (full access), `analyst` (analysis/prompts), `user` (read-only dashboards).

### MCP Server

Integrated at `/mcp` inside the Express app (not a separate process). Uses `@modelcontextprotocol/sdk` with Streamable HTTP transport.

- 16 tools for querying brand data (see `server/mcp.ts`)
- Authenticated via per-user API key (`Authorization: Bearer <key>`)
- API keys auto-generated on user creation, stored in `users.api_key`
- Legacy users get keys backfilled at startup (`backfillApiKeys()`)
- Tools return structured JSON — the calling model analyzes the data
- Express `json()` middleware is skipped for `/mcp` (transport reads raw stream)

### Settings system
- `server/services/settings.ts` provides centralized access to config
- DB values (in `app_settings`) override environment variables
- `loadSettingsIntoEnv()` runs at startup, copies DB values to `process.env`
- `setSetting()` updates both DB and `process.env` immediately

### Drizzle migrations
- `drizzle.config.ts` has `tablesFilter: ["!session"]` to ignore the `connect-pg-simple` session table
- Without this, `drizzle-kit push` tries to delete the session table

## Common Pitfalls

- **Server bind**: Must be `0.0.0.0`, not `localhost`, for Docker
- **Express middleware order**: `app.use()` runs before route-level middleware. Can't use route middleware to override `app.use()` behavior.
- **FK constraints on delete**: Must delete in order: job_queue → competitor_mentions → apify_usage → api_usage → responses → prompts → competitors → sources → analysis_runs
- **`response_format: json_object`**: Always returns `{...}`, never bare array. Extract with `Object.values(parsed).find(v => Array.isArray(v))`
- **Duplicate routes**: Express uses first match. Never register the same path twice.
- **localStorage**: Fully removed. All state from DB. Don't reintroduce.
- **sed on macOS**: `sed -i ''` can corrupt files silently. Prefer the Edit tool.
- **Duplicated filter UI**: Response filter bars (search, run, topic, model dropdowns) appear on multiple pages. Use the shared `ResponseFilters` component from `client/src/components/response-filters.tsx` — don't clone filter code.

## Environment Variables

```
# Required
DATABASE_URL=postgresql://admin:password@db:5432/brand_tracker
OPENAI_API_KEY=sk-...

# Optional — browser analysis
APIFY_TOKEN=                           # Apify Cloud mode
BROWSER_ACTOR_URL=http://browser-actor:8888  # Local container

# Optional — auth
SESSION_SECRET=change-me-in-production
GOOGLE_CLIENT_ID=                      # Configurable via UI
GOOGLE_CLIENT_SECRET=                  # Configurable via UI
```
