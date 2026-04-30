import type { Express, Response } from "express";
import archiver from "archiver";
import { db } from "../db";
import {
  topics,
  prompts,
  responses,
  competitors,
  sources,
  sourceUrls,
  watchedUrls,
  analysisRuns,
  competitorMentions,
  analytics,
} from "@shared/schema";
import { storage } from "../storage";
import { computeVisibilityScore } from "./helpers";
import { MODEL_META } from "@shared/models";
import type { ResponseWithPrompt } from "@shared/schema";

/**
 * Convert an array of row objects to a CSV string.
 * Uses RFC-4180 quoting: wrap any field containing comma, quote, newline, or
 * leading/trailing whitespace in double-quotes; escape internal quotes by
 * doubling them. Array values become semicolon-joined strings. Dates become
 * ISO 8601. null/undefined become empty.
 */
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const needsQuote = /[",\r\n]/;
  const encode = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? "" : String(x))).join("; ");
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (needsQuote.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => encode(row[h])).join(","));
  }
  return lines.join("\n");
}

function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

function modelLabel(m: string): string {
  return MODEL_META[m]?.label || m;
}

/**
 * Compute per-model unique-prompt mention rate for a response set.
 * Returns array sorted by rate descending.
 */
function perModelRates(responses: ResponseWithPrompt[]) {
  const byModel = new Map<string, Map<string, boolean>>();
  for (const r of responses) {
    const m = r.model || 'unknown';
    if (!byModel.has(m)) byModel.set(m, new Map());
    const key = r.prompt?.text?.toLowerCase().trim() || '';
    const pm = byModel.get(m)!;
    if (!pm.has(key)) pm.set(key, false);
    if (r.brandMentioned) pm.set(key, true);
  }
  return [...byModel.entries()]
    .map(([model, pm]) => {
      const total = pm.size;
      const mentioned = [...pm.values()].filter(Boolean).length;
      return { model, label: modelLabel(model), total, mentioned, rate: total > 0 ? (mentioned / total) * 100 : 0 };
    })
    .sort((a, b) => b.rate - a.rate);
}

/**
 * Compute the "unique-prompt mention rate" over a response set — a prompt
 * counts as mentioned if ANY response (across models and runs) marked the
 * brand as mentioned.
 */
function uniquePromptRate(responses: ResponseWithPrompt[]) {
  const prompts = new Map<string, boolean>();
  for (const r of responses) {
    const key = r.prompt?.text?.toLowerCase().trim() || '';
    if (!prompts.has(key)) prompts.set(key, false);
    if (r.brandMentioned) prompts.set(key, true);
  }
  const total = prompts.size;
  const mentioned = [...prompts.values()].filter(Boolean).length;
  return { total, mentioned, rate: total > 0 ? (mentioned / total) * 100 : 0 };
}

