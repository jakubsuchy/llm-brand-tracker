# Changelog

## [Unreleased]

### Competitor Merge Feature
- **Soft merge**: `competitors.merged_into` FK column lets users merge duplicate competitors (e.g. "PayPal Holdings", "PayPal Checkout", "PayPal") into one primary — no data deleted, all records preserved
- **`competitor_merges` table**: Audit log of every merge operation with timestamps for traceability
- **Aggregated analysis queries**: `getCompetitorAnalysisByRun` and `getCompetitorAnalysisAllRuns` resolve `merged_into` via SQL `COALESCE` — merged competitors' mentions roll up to the primary automatically
- **Merge UI**: "Merge Duplicates" button on Competitors page enters merge mode with checkboxes; dialog lets user pick the primary; toast confirmation
- **Auto-suggestions**: `getMergeSuggestions()` computes pairwise name similarity (substring + word overlap, 70% threshold) and groups potential duplicates — only competitors with actual mentions are considered
- **Unmerge**: Each merged competitor shows as a badge on the primary card with "x" to unmerge; `POST /api/competitors/unmerge` clears `merged_into`
- **Merge-aware response matching**: Compare page and Competitors page drill-downs check merged names when determining if a competitor was mentioned in a response
- **Source classification**: `/api/sources/analysis` includes merged competitors when matching domains, so merged competitor domains still classify correctly
- **4 new API endpoints**: `GET /api/competitors/merge-suggestions`, `POST /api/competitors/merge`, `POST /api/competitors/unmerge`, `GET /api/competitors/merge-history`

### Compare Page (New)
- **Brand vs Competitor comparison**: New `/compare` page with competitor selector and run filter (defaults to All Runs)
- **Side-by-side mention rates**: Brand and competitor shown with percentage, count, and progress bars
- **Delta summary**: "Both mentioned", "Only your brand", "Only [competitor]" counts
- **Topic breakdown**: Table showing brand vs competitor mention rate per topic with progress bars and delta column — sorted by brand advantage
- **Source overlap**: Three-column view of domains exclusive to brand, shared, and exclusive to competitor
- **Prompt-level comparison table**: Every response mentioning either, with check/X columns for brand and competitor, sorted by prompt text
- **Expandable response details**: Same pattern as Prompt Results page — full ChatGPT response, competitors mentioned (with highlight for selected competitor), sources cited
- **Run date column**: In "All Runs" mode, a RUN column shows the analysis run date for each response
- **Merge-aware**: Competitor matching accounts for merged names via merge history

### Dashboard Improvements
- **Default to All Runs**: Dashboard run selector now defaults to "All Runs" instead of latest run; added "All Runs" option to the dropdown
- **Run date column**: Prompt Results page shows a RUN column in "All Runs" mode so duplicate prompt texts from different runs are distinguishable
- **Trend indicators on metrics cards**: Brand Mentions, Top Competitor, and Sources Found cards show directional arrows (up/down/unchanged) comparing current vs previous run; gated on both runs having ≥5 prompts for statistical soundness; removed fake "from last week" text
- **Consistent prompt counts**: Brand Mentions denominator and Total Prompts Tested now use the same number (total responses) instead of pulling from different endpoints

### Prompt & Response Deduplication
- **Prompt creation fix**: `save-and-analyze` now deduplicates prompts by text using a `Map` — prevents creating duplicate prompt rows across runs
- **Analyzer dedup**: Both `savedPrompts` and `useExistingPrompts` paths deduplicate by text and set `_existing: true` to skip `createPrompt`
- **Data cleanup**: SQL migration re-pointed all responses to canonical (lowest-id) prompt per text, soft-deleted 68 duplicate prompt rows; deleted 29 duplicate responses (same prompt + same run), preserving all unique data

### OpenAI Responses API + Web Search
- **Real source citations**: Switched prompt response generation from Chat Completions API to OpenAI Responses API with `web_search` tool — sources are now real URLs from web search (when the model searches), not hallucinated training-data URLs
- **Removed "Cite your sources" instruction**: The old system prompt forced GPT to hallucinate URLs from training data and suppressed actual web search; removed in favor of letting the model search naturally
- **Annotation-based source extraction**: Sources extracted from `url_citation` annotations on the Responses API output instead of regex-parsing URLs from response text
- **Token tracking for Responses API**: Usage manually recorded from Responses API result since it bypasses the `chatCompletion` wrapper

