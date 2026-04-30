import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { storage } from './storage';
import { findUserByApiKey } from './services/auth';
import { parseHttpUrl } from './services/analysis';
import { buildSummary, README } from './routes/export';
import { computeVisibilityScore } from './routes/helpers';
import { MODEL_META } from '@shared/models';
import type { Express, Request, Response } from 'express';
import type { ResponseWithPrompt } from '@shared/schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Unique-prompt mention rate over a response set: a prompt counts as
 * mentioned if ANY response (across models, runs) marked the brand mentioned.
 * Use within a single-model slice (where it equals the visibility score) or
 * when the optimistic "any LLM ever mentioned us" view is what you want.
 */
function computeMentionRate(responses: ResponseWithPrompt[]) {
  const promptMap = new Map<string, boolean>();
  for (const r of responses) {
    const key = r.prompt?.text?.toLowerCase().trim() || '';
    if (!promptMap.has(key)) promptMap.set(key, false);
    if (r.brandMentioned) promptMap.set(key, true);
  }
  const total = promptMap.size;
  const mentioned = [...promptMap.values()].filter(Boolean).length;
  const rate = total > 0 ? Math.round((mentioned / total) * 1000) / 10 : 0;
  return { rate, mentioned, total };
}

/**
 * Returns BOTH headline metrics so callers don't have to pick one blind.
 * - visibilityScore: per-model unique-prompt rate, then averaged across
 *   models. Matches the dashboard's headline number.
 * - uniquePromptMentionRate: optimistic — any model in any run counts the
 *   prompt as a hit. Always >= visibilityScore on multi-model data.
 *
 * Use this for any aggregate that spans multiple models. For a single-model
 * slice, the two are equal — `computeMentionRate` is enough.
 */
function computeMentionMetrics(responses: ResponseWithPrompt[]) {
  const { rate: uniquePromptMentionRate, mentioned, total } = computeMentionRate(responses);
  const { score, modelCount } = computeVisibilityScore(responses);
  return {
    visibilityScore: Math.round(score * 10) / 10,
    uniquePromptMentionRate,
    mentionedPrompts: mentioned,
    totalUniquePrompts: total,
    modelCount,
  };
}

/** Build a competitor -> unique prompt count map. */
function competitorPromptCounts(responses: ResponseWithPrompt[]) {
  const map = new Map<string, Set<string>>();
  for (const r of responses) {
    const promptKey = r.prompt?.text?.toLowerCase().trim() || '';
    for (const c of r.competitorsMentioned || []) {
      if (!map.has(c)) map.set(c, new Set());
      map.get(c)!.add(promptKey);
    }
  }
  return map;
}

/**
 * Classify source domain as brand/competitor/neutral.
 *
 * Match grain is a *token* of the domain (split on `.` and `-`) — exact
 * equality, not substring. Substring matching is unsafe because brand names
 * can contain incidental letter runs that match unrelated domains: e.g.
 * "haproxy" contains "ox" as a substring, so the previous substring check
 * flagged ox.security as the brand.
 *
 * Competitor name tokens shorter than 3 chars are dropped to avoid noise
 * matches on common syllables. If a competitor's `domain` is recorded that
 * still hits via direct equality.
 */
async function classifySources() {
  const brandName = ((await storage.getSetting('brandName')) || '').toLowerCase();
  const allCompetitors = (await storage.getAllCompetitorsIncludingMerged()).filter(
    (c) => c.mergedInto !== c.id,
  );
  const competitorDomains = new Set<string>();
  const competitorTokens = new Set<string>();
  for (const c of allCompetitors) {
    if (c.domain) competitorDomains.add(c.domain.toLowerCase());
    for (const w of c.name.toLowerCase().split(/\s+/)) {
      if (w.length >= 3) competitorTokens.add(w);
    }
  }
  return (domain: string): string => {
    const dl = domain.toLowerCase();
    const tokens = dl.split(/[.\-]/).filter(Boolean);
    if (brandName && tokens.includes(brandName)) return 'brand';
    if (competitorDomains.has(dl)) return 'competitor';
    if (tokens.some((t) => competitorTokens.has(t))) return 'competitor';
    return 'neutral';
  };
}