export async function buildSummary(): Promise<string> {
  const brandName = (await storage.getSetting('brandName')) || 'your brand';
  const allRuns = await storage.getAnalysisRuns();
  const completedRuns = allRuns.filter((r) => r.status === 'complete').sort((a, b) => b.id - a.id);
  const allResponses = await storage.getResponsesWithPrompts();

  // Overall metrics (all completed runs)
  const allRunResponses = allResponses.filter((r) => completedRuns.some((cr) => cr.id === r.analysisRunId));
  const uniqueOverall = uniquePromptRate(allRunResponses);

  // Visibility score: average per-run score
  const runScores: number[] = [];
  for (const run of completedRuns) {
    const runResps = allResponses.filter((r) => r.analysisRunId === run.id);
    if (runResps.length === 0) continue;
    const { score } = computeVisibilityScore(runResps);
    runScores.push(score);
  }
  const overallVisibility = runScores.length > 0 ? runScores.reduce((a, b) => a + b, 0) / runScores.length : 0;

  // Latest run per-model breakdown
  const latestRun = completedRuns[0];
  const latestRunResponses = latestRun ? allResponses.filter((r) => r.analysisRunId === latestRun.id) : [];
  const latestPerModel = perModelRates(latestRunResponses);

  // Per-run trend (newest → oldest)
  const trend = completedRuns.slice(0, 20).map((run) => {
    const rr = allResponses.filter((r) => r.analysisRunId === run.id);
    const { score } = computeVisibilityScore(rr);
    const uniq = uniquePromptRate(rr);
    return {
      runId: run.id,
      date: run.completedAt || run.startedAt,
      uniquePrompts: uniq.total,
      visibilityScore: score,
      uniquePromptRate: uniq.rate,
    };
  });

  // Per-prompt aggregates — match the dashboard's "Worst-Performing Prompts"
  // widget and the /prompts ranking page. Group by prompt id so two prompts
  // with identical text stay separate (they have different ids and may be in
  // different topics).
  type PromptAgg = {
    id: number;
    text: string;
    topicName: string;
    total: number;
    mentions: number;
  };
  const promptAggMap = new Map<number, PromptAgg>();
  for (const r of allRunResponses) {
    const p = r.prompt;
    if (!p) continue;
    if (!promptAggMap.has(p.id)) {
      promptAggMap.set(p.id, {
        id: p.id,
        text: p.text,
        topicName: p.topic?.name || 'Uncategorized',
        total: 0,
        mentions: 0,
      });
    }
    const agg = promptAggMap.get(p.id)!;
    agg.total++;
    if (r.brandMentioned) agg.mentions++;
  }
  const promptsWithRate = [...promptAggMap.values()]
    .filter((p) => p.total > 0)
    .map((p) => ({ ...p, rate: (p.mentions / p.total) * 100 }));
  const worstPrompts = [...promptsWithRate]
    .sort((a, b) => a.rate - b.rate || b.total - a.total)
    .slice(0, 10);
  const bestPrompts = [...promptsWithRate]
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 5);

  // Top competitors by unique-prompt rate across all completed runs
  const competitorCounts = new Map<string, Set<string>>();
  for (const r of allRunResponses) {
    const key = r.prompt?.text?.toLowerCase().trim() || '';
    for (const c of r.competitorsMentioned || []) {
      if (!competitorCounts.has(c)) competitorCounts.set(c, new Set());
      competitorCounts.get(c)!.add(key);
    }
  }
  const topCompetitors = [...competitorCounts.entries()]
    .map(([name, promptSet]) => ({
      name,
      prompts: promptSet.size,
      rate: uniqueOverall.total > 0 ? (promptSet.size / uniqueOverall.total) * 100 : 0,
    }))
    .sort((a, b) => b.prompts - a.prompts)
    .slice(0, 10);

  // Top source domains by citation_count
  const allSources = await storage.getSources();
  const topSources = [...allSources]
    .sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`# Brand Analysis Summary`);
  lines.push('');
  lines.push(`**Brand:** ${brandName}`);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push(`**Completed analysis runs:** ${completedRuns.length}`);
  if (latestRun) {
    lines.push(`**Latest run:** #${latestRun.id} (${(latestRun.completedAt || latestRun.startedAt)?.toISOString() || 'in progress'})`);
  }
  lines.push('');

  lines.push(`## Headline metrics`);
  lines.push('');
  lines.push(`Two valid ways to measure brand mention rate. Both are computed server-side below; prefer these over recomputing from CSVs.`);
  lines.push('');
  lines.push(`### Brand Visibility Score — **${pct(overallVisibility)}**`);
  lines.push('');
  lines.push(`Formula: \`average over runs of [average over models of (per-model unique-prompt mention rate)]\`. **This is the dashboard's headline number.** It penalizes prompts only picked up by some models.`);
  lines.push('');
  lines.push(`### Unique-prompt mention rate — **${pct(uniqueOverall.rate)}** (${uniqueOverall.mentioned} of ${uniqueOverall.total} unique prompts)`);
  lines.push('');
  lines.push(`Formula: \`unique prompts where ANY model mentioned the brand in ANY run / total unique prompts\`. Optimistic measure — answers "do LLMs know about us at all?".`);
  lines.push('');
  lines.push(`**Default:** when a user asks about "brand mention rate" without specifying, cite the Brand Visibility Score (matches the UI). Mention the unique-prompt rate if the user wants the optimistic view.`);
  lines.push('');

  if (latestRun && latestPerModel.length > 0) {
    lines.push(`## Per-model rates — latest run (#${latestRun.id})`);
    lines.push('');
    lines.push(`| Model | Unique prompts | Mentioned | Rate |`);
    lines.push(`|-------|---------------|-----------|------|`);
    for (const m of latestPerModel) {
      lines.push(`| ${m.label} | ${m.total} | ${m.mentioned} | ${pct(m.rate)} |`);
    }
    lines.push('');
  }

  if (trend.length > 0) {
    lines.push(`## Per-run trend`);
    lines.push('');
    lines.push(`Latest ${trend.length} completed runs, newest first.`);
    lines.push('');
    lines.push(`| Run | Date | Unique prompts | Visibility Score | Unique-prompt rate |`);
    lines.push(`|-----|------|----------------|------------------|--------------------|`);
    for (const t of trend) {
      const date = t.date ? new Date(t.date).toISOString().slice(0, 10) : '—';
      lines.push(`| #${t.runId} | ${date} | ${t.uniquePrompts} | ${pct(t.visibilityScore)} | ${pct(t.uniquePromptRate)} |`);
    }
    lines.push('');
  }

  if (worstPrompts.length > 0) {
    lines.push(`## Worst-performing prompts`);
    lines.push('');
    lines.push(`Prompts where your brand is mentioned least often, across all completed runs. Each prompt id is the same id used by \`/prompts/:id\` in the UI and the \`get-prompt-analytics\` MCP tool. Mention rate = brandMentions / totalResponses for that prompt id, NOT deduplicated by text.`);
    lines.push('');
    lines.push(`| # | Prompt id | Topic | Responses | Mentions | Rate |`);
    lines.push(`|---|-----------|-------|-----------|----------|------|`);
    worstPrompts.forEach((p, i) => {
      const text = p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text;
      lines.push(`| ${i + 1} | ${p.id} — "${text.replace(/\|/g, '\\|')}" | ${p.topicName} | ${p.total} | ${p.mentions} | ${pct(p.rate)} |`);
    });
    lines.push('');
  }

  if (bestPrompts.length > 0) {
    lines.push(`## Best-performing prompts`);
    lines.push('');
    lines.push(`| # | Prompt id | Topic | Responses | Mentions | Rate |`);
    lines.push(`|---|-----------|-------|-----------|----------|------|`);
    bestPrompts.forEach((p, i) => {
      const text = p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text;
      lines.push(`| ${i + 1} | ${p.id} — "${text.replace(/\|/g, '\\|')}" | ${p.topicName} | ${p.total} | ${p.mentions} | ${pct(p.rate)} |`);
    });
    lines.push('');
  }

  if (topCompetitors.length > 0) {
    lines.push(`## Top competitors (across all completed runs)`);
    lines.push('');
    lines.push(`Ranked by number of unique prompts where each competitor was mentioned.`);
    lines.push('');
    lines.push(`| # | Competitor | Prompts | Rate |`);
    lines.push(`|---|------------|---------|------|`);
    topCompetitors.forEach((c, i) => {
      lines.push(`| ${i + 1} | ${c.name} | ${c.prompts} | ${pct(c.rate)} |`);
    });
    lines.push('');
  }

  if (topSources.length > 0) {
    lines.push(`## Top source domains`);
    lines.push('');
    lines.push(`Ranked by \`sources.citation_count\` (number of distinct responses that cited the domain).`);
    lines.push('');
    lines.push(`| # | Domain | Responses citing |`);
    lines.push(`|---|--------|------------------|`);
    topSources.forEach((s, i) => {
      lines.push(`| ${i + 1} | ${s.domain} | ${s.citationCount || 0} |`);
    });
    lines.push('');
  }

  lines.push(`---`);
  lines.push('');
  lines.push(`See README.md for the full schema and guidance on how to compute other metrics from the CSVs.`);
  lines.push('');
  return lines.join('\n');
}