### Model Upgrade: GPT-4o → GPT-5.4
- **Primary calls on `gpt-5.4`**: Prompt response generation (Responses API), prompt generation, topic generation, brand analysis — all upgraded from `gpt-4o` (retiring April 3, 2026)
- **Structured extraction on `gpt-5.4-mini`**: Brand/competitor JSON extraction (step 2) and competitor categorization use the smaller, faster model — sufficient for classification tasks
- **`max_tokens` → `max_completion_tokens`**: GPT-5.4 requires the new parameter name; all calls updated
- **Reasonable token limits**: Set per-call limits appropriate to each task (2048 for main response, 512 for JSON extraction, 256 for competitor names, 32 for categorization) instead of relying on model defaults

### Competitor Subdomain Recognition
- **New setting**: "Competitor Subdomain Recognition" in Settings page — configure subdomain prefixes (e.g. `docs`, `api`, `blog`) that should be recognized as competitor domains
- **Default prefix**: `docs` — so `docs.paypal.com` is automatically classified as a competitor source when `paypal.com` is a known competitor domain
- **Dynamic at query time**: Prefix stripping happens during source classification, not on insert — adding a new prefix instantly reclassifies existing sources without re-running analysis
- **DB-backed**: Stored as `competitorSubdomains` in `app_settings` table (comma-separated); persists across restarts
- **Tag-style UI**: Add/remove prefixes with badges, Enter key support, immediate save
- **API endpoints**: `GET /api/settings/competitor-subdomains`, `POST /api/settings/competitor-subdomains`

### Rate Limit & Error Handling
- **Quota errors fail fast**: `insufficient_quota` errors are detected and not retried — logs a clear message to check billing instead of burning through retry attempts
- **Longer backoff for rate limits**: Changed from `2s → 4s → 8s` to `5s → 15s → 45s → 135s → 405s` (power of 3 × 5s) in both the LLM wrapper and the analyzer retry loop

### UI Cleanup
- **Removed "vs Top Competitor" row**: `changeRate` was always 0 (never computed); removed the trend row from competitor cards and the "Losing Ground" / "Gaining Ground" insight panels
- **Replaced with real insights**: "Total Competitors" and "High Visibility (>25%)" panels use actual data
- **Removed Replit references**: Stripped `@replit/vite-plugin-cartographer`, `@replit/vite-plugin-runtime-error-modal` from `package.json` and `vite.config.ts`; removed Replit dev banner script from `index.html`

### Database Schema Changes (this release)
- Added `competitors.merged_into` integer FK column (nullable, self-referencing)
- Added `competitor_merges` table (id, primary_competitor_id FK, merged_competitor_id FK, performed_at)

### Dockerization
- Added `Dockerfile` with multi-stage build (deps, build, production) and Chromium for Puppeteer
- Added `docker-compose.yml` with PostgreSQL 16 service, health checks, and persistent `pgdata` volume
- Added `.dockerignore` to keep build context clean
- Changed server bind from `localhost` to `0.0.0.0` so it's reachable from outside the container
- Schema migration (`drizzle-kit push`) runs automatically on container startup