/** Filter responses by optional model. */
function filterByModel(responses: ResponseWithPrompt[], model?: string) {
  if (!model) return responses;
  return responses.filter((r) => r.model === model);
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

/**
 * Build the same guidance bundle as the "Chat with AI -> Export" feature
 * (summary.md + README.md), and surface it as MCP server instructions.
 *
 * Per the MCP spec (and https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/),
 * the `instructions` field is sent in the InitializeResult and lets the calling
 * model pick the right counting metric, understand schema relationships, and
 * see current brand stats without making a tool call first.
 */
async function buildMcpInstructions(): Promise<string> {
  const summary = await buildSummary().catch((err) => {
    console.error('[MCP] summary generation failed:', err);
    return '# Brand Analysis Summary\n\n(summary generation failed; query tools directly to inspect current data)\n';
  });
  const readme = README.replace('EXPORT_TIMESTAMP', new Date().toISOString());
  return `${summary}\n\n---\n\n${readme}`;
}

async function createMcpServer(): Promise<McpServer> {
  const instructions = await buildMcpInstructions();
  const server = new McpServer(
    {
      name: 'traceaio',
      version: '1.0.0',
    },
    { instructions },
  );

  // =========================================================================
  // 1. QUICK OVERVIEW
  // =========================================================================

  // ---- brand-snapshot ----
  server.tool(
    'brand-snapshot',
    'Quick brand health check. Returns BOTH headline metrics: visibilityScore (per-model unique-prompt rate averaged across models — matches the dashboard) and uniquePromptMentionRate (any model in any run counts the prompt — optimistic). Default to visibilityScore when the user asks "how am I doing?" without specifying. Use brand-audit for per-topic / per-model breakdowns.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
    },
    async ({ runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const metrics = computeMentionMetrics(responses);

      const compCounts = competitorPromptCounts(responses);
      const topComp = [...compCounts.entries()].sort(
        (a, b) => b[1].size - a[1].size,
      )[0];

      const sources = await storage.getSources();

      return textResult({
        ...metrics,
        topCompetitor: topComp
          ? { name: topComp[0], promptCount: topComp[1].size }
          : null,
        totalSourceDomains: sources.length,
        totalResponses: responses.length,
        filters: { model: model || 'all', runId: runId || 'all' },
      });
    },
  );

  // ---- brand-audit ----
  server.tool(
    'brand-audit',
    'Comprehensive brand assessment. Top-level returns BOTH headline metrics (visibilityScore = dashboard-aligned per-model average; uniquePromptMentionRate = optimistic any-model-any-run). Per-model rates are unambiguous (one model => visibility = unique-prompt rate). Per-topic returns BOTH metrics so per-model gaps within a topic are visible. Also returns top competitors, top sources, and the gap list of prompts where brand is NOT mentioned. Do NOT use for a single quick number — use brand-snapshot instead.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
    },
    async ({ runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const metrics = computeMentionMetrics(responses);

      // Per-model breakdown — within a single model, visibility == unique-prompt rate.
      const modelGroups = new Map<string, ResponseWithPrompt[]>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelGroups.has(p)) modelGroups.set(p, []);
        modelGroups.get(p)!.push(r);
      }
      const modelRates = [...modelGroups.entries()].map(([name, resps]) => {
        const m = computeMentionRate(resps);
        return {
          model: name,
          label: MODEL_META[name]?.label || name,
          mentionRate: m.rate,
          mentioned: m.mentioned,
          total: m.total,
        };
      });

      // Per-topic breakdown — topics span models so we return both metrics.
      const topicGroups = new Map<string, { id: number; responses: ResponseWithPrompt[] }>();
      for (const r of responses) {
        const tName = r.prompt?.topic?.name || 'Uncategorized';
        const tId = r.prompt?.topic?.id || 0;
        if (!topicGroups.has(tName)) topicGroups.set(tName, { id: tId, responses: [] });
        topicGroups.get(tName)!.responses.push(r);
      }
      const topicRates = [...topicGroups.entries()].map(([name, { id, responses: resps }]) => {
        const m = computeMentionMetrics(resps);
        return {
          topicId: id,
          topicName: name,
          visibilityScore: m.visibilityScore,
          uniquePromptMentionRate: m.uniquePromptMentionRate,
          mentioned: m.mentionedPrompts,
          total: m.totalUniquePrompts,
        };
      });

      // Top 5 competitors
      const compCounts = competitorPromptCounts(responses);
      const topCompetitors = [...compCounts.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 5)
        .map(([name, promptSet]) => ({
          name,
          promptCount: promptSet.size,
          rate: metrics.totalUniquePrompts > 0
            ? Math.round((promptSet.size / metrics.totalUniquePrompts) * 1000) / 10
            : 0,
        }));

      // Top 5 sources
      const sources = await storage.getSources();
      const classify = await classifySources();
      const sourceSummary = sources
        .map((s) => ({
          domain: s.domain,
          citationCount: s.citationCount || 0,
          sourceType: classify(s.domain),
        }))
        .sort((a, b) => b.citationCount - a.citationCount)
        .slice(0, 5);

      // Gap list: prompts where brand is NOT mentioned
      const promptMentionMap = new Map<string, { brandMentioned: boolean; models: string[]; topicName: string }>();
      for (const r of responses) {
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMentionMap.has(key)) {
          promptMentionMap.set(key, {
            brandMentioned: false,
            models: [],
            topicName: r.prompt?.topic?.name || 'Uncategorized',
          });
        }
        const entry = promptMentionMap.get(key)!;
        if (r.brandMentioned) entry.brandMentioned = true;
        if (r.model && !entry.models.includes(r.model)) entry.models.push(r.model);
      }
      const gapPrompts = [...promptMentionMap.entries()]
        .filter(([, v]) => !v.brandMentioned)
        .map(([text, v]) => ({ promptText: text, models: v.models, topicName: v.topicName }));

      return textResult({
        ...metrics,
        totalResponses: responses.length,
        modelBreakdown: modelRates,
        topicBreakdown: topicRates,
        topCompetitors,
        topSources: sourceSummary,
        gapPrompts,
        filters: { model: model || 'all', runId: runId || 'all' },
      });
    },
  );

  // =========================================================================
  // 2. LIST / BROWSE
  // =========================================================================

  // ---- list-models ----
  server.tool(
    'list-models',
    'Per-model unique-prompt mention rate. Within a single model the rate is unambiguous — visibility score and unique-prompt rate are equal. mentionRate = unique prompts mentioning the brand in this model / unique prompts seen by this model. Use when asked "which model mentions us most?". Do NOT use for full side-by-side diff — use compare-models instead.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
    },
    async ({ runId }) => {
      const responses = await storage.getResponsesWithPrompts(runId);

      const modelGroups = new Map<string, ResponseWithPrompt[]>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelGroups.has(p)) modelGroups.set(p, []);
        modelGroups.get(p)!.push(r);
      }

      const result = [...modelGroups.entries()].map(([name, resps]) => {
        const m = computeMentionRate(resps);
        return {
          model: name,
          label: MODEL_META[name]?.label || name,
          mentionRate: m.rate,
          mentionedCount: m.mentioned,
          totalPrompts: m.total,
        };
      });

      return textResult(result);
    },
  );

  // ---- list-competitors ----
  server.tool(
    'list-competitors',
    'Ranked list of competitors by share-of-voice. mentionRate here is "% of unique prompts where this competitor was mentioned by ANY model" — a *competitor* metric, not the brand visibility score. Returns name, category, mention rate, mention count, total prompts. Use for "who are my competitors?" or "show competitor ranking". Do NOT use for a single competitor deep dive — use get-competitor instead.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
    },
    async ({ runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const { total } = computeMentionRate(responses);
      const compCounts = competitorPromptCounts(responses);
      const competitors = await storage.getCompetitors();
      const compMap = new Map(competitors.map((c) => [c.name.toLowerCase(), c]));

      const result = [...compCounts.entries()]
        .map(([name, promptSet]) => {
          const comp = compMap.get(name.toLowerCase());
          return {
            name,
            category: comp?.category || null,
            mentionRate: total > 0 ? Math.round((promptSet.size / total) * 1000) / 10 : 0,
            mentionCount: promptSet.size,
            totalPrompts: total,
          };
        })
        .sort((a, b) => b.mentionCount - a.mentionCount);

      return textResult(result);
    },
  );

  // ---- list-topics ----
  server.tool(
    'list-topics',
    'Topic-level breakdown returning BOTH headline metrics per topic: visibilityScore (per-model average within the topic — matches how the dashboard reads) and uniquePromptMentionRate (any-model-any-run within the topic — optimistic). The two diverge whenever some models mention the brand but others don\'t for the same prompt. Use for "which topics mention us?". Do NOT use for response-level data — use search-prompts.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api). Filtering to a single model collapses both metrics to the same number.'),
    },
    async ({ runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const topicGroups = new Map<
        string,
        { id: number; responses: ResponseWithPrompt[] }
      >();
      for (const r of responses) {
        const tName = r.prompt?.topic?.name || 'Uncategorized';
        const tId = r.prompt?.topic?.id || 0;
        if (!topicGroups.has(tName))
          topicGroups.set(tName, { id: tId, responses: [] });
        topicGroups.get(tName)!.responses.push(r);
      }

      const result = [...topicGroups.entries()].map(
        ([name, { id, responses: resps }]) => {
          const m = computeMentionMetrics(resps);
          return {
            topicId: id,
            topicName: name,
            visibilityScore: m.visibilityScore,
            uniquePromptMentionRate: m.uniquePromptMentionRate,
            totalPrompts: m.totalUniquePrompts,
            brandMentions: m.mentionedPrompts,
            modelCount: m.modelCount,
          };
        },
      );

      return textResult(result);
    },
  );

  // ---- list-sources ----
  server.tool(
    'list-sources',
    'Top source domains with citation counts and type classification (brand/competitor/neutral). Use for "what sources are cited?" or "show source breakdown". Do NOT use for a single source deep dive — use get-source instead.',
    {
      sourceType: z
        .string()
        .optional()
        .describe('Filter by source type: brand, competitor, or neutral'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
    },
    async ({ sourceType, runId, model }) => {
      const allSources = await storage.getSources();
      const classify = await classifySources();

      const result = await Promise.all(
        allSources.map(async (source) => {
          const urls = await storage.getSourceUrlsBySourceId(
            source.id,
            runId,
            model,
          );
          const type = classify(source.domain);
          if (sourceType && type !== sourceType) return null;
          return {
            domain: source.domain,
            sourceType: type,
            citationCount: urls.length || source.citationCount || 0,
            urlCount: urls.length,
          };
        }),
      );

      const filtered = result
        .filter(Boolean)
        .sort((a: any, b: any) => b.citationCount - a.citationCount);

      return textResult(filtered);
    },
  );

  // ---- list-pages ----
  server.tool(
    'list-pages',
    'Top individual page URLs cited across LLM responses, with citation counts and source classification (brand/competitor/neutral). Mirrors the "By Page" tab on the Sources screen — use this when the user asks about specific pages or articles being cited (e.g. "which of my blog posts are cited?", "what URLs do LLMs cite most?", "show me top cited pages"). Use list-sources instead for domain-level breakdown. Paginated; use the page argument to step through results.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, openai-api, anthropic-api)'),
      topicId: z.number().optional().describe('Filter by topic ID'),
      sourceType: z
        .string()
        .optional()
        .describe('Filter by source type: brand, competitor, or neutral'),
      page: z.number().optional().describe('1-based page number (default 1)'),
      pageSize: z.number().optional().describe('Results per page (default 50, max 200)'),
    },
    async ({ runId, model, topicId, sourceType, page, pageSize }) => {
      const pageNum = Math.max(1, page || 1);
      const ps = Math.min(200, Math.max(1, pageSize || 50));

      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);
      if (topicId !== undefined) responses = responses.filter((r) => r.prompt?.topicId === topicId);

      const counts = new Map<string, { url: string; domain: string; count: number }>();
      for (const r of responses) {
        if (!r.sources || r.sources.length === 0) continue;
        const seen = new Set<string>();
        for (const raw of r.sources) {
          if (typeof raw !== 'string') continue;
          const parsed = parseHttpUrl(raw);
          if (!parsed) continue;
          const url = raw.trim();
          if (seen.has(url)) continue;
          seen.add(url);
          const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
          const existing = counts.get(url);
          if (existing) existing.count++;
          else counts.set(url, { url, domain, count: 1 });
        }
      }

      const classify = await classifySources();
      let all = Array.from(counts.values()).map((p) => ({
        url: p.url,
        domain: p.domain,
        sourceType: classify(p.domain),
        citationCount: p.count,
      }));
      if (sourceType) all = all.filter((p) => p.sourceType === sourceType);
      all.sort((a, b) => b.citationCount - a.citationCount);

      const total = all.length;
      const start = (pageNum - 1) * ps;
      const rows = all.slice(start, start + ps);
      return textResult({ rows, page: pageNum, pageSize: ps, total });
    },
  );

  // ---- list-watched-urls ----
  server.tool(
    'list-watched-urls',
    'List URLs on the Source Watchlist (content the user is tracking to see when LLMs start citing it). Returns each URL with citation count, first-cited run, per-model citation counts, and the full list of citations (responseId, runId, model, citedAt, promptText, brandMentioned). Use for "has anyone cited my blog post?", "which of my pages are being cited?", "show my watchlist status". Use the sinceRunId arg for "what got newly cited since run X?" — it returns only URLs first cited in a run AFTER sinceRunId. Do NOT use for discovered third-party sources — use list-sources instead.',
    {
      runId: z.number().optional().describe('Filter citations by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter citations by model (perplexity, chatgpt, gemini)'),
      onlyCited: z
        .boolean()
        .optional()
        .describe('If true, omit watched URLs that have zero citations'),
      sinceRunId: z
        .number()
        .optional()
        .describe('If set, only return watched URLs first cited in runs with id > sinceRunId. Use for post-run polling to discover newly cited URLs.'),
    },
    async ({ runId, model, onlyCited, sinceRunId }) => {
      let results = await storage.getWatchedUrlsWithCitations({ runId, model });
      if (sinceRunId !== undefined) {
        results = results.filter((r) => r.firstCitedRunId !== null && r.firstCitedRunId > sinceRunId);
      }
      if (onlyCited) results = results.filter((r) => r.citationCount > 0);
      return textResult(
        results.map((r) => ({
          id: r.id,
          url: r.url,
          title: r.title,
          notes: r.notes,
          addedAt: r.addedAt,
          citationCount: r.citationCount,
          firstCitedAt: r.firstCitedAt,
          firstCitedRunId: r.firstCitedRunId,
          citationsByModel: r.citationsByModel,
          citations: r.citations,
        })),
      );
    },
  );

  // ---- list-runs ----
  server.tool(
    'list-runs',
    'List all analysis runs with status and progress. NOTE: totalPrompts and completedPrompts count *jobs* (prompts × models), NOT unique prompts — completedPrompts also INCLUDES failures, so a low ratio of stored responses to completedPrompts means the run had many failed jobs. Use get-run for response counts, unique-prompt counts, and per-model coverage. Use for "show analysis history" or "what runs have been done?".',
    {},
    async () => {
      const runs = await storage.getAnalysisRuns();
      const result = runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        status: r.status,
        brandName: r.brandName,
        totalJobs: r.totalPrompts,
        completedJobs: r.completedPrompts,
        // Legacy aliases — kept for backward compat. Prefer totalJobs/completedJobs.
        totalPrompts: r.totalPrompts,
        completedPrompts: r.completedPrompts,
      }));
      return textResult(result);
    },
  );

  // ---- list-prompts-ranked ----
  server.tool(
    'list-prompts-ranked',
    'Rank every prompt by brand mention rate. Use to find weak spots ("which prompts ignore us?") or strong points ("which prompts always mention us?"). Each row keys by promptId so you can hand the id straight to get-prompt-analytics. Per-model breakdown is included. Default sort is descending; pass sort:"asc" for the worst-performing first.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
      topicId: z.number().optional().describe('Filter by topic id'),
      sort: z.enum(['asc', 'desc']).optional().describe('Sort by mentionRate (default: desc)'),
      limit: z.number().int().positive().optional().describe('Max rows (omit for all)'),
    },
    async ({ runId, model, topicId, sort, limit }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);
      if (topicId !== undefined) {
        responses = responses.filter((r) => r.prompt?.topicId === topicId);
      }

      type Bucket = {
        id: number;
        text: string;
        topicId: number | null;
        topicName: string;
        totalResponses: number;
        brandMentions: number;
        byModel: Map<string, { total: number; mentioned: number }>;
      };
      const map = new Map<number, Bucket>();
      for (const r of responses) {
        if (!r.prompt) continue;
        const id = r.prompt.id;
        if (!map.has(id)) {
          map.set(id, {
            id,
            text: r.prompt.text,
            topicId: r.prompt.topicId ?? null,
            topicName: r.prompt.topic?.name || 'Uncategorized',
            totalResponses: 0,
            brandMentions: 0,
            byModel: new Map(),
          });
        }
        const b = map.get(id)!;
        b.totalResponses++;
        if (r.brandMentioned) b.brandMentions++;
        const mdl = r.model || 'unknown';
        if (!b.byModel.has(mdl)) b.byModel.set(mdl, { total: 0, mentioned: 0 });
        const pm = b.byModel.get(mdl)!;
        pm.total++;
        if (r.brandMentioned) pm.mentioned++;
      }

      const rows = [...map.values()].map((b) => ({
        promptId: b.id,
        text: b.text,
        topicId: b.topicId,
        topicName: b.topicName,
        totalResponses: b.totalResponses,
        brandMentions: b.brandMentions,
        mentionRate:
          b.totalResponses > 0
            ? Math.round((b.brandMentions / b.totalResponses) * 1000) / 10
            : 0,
        byModel: [...b.byModel.entries()].map(([mdl, pm]) => ({
          model: mdl,
          label: MODEL_META[mdl]?.label || mdl,
          total: pm.total,
          mentioned: pm.mentioned,
          rate: pm.total > 0 ? Math.round((pm.mentioned / pm.total) * 1000) / 10 : 0,
        })),
      }));

      const dir = sort === 'asc' ? 1 : -1;
      rows.sort((a, b) => (a.mentionRate - b.mentionRate) * dir || a.promptId - b.promptId);

      return textResult({
        total: rows.length,
        prompts: limit ? rows.slice(0, limit) : rows,
        filters: { runId: runId || 'all', model: model || 'all', topicId: topicId || 'all' },
      });
    },
  );

  // =========================================================================
  // 3. DETAIL / DRILL-DOWN
  // =========================================================================

  // ---- get-prompt-analytics ----
  server.tool(
    'get-prompt-analytics',
    'Per-prompt drill-down. Returns the prompt text, totals, per-model rates, run-by-run trend, top competitors that appeared alongside it, and top cited domains. Use for "how is my brand doing on prompt X?" or "which models miss prompt X?". Pair with list-prompts-ranked to find candidates first.',
    {
      promptId: z.number().describe('Prompt id (from list-prompts-ranked or search-prompts)'),
      runId: z.number().optional().describe('Filter to a single run'),
    },
    async ({ promptId, runId }) => {
      const prompt = await storage.getPromptById(promptId);
      if (!prompt) {
        return textResult({ error: 'Prompt not found', promptId });
      }
      const topic = prompt.topicId ? await storage.getTopicById(prompt.topicId) : null;

      const all = await storage.getResponsesWithPrompts(runId);
      const responses = all.filter((r) => r.promptId === promptId);

      const tallies = new Map<string, { total: number; mentioned: number }>();
      for (const r of responses) {
        const mdl = r.model || 'unknown';
        if (!tallies.has(mdl)) tallies.set(mdl, { total: 0, mentioned: 0 });
        const pm = tallies.get(mdl)!;
        pm.total++;
        if (r.brandMentioned) pm.mentioned++;
      }
      const byModel = [...tallies.entries()]
        .map(([mdl, pm]) => ({
          model: mdl,
          label: MODEL_META[mdl]?.label || mdl,
          total: pm.total,
          mentioned: pm.mentioned,
          rate: pm.total > 0 ? Math.round((pm.mentioned / pm.total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.rate - a.rate);

      const runIds = new Set<number>();
      for (const r of responses) {
        if (r.analysisRunId != null) runIds.add(r.analysisRunId);
      }
      const totalsResponses = responses.length;
      const totalsMentions = responses.filter((r) => r.brandMentioned).length;
      const totals = {
        runs: runIds.size,
        responses: totalsResponses,
        brandMentions: totalsMentions,
        brandMentionRate:
          totalsResponses > 0
            ? Math.round((totalsMentions / totalsResponses) * 1000) / 10
            : 0,
      };

      const allRuns = await storage.getAnalysisRuns();
      const runMeta = new Map<number, { startedAt: Date | null }>();
      for (const run of allRuns) {
        runMeta.set(run.id, { startedAt: run.startedAt });
      }
      const trendMap = new Map<
        number,
        { runId: number; runStartedAt: Date | null; perModel: Record<string, number>; anyMentioned: boolean }
      >();
      for (const r of responses) {
        const rid = r.analysisRunId;
        if (rid == null) continue;
        if (!trendMap.has(rid)) {
          trendMap.set(rid, {
            runId: rid,
            runStartedAt: runMeta.get(rid)?.startedAt || null,
            perModel: {},
            anyMentioned: false,
          });
        }
        const t = trendMap.get(rid)!;
        const mdl = r.model || 'unknown';
        t.perModel[mdl] = r.brandMentioned ? 1 : (t.perModel[mdl] || 0);
        if (r.brandMentioned) t.anyMentioned = true;
      }
      const trend = [...trendMap.values()].sort(
        (a, b) => (a.runStartedAt?.getTime() ?? 0) - (b.runStartedAt?.getTime() ?? 0),
      );

      // Top competitors that co-appear with this prompt — resolve to ids so
      // the caller can pass them to get-competitor. Skip blocked
      // (self-merged) records and route merged-out names to their canonical.
      const allCompetitors = await storage.getAllCompetitorsIncludingMerged();
      const canonicalById = new Map<number, { id: number; name: string }>();
      for (const c of allCompetitors) {
        if (c.mergedInto != null) continue;
        canonicalById.set(c.id, { id: c.id, name: c.name });
      }
      const competitorByName = new Map<string, { id: number; name: string }>();
      for (const c of allCompetitors) {
        if (c.mergedInto === c.id) continue;
        const target = c.mergedInto != null
          ? canonicalById.get(c.mergedInto)
          : { id: c.id, name: c.name };
        if (!target) continue;
        competitorByName.set(c.name.toLowerCase(), target);
      }
      const competitorCounts = new Map<number, { id: number; name: string; count: number }>();
      for (const r of responses) {
        const seen = new Set<number>();
        for (const raw of r.competitorsMentioned || []) {
          const match = competitorByName.get((raw || '').trim().toLowerCase());
          if (!match) continue;
          if (seen.has(match.id)) continue;
          seen.add(match.id);
          const entry = competitorCounts.get(match.id) || {
            id: match.id,
            name: match.name,
            count: 0,
          };
          entry.count++;
          competitorCounts.set(match.id, entry);
        }
      }
      const topCompetitors = [...competitorCounts.values()]
        .map((c) => ({
          competitorId: c.id,
          name: c.name,
          count: c.count,
          rate:
            totalsResponses > 0
              ? Math.round((c.count / totalsResponses) * 1000) / 10
              : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Top cited domains for this prompt — same dedupe-per-response logic.
      const sourceCounts = new Map<string, number>();
      for (const r of responses) {
        if (!r.sources) continue;
        const seen = new Set<string>();
        for (const raw of r.sources) {
          const parsed = parseHttpUrl(raw);
          if (!parsed) continue;
          const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
          if (seen.has(domain)) continue;
          seen.add(domain);
          sourceCounts.set(domain, (sourceCounts.get(domain) || 0) + 1);
        }
      }
      const allSourceRows = await storage.getSources();
      const sourceByDomain = new Map<string, { id: number }>();
      for (const s of allSourceRows) {
        sourceByDomain.set(s.domain.toLowerCase(), { id: s.id });
      }
      const classify = await classifySources();
      const topSources = [...sourceCounts.entries()]
        .map(([domain, count]) => ({
          sourceId: sourceByDomain.get(domain)?.id ?? null,
          domain,
          count,
          classification: classify(domain),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return textResult({
        prompt: {
          id: prompt.id,
          text: prompt.text,
          topicId: prompt.topicId,
          topicName: topic?.name || 'Uncategorized',
        },
        totals,
        byModel,
        trend,
        topCompetitors,
        topSources,
        filters: { runId: runId || 'all' },
      });
    },
  );

  // ---- get-competitor ----
  server.tool(
    'get-competitor',
    'Deep dive into a single competitor. Returns name, category, mentionRate ("% of unique prompts where this competitor appears in ANY response", a competitor metric — not the brand visibility score), and the list of prompts where they appeared with brand mention status. Use for "tell me about [competitor]". Do NOT use for ranking all competitors — use list-competitors instead.',
    {
      name: z.string().describe('Competitor name (case-insensitive)'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
    },
    async ({ name, runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const nameLower = name.toLowerCase();
      const matching = responses.filter((r) =>
        (r.competitorsMentioned || []).some(
          (c) => c.toLowerCase() === nameLower,
        ),
      );

      const { total } = computeMentionRate(responses);
      const uniquePrompts = new Set(
        matching.map((r) => r.prompt?.text?.toLowerCase().trim() || ''),
      );

      const competitors = await storage.getCompetitors();
      const comp = competitors.find(
        (c) => c.name.toLowerCase() === nameLower,
      );

      const prompts = matching.map((r) => ({
        promptText: r.prompt?.text || '',
        brandMentioned: !!r.brandMentioned,
        model: r.model,
        topicName: r.prompt?.topic?.name || 'Uncategorized',
      }));

      return textResult({
        name: comp?.name || name,
        category: comp?.category || null,
        mentionRate:
          total > 0
            ? Math.round((uniquePrompts.size / total) * 1000) / 10
            : 0,
        promptsAppeared: uniquePrompts.size,
        totalPrompts: total,
        prompts,
      });
    },
  );

  // ---- get-source ----
  server.tool(
    'get-source',
    'Deep dive into a single source domain. Returns domain, citation count, source type, URLs, and responses that cite this domain. Use for "tell me about [domain]". Do NOT use for listing all sources — use list-sources instead.',
    {
      domain: z.string().describe('Source domain (e.g. example.com)'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
    },
    async ({ domain, runId, model }) => {
      const source = await storage.getSourceByDomain(domain);
      if (!source) {
        return textResult({ error: `Source domain "${domain}" not found` });
      }

      const urls = await storage.getSourceUrlsBySourceId(
        source.id,
        runId,
        model,
      );
      const classify = await classifySources();

      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);
      const matching = responses.filter((r) =>
        r.text.toLowerCase().includes(domain.toLowerCase()),
      );

      return textResult({
        domain: source.domain,
        citationCount: urls.length || source.citationCount || 0,
        sourceType: classify(source.domain),
        urls,
        responses: matching.map((r) => ({
          promptText: r.prompt?.text || '',
          brandMentioned: !!r.brandMentioned,
          model: r.model,
        })),
      });
    },
  );

  // ---- get-response ----
  server.tool(
    'get-response',
    'Get a single full response by ID, including prompt text, model, brand mention status, response text, competitors, and sources. Use when you have a specific response ID to inspect.',
    {
      id: z.number().describe('Response ID'),
    },
    async ({ id }) => {
      const response = await storage.getResponseById(id);
      if (!response) {
        return textResult({ error: `Response with ID ${id} not found` });
      }

      const prompt = await storage.getPromptById(response.promptId);
      let topic = null;
      if (prompt?.topicId) {
        topic = await storage.getTopicById(prompt.topicId);
      }

      return textResult({
        id: response.id,
        promptText: prompt?.text || '',
        topicName: topic?.name || null,
        model: response.model,
        brandMentioned: !!response.brandMentioned,
        responseText: response.text,
        competitorsMentioned: response.competitorsMentioned || [],
        sources: response.sources || [],
        createdAt: response.createdAt,
      });
    },
  );

  // =========================================================================
  // 4. SEARCH / FIND
  // =========================================================================

  // ---- search-prompts ----
  server.tool(
    'search-prompts',
    'Search prompt and response text by keyword. Supports filtering by mention status, model, and topic. Returns matching prompts with brand mention status and competitor info. Use for "find prompts about [topic]" or "which prompts mention [keyword]?". Do NOT use for a structured topic breakdown — use list-topics instead.',
    {
      query: z
        .string()
        .optional()
        .describe('Text to search for in prompt or response text'),
      brandMentioned: z
        .boolean()
        .optional()
        .describe('Filter by brand mention status'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
      topicName: z
        .string()
        .optional()
        .describe('Filter by topic name (case-insensitive)'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
    },
    async ({ query, brandMentioned, model, topicName, runId }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      if (query) {
        const q = query.toLowerCase();
        responses = responses.filter(
          (r) =>
            (r.prompt?.text || '').toLowerCase().includes(q) ||
            r.text.toLowerCase().includes(q),
        );
      }

      if (brandMentioned !== undefined) {
        responses = responses.filter(
          (r) => !!r.brandMentioned === brandMentioned,
        );
      }

      if (topicName) {
        const tn = topicName.toLowerCase();
        responses = responses.filter(
          (r) =>
            (r.prompt?.topic?.name || '').toLowerCase().includes(tn),
        );
      }

      const result = responses.map((r) => ({
        responseId: r.id,
        promptId: r.prompt?.id ?? null,
        promptText: r.prompt?.text || '',
        model: r.model,
        brandMentioned: !!r.brandMentioned,
        competitorsMentioned: r.competitorsMentioned || [],
        topicName: r.prompt?.topic?.name || 'Uncategorized',
        responsePreview: r.text.slice(0, 200) + (r.text.length > 200 ? '...' : ''),
      }));

      return textResult(result);
    },
  );

  // ---- find-unmentioned ----
  server.tool(
    'find-unmentioned',
    'Find prompts where the brand is NOT mentioned. Groups by unique prompt text. Returns prompt text, models that answered, topic name, and competitors that were mentioned instead. Use for "where are we missing?" or "show gaps in brand visibility".',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
    },
    async ({ runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      // Group by unique prompt, keeping only those where brand was NOT mentioned
      const promptMap = new Map<
        string,
        {
          brandEverMentioned: boolean;
          models: Set<string>;
          topicName: string;
          competitors: Set<string>;
        }
      >();

      for (const r of responses) {
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMap.has(key)) {
          promptMap.set(key, {
            brandEverMentioned: false,
            models: new Set(),
            topicName: r.prompt?.topic?.name || 'Uncategorized',
            competitors: new Set(),
          });
        }
        const entry = promptMap.get(key)!;
        if (r.brandMentioned) entry.brandEverMentioned = true;
        if (r.model) entry.models.add(r.model);
        for (const c of r.competitorsMentioned || []) entry.competitors.add(c);
      }

      const result = [...promptMap.entries()]
        .filter(([, v]) => !v.brandEverMentioned)
        .map(([text, v]) => ({
          promptText: text,
          models: [...v.models],
          topicName: v.topicName,
          competitorsMentioned: [...v.competitors],
        }));

      return textResult(result);
    },
  );

  // =========================================================================
  // 5. COMPARE
  // =========================================================================

  // ---- compare-models ----
  server.tool(
    'compare-models',
    'Side-by-side comparison of models. Each model\'s rate is its per-model unique-prompt mention rate (unambiguous within a model — visibility = unique-prompt rate). Also returns a diff of which prompts are mentioned by which model. Use for "compare models" or "which model is best for us?". Do NOT use for a single model summary — use list-models.',
    {
      runId: z.number().optional().describe('Filter by analysis run ID'),
    },
    async ({ runId }) => {
      const responses = await storage.getResponsesWithPrompts(runId);

      // Per-model prompt mention maps
      const modelPromptMaps = new Map<string, Map<string, boolean>>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelPromptMaps.has(p))
          modelPromptMaps.set(p, new Map());
        const pMap = modelPromptMaps.get(p)!;
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!pMap.has(key)) pMap.set(key, false);
        if (r.brandMentioned) pMap.set(key, true);
      }

      const models = [...modelPromptMaps.entries()].map(
        ([name, pMap]) => {
          const total = pMap.size;
          const mentioned = [...pMap.values()].filter(Boolean).length;
          return {
            name,
            label: MODEL_META[name]?.label || name,
            rate:
              total > 0
                ? Math.round((mentioned / total) * 1000) / 10
                : 0,
            mentioned,
            total,
          };
        },
      );

      // Prompt differences: for each unique prompt, show which models mention brand
      const allPrompts = new Set<string>();
      for (const [, pMap] of modelPromptMaps) {
        for (const key of pMap.keys()) allPrompts.add(key);
      }

      const promptDifferences = [...allPrompts].map((promptText) => {
        const modelResults: Record<string, boolean> = {};
        for (const [pName, pMap] of modelPromptMaps) {
          modelResults[pName] = pMap.get(promptText) || false;
        }
        return { promptText, modelResults };
      });

      // Only include prompts where models disagree
      const disagreements = promptDifferences.filter((d) => {
        const vals = Object.values(d.modelResults);
        return vals.some((v) => v) && vals.some((v) => !v);
      });

      return textResult({
        models,
        promptDifferences: disagreements,
      });
    },
  );

  // ---- compare-competitor ----
  server.tool(
    'compare-competitor',
    'Brand vs. a specific competitor. brandRate and competitorRate are unique-prompt rates (any model in any run counts a hit) — NOT the dashboard\'s visibility score. Use brand-snapshot if you need the dashboard-aligned visibility score. Returns the both/only-brand/only-competitor/neither breakdown. Use for "how do we compare to [competitor]?". Do NOT use for ranking all competitors — use list-competitors.',
    {
      competitor: z.string().describe('Competitor name to compare against'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini, google-aimode, openai-api, anthropic-api)'),
    },
    async ({ competitor, runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const compLower = competitor.toLowerCase();

      // Build per-prompt data
      const promptData = new Map<
        string,
        { brandMentioned: boolean; competitorMentioned: boolean }
      >();

      for (const r of responses) {
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptData.has(key))
          promptData.set(key, {
            brandMentioned: false,
            competitorMentioned: false,
          });
        const entry = promptData.get(key)!;
        if (r.brandMentioned) entry.brandMentioned = true;
        if (
          (r.competitorsMentioned || []).some(
            (c) => c.toLowerCase() === compLower,
          )
        )
          entry.competitorMentioned = true;
      }

      let bothMentioned = 0;
      let onlyBrand = 0;
      let onlyCompetitor = 0;
      let neitherMentioned = 0;
      const prompts: {
        promptText: string;
        brandMentioned: boolean;
        competitorMentioned: boolean;
      }[] = [];

      for (const [text, data] of promptData) {
        prompts.push({
          promptText: text,
          brandMentioned: data.brandMentioned,
          competitorMentioned: data.competitorMentioned,
        });
        if (data.brandMentioned && data.competitorMentioned) bothMentioned++;
        else if (data.brandMentioned) onlyBrand++;
        else if (data.competitorMentioned) onlyCompetitor++;
        else neitherMentioned++;
      }

      const total = promptData.size;

      return textResult({
        competitor,
        brandRate:
          total > 0
            ? Math.round(
                (((bothMentioned + onlyBrand) / total) * 1000),
              ) / 10
            : 0,
        competitorRate:
          total > 0
            ? Math.round(
                (((bothMentioned + onlyCompetitor) / total) * 1000),
              ) / 10
            : 0,
        bothMentioned,
        onlyBrand,
        onlyCompetitor,
        neitherMentioned,
        totalPrompts: total,
        prompts,
      });
    },
  );

  // ---- compare-sources ----
  server.tool(
    'compare-sources',
    'Source overlap analysis: which sources are cited in responses where brand is mentioned vs where a competitor is mentioned. Use for "which sources help us?" or "source overlap with [competitor]". Do NOT use for general source listing — use list-sources instead.',
    {
      competitor: z
        .string()
        .optional()
        .describe(
          'Competitor name. If omitted, compares brand-mentioned responses vs non-brand-mentioned.',
        ),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
    },
    async ({ competitor, runId, model }) => {
      let responses = await storage.getResponsesWithPrompts(runId);
      responses = filterByModel(responses, model);

      const compLower = competitor?.toLowerCase();

      const brandSources = new Set<string>();
      const competitorSources = new Set<string>();

      for (const r of responses) {
        const rSources = r.sources || [];
        if (r.brandMentioned) {
          for (const s of rSources) {
            try {
              const domain = new URL(s.startsWith('http') ? s : `https://${s}`).hostname;
              brandSources.add(domain);
            } catch {
              brandSources.add(s);
            }
          }
        }
        if (compLower) {
          if (
            (r.competitorsMentioned || []).some(
              (c) => c.toLowerCase() === compLower,
            )
          ) {
            for (const s of rSources) {
              try {
                const domain = new URL(s.startsWith('http') ? s : `https://${s}`).hostname;
                competitorSources.add(domain);
              } catch {
                competitorSources.add(s);
              }
            }
          }
        } else {
          // No competitor specified: use non-brand responses
          if (!r.brandMentioned) {
            for (const s of rSources) {
              try {
                const domain = new URL(s.startsWith('http') ? s : `https://${s}`).hostname;
                competitorSources.add(domain);
              } catch {
                competitorSources.add(s);
              }
            }
          }
        }
      }

      const shared = [...brandSources].filter((s) => competitorSources.has(s));
      const brandOnly = [...brandSources].filter(
        (s) => !competitorSources.has(s),
      );
      const competitorOnly = [...competitorSources].filter(
        (s) => !brandSources.has(s),
      );

      return textResult({
        comparison: competitor || 'non-brand responses',
        brandOnlySources: brandOnly,
        sharedSources: shared,
        competitorOnlySources: competitorOnly,
      });
    },
  );

  // =========================================================================
  // 6. RUN ANALYSIS
  // =========================================================================

  // ---- get-run ----
  server.tool(
    'get-run',
    'Details for a single run. Returns BOTH headline metrics (visibilityScore = dashboard-aligned per-model average; uniquePromptMentionRate = optimistic any-model-any-run), plus job-vs-data counts so you can spot silent failures: completedJobs (= completedPrompts, includes failures) vs responsesStored (actual response rows) vs uniquePromptsAnalyzed (distinct prompt texts). modelsExpected lists currently-enabled models; modelCoverage shows per-model responsesStored — a model with 0 here failed for the entire run. Use for "show me run #X" or "how did the last run go?". Do NOT use for listing all runs — use list-runs.',
    {
      id: z
        .number()
        .optional()
        .describe('Analysis run ID. If omitted, returns the latest run.'),
    },
    async ({ id }) => {
      let run;
      if (id) {
        const runs = await storage.getAnalysisRuns();
        run = runs.find((r) => r.id === id);
      } else {
        run = await storage.getLatestAnalysisRun();
      }

      if (!run) {
        return textResult({ error: 'Analysis run not found' });
      }

      const responses = await storage.getResponsesWithPrompts(run.id);
      const metrics = computeMentionMetrics(responses);

      // Model breakdown — per-model rates (unambiguous within a model).
      const modelGroups = new Map<string, ResponseWithPrompt[]>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelGroups.has(p)) modelGroups.set(p, []);
        modelGroups.get(p)!.push(r);
      }
      const modelBreakdown = [...modelGroups.entries()].map(
        ([name, resps]) => {
          const m = computeMentionRate(resps);
          return {
            model: name,
            label: MODEL_META[name]?.label || name,
            mentionRate: m.rate,
            mentioned: m.mentioned,
            total: m.total,
          };
        },
      );

      // Models the run was *expected* to cover, from the active config. A model
      // present here but absent from modelBreakdown / modelCoverage means every
      // job for that model failed in this run.
      let modelsExpected: string[] = [];
      try {
        const cfgRaw = await storage.getSetting('modelsConfig');
        if (cfgRaw) {
          const cfg = JSON.parse(cfgRaw);
          modelsExpected = Object.entries(cfg)
            .filter(([, v]) => (v as { enabled?: boolean })?.enabled)
            .map(([k]) => k);
        }
      } catch {
        // Settings may be missing on first run — leave empty.
      }

      // Per-model coverage: responsesStored == 0 for an expected model means
      // it produced no rows at all for this run (likely all-failed).
      const allModels = new Set<string>([...modelsExpected, ...modelGroups.keys()]);
      const modelCoverage: Record<string, { responsesStored: number; uniquePromptsAnalyzed: number }> = {};
      for (const m of allModels) {
        const mResps = modelGroups.get(m) || [];
        const uniq = new Set(mResps.map((r) => r.prompt?.text?.toLowerCase().trim() || ''));
        modelCoverage[m] = {
          responsesStored: mResps.length,
          uniquePromptsAnalyzed: uniq.size,
        };
      }

      // Top competitors
      const compCounts = competitorPromptCounts(responses);
      const topCompetitors = [...compCounts.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 5)
        .map(([name, s]) => ({ name, promptCount: s.size }));

      // Failure count
      let failureCount = 0;
      try {
        const failed = await storage.getFailedJobs(run.id);
        failureCount = failed.length;
      } catch {
        // Ignore if not available
      }

      return textResult({
        id: run.id,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        status: run.status,
        brandName: run.brandName,
        // Headline metrics (use these for "how did the run do?").
        ...metrics,
        // Job vs data counts. completedJobs counts completed+failed jobs;
        // a low responsesStored relative to completedJobs means many failed.
        totalJobs: run.totalPrompts,
        completedJobs: run.completedPrompts,
        responsesStored: responses.length,
        uniquePromptsAnalyzed: metrics.totalUniquePrompts,
        failureCount,
        // Coverage — surfaces silently-missing models.
        modelsExpected,
        modelCoverage,
        modelBreakdown,
        topCompetitors,
      });
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express integration
// ---------------------------------------------------------------------------

export function registerMcpEndpoint(app: Express) {
  // Map to track transports by session ID
  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      // Authenticate via API key
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' });
        return;
      }
      const apiKey = authHeader.slice(7);
      const user = await findUserByApiKey(apiKey);
      if (!user) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      // New session: create transport + server
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });

      // Clean up on close
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) transports.delete(id);
      };

      const server = await createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err: any) {
      console.error('[MCP] Error handling request:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal MCP server error' });
      }
    }
  });

  // Handle GET for SSE streams (Streamable HTTP transport)
  app.get('/mcp', async (req: Request, res: Response) => {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    const user = await findUserByApiKey(authHeader.slice(7));
    if (!user) { res.status(401).json({ error: 'Invalid API key' }); return; }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Handle DELETE for session termination
  app.delete('/mcp', async (req: Request, res: Response) => {
    // Authenticate
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    const user = await findUserByApiKey(authHeader.slice(7));
    if (!user) { res.status(401).json({ error: 'Invalid API key' }); return; }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
  });

  console.log('[MCP] Endpoint registered at /mcp');
}