export const README = `# TraceAIO Data Export

This archive contains a snapshot of your brand-tracking data exported from TraceAIO.
Each CSV file corresponds to a database table. Use this bundle to analyze your data
with an AI assistant, a spreadsheet tool, or any CSV-capable program.

## READ THIS FIRST: \`summary.md\`

Before doing any analysis, **open \`summary.md\`**. It contains pre-computed
canonical statistics (Brand Visibility Score, unique-prompt mention rate,
per-model breakdown, per-run trend, top competitors, top source domains) that
match exactly what the TraceAIO dashboard shows. Prefer these numbers over
recomputing from the CSVs — rolling your own stats is easy to get wrong
because the schema has multiple related-but-different metrics (see "Counting
guidance" below).

If the user asks something the summary doesn't cover, fall back to the CSVs
using the guidance in this file.

## Files in this archive

| File | Rows described |
|------|----------------|
| summary.md | **Pre-computed canonical stats that match the dashboard. Read first.** |
| topics.csv | Categories/themes grouping prompts. |
| prompts.csv | Brand-neutral questions sent to the LLMs. Each row links to a topic. |
| responses.csv | One row per LLM answer. Each row links to a prompt, an analysis run, and a model. |
| competitors.csv | Competitor brands discovered during analysis, with category and mention counts. |
| sources.csv | Domains cited by the LLMs across all responses, with aggregate citation counts. |
| source_urls.csv | Individual URLs cited per (domain, run, model). Includes a canonical \`normalized_url\`. |
| watched_urls.csv | URLs the user registered in the Source Watchlist to track LLM citations over time. |
| analysis_runs.csv | Each execution of the analysis pipeline. Other tables reference \`analysis_run_id\`. |
| competitor_mentions.csv | Junction table: which competitors appeared in which responses in which runs. |
| analytics.csv | Daily aggregated snapshot metrics (mention rate, top competitor, source counts). |

## Column types and relationships

### topics
- \`id\` (PK)
- \`name\`, \`description\`
- \`deleted\` boolean — soft delete flag
- \`created_at\`

### prompts
- \`id\` (PK)
- \`text\` — the question sent to LLMs
- \`topic_id\` → \`topics.id\` (nullable)
- \`deleted\`, \`created_at\`

### responses
- \`id\` (PK)
- \`prompt_id\` → \`prompts.id\`
- \`analysis_run_id\` → \`analysis_runs.id\`
- \`model\` — e.g. "chatgpt", "perplexity", "gemini"
- \`text\` — full LLM answer
- \`brand_mentioned\` boolean — did this response name the brand?
- \`competitors_mentioned\` — semicolon-joined list of competitor names found in this response
- \`sources\` — semicolon-joined list of raw URLs the LLM cited in this response
- \`created_at\`

### competitors
- \`id\` (PK)
- \`name\`, \`name_key\` (unique, lowercased)
- \`domain\`, \`category\`
- \`mention_count\`, \`last_mentioned\`
- \`merged_into\` → \`competitors.id\` (nullable; when set, this competitor was merged into another)

### sources
- \`id\` (PK)
- \`domain\` (e.g. \`example.com\`)
- \`url\` — one representative URL per domain
- \`citation_count\` — **number of distinct responses that cited this domain.**
  Incremented by 1 each time a response mentions the domain, REGARDLESS of how
  many URLs from that domain were cited in that response. So a response citing
  three pages from \`example.com\` contributes +1 here, not +3.
- \`last_cited\`

### source_urls
Denormalized citation log — one row per (response × URL) pair.

- \`id\` (PK)
- \`source_id\` → \`sources.id\`
- \`analysis_run_id\` → \`analysis_runs.id\` (nullable)
- \`model\`
- \`url\` — raw URL as cited by the LLM
- \`normalized_url\` — canonical form for matching (lowercased host/path, https-coerced, utm_* stripped)
- \`first_seen_at\`

**Row-count semantics** — if a response cites \`example.com/a\` and \`example.com/b\`,
that produces **2** rows in source_urls but only **1** increment on
\`sources.citation_count\`. So \`COUNT(*) FROM source_urls\` filtered to a domain
will usually be ≥ \`sources.citation_count\` for that domain. Neither number
is wrong — they measure different things.

### watched_urls
- \`id\` (PK)
- \`url\`, \`normalized_url\` (unique)
- \`title\`, \`notes\`
- \`added_by_user_id\`, \`added_at\`
- A watched URL is "cited" when its \`normalized_url\` matches any \`source_urls.normalized_url\`.

### analysis_runs
- \`id\` (PK)
- \`started_at\`, \`completed_at\`
- \`status\` — running, complete, error, cancelled
- \`brand_name\`, \`brand_url\`
- \`total_prompts\`, \`completed_prompts\`

### competitor_mentions
- \`id\` (PK)
- \`competitor_id\` → \`competitors.id\`
- \`analysis_run_id\` → \`analysis_runs.id\`
- \`response_id\` → \`responses.id\`
- \`created_at\`

### analytics
- \`id\` (PK)
- \`date\`, \`total_prompts\`, \`brand_mention_rate\`, \`top_competitor\`, \`total_sources\`, \`total_domains\`

## Key relationships at a glance

\`\`\`
topics 1—* prompts 1—* responses
                       |
                       └──* competitor_mentions *──1 competitors
                       └──cites URLs (see responses.sources, source_urls)

analysis_runs 1—* responses
analysis_runs 1—* source_urls
analysis_runs 1—* competitor_mentions

sources 1—* source_urls
watched_urls — matched to source_urls by normalized_url
\`\`\`

## Counting guidance (important)

Read this section before computing any numbers — the schema has several
related counts that measure different things and are easy to confuse.

### Two headline metrics — pick the right one

If \`summary.md\` has the number you need, use it. If not, there are two
valid definitions of "brand mention rate" and they give different answers:

1. **Brand Visibility Score** — \`average over runs of [average over models of
   (per-model unique-prompt mention rate)]\`. This is what the dashboard
   displays. Stricter — a prompt mentioned by only 1 of 4 models contributes
   25% to that run's score, not 100%.

2. **Unique-prompt mention rate** — \`unique prompts where ANY model mentioned
   the brand in ANY run / total unique prompts\`. Optimistic — one model
   picking it up is enough to count the prompt as a hit.

**Default to the Visibility Score** when the user asks about "mention rate"
without qualification — that's the number they see in the UI. The
unique-prompt rate is useful when the user explicitly asks "have any LLMs
ever mentioned us?" or "what's our reach across all models?".

### Unique prompts, not raw responses
Whichever metric you use, **never compute rates as
\`COUNT(responses with brand_mentioned) / COUNT(responses)\`**. That double-counts
each prompt once per model and gives a misleading number. Always deduplicate
by \`prompts.text\` (lowercase, trimmed) first.

### Source / URL counts — use the right one

Three different numbers all describe "how much was this domain cited":

| Question | Correct query |
|----------|--------------|
| How many distinct **pages** from a domain were ever cited? | \`SELECT COUNT(DISTINCT url) FROM source_urls WHERE source_id = X\` |
| How many **responses** cited this domain at all? | \`sources.citation_count\` for that domain (already maintained) |
| How many **URL-level citations** in total? | \`SELECT COUNT(*) FROM source_urls WHERE source_id = X\` |
| How many **runs** have cited this domain? | \`SELECT COUNT(DISTINCT analysis_run_id) FROM source_urls WHERE source_id = X\` |

These numbers will often disagree and that is expected. Example:
- xurrent.com: \`citation_count\` = 226, \`COUNT(*) FROM source_urls\` = 269,
  \`COUNT(DISTINCT url)\` = 32. Meaning: 32 unique pages, cited a total of 269
  times across 226 responses (a few responses cited multiple pages from the
  domain at once). None of these numbers is stale; they measure different
  things.

### Per-prompt mention rate
For "how is the brand doing on prompt X" questions, group \`responses\` by
\`prompt_id\` (NOT by \`prompts.text\` — two prompts with identical text in
different topics are still distinct rows you may want to keep separate). Per
prompt id: \`mentions = COUNT(*) WHERE brand_mentioned\`,
\`total = COUNT(*)\`, \`rate = mentions / total\`. \`summary.md\` already
contains the bottom 10 / top 5 of this list — prefer those numbers.

### Source type (brand / competitor / neutral)
Not stored — it is **derived at query time** by matching \`sources.domain\`
against the brand name and competitor list/domains. When producing counts
by source type, classify each row in your query.

### Merged competitors
Rows with \`merged_into IS NOT NULL\` were deduplicated into the target
competitor. For aggregate counts, follow the merge pointer to the primary
competitor and sum.

### Watched URLs (Source Watchlist)
\`watched_urls\` are pages the user registered to track. A watched URL is
"cited" when its \`normalized_url\` matches any \`source_urls.normalized_url\`.
Use a JOIN on \`normalized_url\` to resolve citations.

Exported at: EXPORT_TIMESTAMP
`;