### OpenAI Integration — Centralized LLM Layer
- **`server/services/llm.ts`**: Single wrapper for all OpenAI calls — retry with exponential backoff, timeout, automatic token usage recording
- **`chatCompletion(params, options?)`**: Drop-in replacement for `openai.chat.completions.create` with retry, timeout, and token tracking built in
- **`chatCompletionJSON<T>(params)`**: Same + `response_format: json_object` + JSON parse; auto-appends "Respond in JSON." if the word "json" is missing from messages (OpenAI requirement)
- **`extractArray<T>(parsed)`**: Extracts first array from `{"key": [...]}` wrapper objects (OpenAI's json_object mode always returns objects, never bare arrays)
- **Eliminated all direct OpenAI client instances**: `openai.ts`, `prompt-generator.ts`, and `analyzer.ts` all use `llm.ts` now — one client, one place for configuration
- **Removed `callOpenAIWithRetry`**: Replaced by `chatCompletion` which handles retry, timeout, and token recording

### Token Usage Tracking
- **`api_usage` table**: Records `analysis_run_id`, `model`, `input_tokens`, `output_tokens`, `called_at` for every OpenAI API call
- **Automatic recording**: `chatCompletion` records tokens after every successful call — no manual instrumentation needed
- **`GET /api/usage`**: Returns grand totals and per-run breakdown (last 10 runs)
- **Settings page**: API Usage card showing total tokens, input/output breakdown, estimated cost (GPT-4o pricing), per-run table with model, tokens, calls, and cost

### Prompt Generation — Complete Rewrite
- **Removed SMB bias**: Replaced "Struggling to...", "Dealing with...", "for small business", "under $100/month" prompt patterns with natural, enterprise-focused language ("What's the best...", "Recommend me a...", "Top rated...")
- **Brand-neutral prompts**: Prompts no longer mention the user's brand or competitors by name — the whole point is to test organic mentions
- **Single batch API call**: Replaced per-prompt API calls (slow, expensive) with one batch call per topic
- **Custom topics**: Users can now specify their own topics in the Settings step before generation; remaining slots are filled by AI
- **Topic & prompt deletion**: In the Review step, users can soft-delete entire topics or individual prompts via API — historical data preserved
- **Parallelized topic generation**: All topics generate prompts concurrently via `Promise.all`
- **DB-backed state**: Prompt generator loads all data from DB instead of localStorage — topics, prompts, brand URL, and competitors all survive server restarts and are shared across tabs
- **Removed random context bias**: Eliminated the random variety contexts ("Focus on enterprise solutions", "Prioritize security", etc.) that biased responses differently each run — now responses are consistent across runs for trend tracking
- **Unbiased source citations**: Replaced prescriptive source list ("Include GitHub repos, Stack Overflow links, Reddit discussions...") with neutral "Cite your sources" instruction — sources now reflect what GPT-4 actually relied on

### Competitor Analysis
- **Brand detection fixed**: `analyzePromptResponse` now receives brand name and known competitors, so GPT-4 can distinguish "your brand" from competitors
- **Brand name persistence**: Brand name is stored in `app_settings` DB table, survives container restarts, loaded on server startup
- **Brand filtering**: Deterministic case-insensitive filter prevents own brand from appearing as a competitor
- **`name_key` column**: Competitors table has a lowercased `name_key` column with `UNIQUE` constraint — eliminates "PayPal" vs "paypal" duplicates at the DB level; insert races handled by catching constraint violation and returning existing record
- **`competitors.domain` column**: Auto-populated when a source URL matches a competitor by name — enables precise source-to-competitor domain matching
- **Inclusive competitor detection**: Analysis prompt changed from "Do NOT include generic names" to "Be thorough — include all companies and products mentioned as alternatives"; minimum name length lowered to 2 chars so short names are captured
- **Generic name normalization**: Short names like "AWS" are matched to existing full names like "AWS Elastic Load Balancing" instead of creating duplicates
- **Platform exclusion**: Platforms like Reddit, GitHub, Stack Overflow, YouTube etc. are excluded from competitor list via prompt rules
- **`competitor_mentions` table**: Each competitor mention is recorded per-response per-run, replacing the old global `mention_count` counter — enables accurate per-run and cross-run competitor analytics from DB queries instead of parsing response arrays at runtime
- **Competitor drill-down**: Competitors page now has expandable sections showing which prompts mentioned each competitor, with full response text

### Analysis Runs
- **`analysis_runs` table**: Each analysis is a distinct run with `id`, `started_at`, `completed_at`, `status`, `brand_name`, `brand_url`, `total_prompts`, `completed_prompts`
- **Responses linked to runs**: `responses.analysis_run_id` FK ties every response to the run that created it
- **Source URLs linked to runs**: `source_urls.analysis_run_id` FK ties every source citation to its run
- **No more data deletion**: Analysis runs append data — old responses, competitors, and sources are preserved across runs
- **Run selector on Dashboard**: Dropdown shows all completed runs by date/time; defaults to latest; changes the URL (`/?runId=X`) for linkability
- **Run filter on all pages**: Prompt Results, Competitor Analysis, and Source Domains pages all have run filter dropdown in top-right (consistent placement)
- **All API endpoints support `?runId=X`**: `/api/responses`, `/api/metrics`, `/api/counts`, `/api/topics/analysis`, `/api/competitors/analysis`, `/api/sources/analysis` all filter by run when specified
- **`GET /api/analysis/runs`**: Lists all runs with response counts, filters out empty runs

### Analysis Engine
- **Parallelized prompt processing**: 3 concurrent workers instead of sequential with 2-second delays (~3-4x faster)
- **Rate limit backoff**: Exponential retry (2s, 4s, 8s, 16s, 32s) on 429 errors instead of failing
- **Fixed JSON truncation**: Removed URL extraction from GPT-4 analysis call (was causing responses to exceed `max_tokens` and truncate mid-JSON, making every analysis fall to the fallback path)
- **Unified analysis launcher**: Single `launchAnalysis()` function used by both `/api/save-and-analyze` and `/api/analysis/start` — eliminated duplicate route with different behavior
- **Removed dead duplicate route**: Second `/api/analysis/start` (never reached by Express) was deleted
- **No more prompt duplication**: Re-running analysis deduplicates prompts by text; reuses existing prompt records via `_existing` flag
- **Smart prompt sync**: `save-and-analyze` compares incoming prompts with existing — only creates new records for changed prompts, reuses unchanged ones
- **Fixed `www.` in brand extraction**: `extractDomainFromUrl` now strips `www.` prefix so `www.stripe.com` correctly yields brand name `stripe`
- **Efficient competitor creation**: Checks DB before calling OpenAI categorization API — avoids wasted API calls for already-known competitors

### Source Classification
- **Dynamic classification**: Source domains are classified as Brand/Competitor/Neutral at query time, not at insert time — reclassifies automatically when competitors change
- **Matching logic**: Brand = domain contains brand name; Competitor = domain matches competitor domain or name words; Neutral = everything else
- **Filter UI**: "Show citations from: [x] Your brand [x] Competitors [x] Other" checkboxes on Sources page
- **Visual badges**: Green "Brand" / Red "Competitor" badges on each domain row
- **Removed static `source_type` column**: Classification is derived, never stored — always reflects current competitor list

### Sources Page Revamp
- **Inline prompts/responses**: Each domain row has "Prompts" button — expands to show all responses that cited this domain, with prompt text, brand mention badge, competitors found, and expandable full response
- **Inline pages**: Each domain row has "Pages" button — expands to show all unique URLs from this domain with external links
- **Removed separate Source Articles section**: Pages are now inline per domain
- **`GET /api/sources/:domain/responses`**: New endpoint returning responses that cite a specific domain, supports `?runId` filter

### Data Persistence — localStorage Removed
- **All state from DB**: Dashboard, Prompt Generator, and Analysis Progress pages load brand name, brand URL, topics, prompts, and competitors from the database
- **`GET /api/settings/brand`**: Returns persisted brand name and URL
- **`GET /api/topics/with-prompts`**: Returns non-deleted topics with their non-deleted prompts for the prompt generator
- **No localStorage dependency**: Application state survives container restarts, works across multiple browser tabs, and is consistent with the database

### Soft Delete
- **`topics.deleted`** and **`prompts.deleted`** boolean columns — default false
- **`DELETE /api/topics/:id`**: Soft-deletes a topic and all its prompts
- **`DELETE /api/prompts/:id`**: Soft-deletes a single prompt
- **Filtered by default**: `getTopics()` and `getPrompts()` exclude deleted records; old responses still reference deleted prompts so historical data is preserved
- **UI integration**: Delete buttons in prompt generator Review step call the API, then update local state

### UI Improvements
- **Deep linking to prompts**: Dashboard "Recent Prompt Results" has "View details" link per result → navigates to `/prompt-results?promptId=X&runId=Y`; Prompt Results page reads URL params, auto-expands the prompt, scrolls to it, highlights the row
- **Prompt Results page**: Replaced non-functional checkboxes with "Details" expand button showing full GPT-4 response, competitors mentioned, and sources cited; added pagination (20 per page); run filter in top-right
- **Recent Prompt Results (dashboard)**: Pagination is per-filter — switching between All/Mentioned/Not Mentioned shows correct paginated results; filter buttons show counts; replaced "Load More" with Prev/Next pagination
- **Competitors page**: Added expandable prompt list per competitor with "Show full response" toggle; run filter in top-right; stats come from DB (`competitor_mentions`) not response array parsing
- **Sources page**: Run filter in top-right; source type filter checkboxes; inline prompts/responses and pages per domain
- **Dashboard cleanup**: Removed brand name/URL inputs, Run Analysis button, and Refresh button — analysis is managed through Prompt Generator and Analysis Progress pages
- **Topic analysis "View All"**: Button now actually toggles between top 5 and full list; only shows when there are more than 5 topics
- **Topic name expansion**: Truncated topic names are clickable to expand, with full name on hover
- **Analysis Progress page**: Fixed stuck "Analysis Running..." state on page load (default status changed from `initializing` to `idle`); removed hardcoded prompts/topics settings
- **Dashboard metrics**: Sources Found and Across N domains now show real data; Top Competitor mention rate rounded to 1 decimal
- **Dashboard competitor widget**: Total prompts count now displays correctly

### Database Schema Changes
- Added `analysis_runs` table (id, started_at, completed_at, status, brand_name, brand_url, total_prompts, completed_prompts)
- Added `competitor_mentions` table (id, competitor_id FK, analysis_run_id FK, response_id FK, created_at)
- Added `source_urls` table (id, source_id FK, analysis_run_id FK, url, first_seen_at)
- Added `api_usage` table (id, analysis_run_id FK, model, input_tokens, output_tokens, called_at)
- Added `app_settings` table (id, key unique, value)
- Added `responses.analysis_run_id` FK column
- Added `competitors.name_key` unique column for case-insensitive deduplication
- Added `competitors.domain` column for source-to-competitor matching
- Added `topics.deleted` and `prompts.deleted` boolean columns for soft delete
- Removed `sources.source_type` column (classification is now dynamic)