export function registerExportRoutes(app: Express) {
  app.get("/api/export/bundle", async (req, res: Response) => {
    // #swagger.tags = ['Export']
    try {
      const [
        topicRows,
        promptRows,
        responseRows,
        competitorRows,
        sourceRows,
        sourceUrlRows,
        watchedUrlRows,
        analysisRunRows,
        competitorMentionRows,
        analyticsRows,
        summaryMd,
      ] = await Promise.all([
        db.select().from(topics),
        db.select().from(prompts),
        db.select().from(responses),
        db.select().from(competitors),
        db.select().from(sources),
        db.select().from(sourceUrls),
        db.select().from(watchedUrls),
        db.select().from(analysisRuns),
        db.select().from(competitorMentions),
        db.select().from(analytics),
        buildSummary().catch((err) => {
          console.error("[export] summary generation failed:", err);
          return "# Brand Analysis Summary\n\n(summary generation failed; fall back to CSVs and README.md)\n";
        }),
      ]);

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="traceaio-export-${stamp}.zip"`,
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("warning", (err) => console.warn("[export] archive warning:", err));
      archive.on("error", (err) => {
        console.error("[export] archive error:", err);
        if (!res.headersSent) res.status(500).end();
      });
      archive.pipe(res);

      archive.append(README.replace("EXPORT_TIMESTAMP", new Date().toISOString()), { name: "README.md" });
      archive.append(summaryMd, { name: "summary.md" });
      archive.append(toCsv(topicRows as any[]), { name: "topics.csv" });
      archive.append(toCsv(promptRows as any[]), { name: "prompts.csv" });
      archive.append(toCsv(responseRows as any[]), { name: "responses.csv" });
      archive.append(toCsv(competitorRows as any[]), { name: "competitors.csv" });
      archive.append(toCsv(sourceRows as any[]), { name: "sources.csv" });
      archive.append(toCsv(sourceUrlRows as any[]), { name: "source_urls.csv" });
      archive.append(toCsv(watchedUrlRows as any[]), { name: "watched_urls.csv" });
      archive.append(toCsv(analysisRunRows as any[]), { name: "analysis_runs.csv" });
      archive.append(toCsv(competitorMentionRows as any[]), { name: "competitor_mentions.csv" });
      archive.append(toCsv(analyticsRows as any[]), { name: "analytics.csv" });

      await archive.finalize();
    } catch (error) {
      console.error("Error exporting data bundle:", error);
      if (!res.headersSent) res.status(500).json({ error: "Failed to export data bundle" });
    }
  });
}
