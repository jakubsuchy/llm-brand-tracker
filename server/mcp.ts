import crypto from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { storage } from './storage';
import { findUserByApiKey } from './services/auth';
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

/** Compute unique-prompt-based mention rate from a list of responses. */
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

/** Classify source domain as brand/competitor/neutral using brand name and competitor list. */
async function classifySources() {
  const brandName = ((await storage.getSetting('brandName')) || '').toLowerCase();
  const allCompetitors = (await storage.getAllCompetitorsIncludingMerged()).filter(
    (c) => c.mergedInto !== c.id,
  );
  const competitorDomains = new Set<string>();
  const competitorNameWords: string[][] = [];
  for (const c of allCompetitors) {
    if (c.domain) competitorDomains.add(c.domain.toLowerCase());
    competitorNameWords.push(c.name.toLowerCase().split(/\s+/));
  }
  return (domain: string): string => {
    const dl = domain.toLowerCase();
    const base = dl.split('.')[0];
    if (brandName && (dl.includes(brandName) || brandName.includes(base))) return 'brand';
    if (
      competitorDomains.has(dl) ||
      competitorNameWords.some((words) =>
        words.some((w) => base.includes(w) || w.includes(base)),
      )
    )
      return 'competitor';
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

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'llm-brand-tracker',
    version: '1.0.0',
  });

  // =========================================================================
  // 1. QUICK OVERVIEW
  // =========================================================================

  // ---- brand-snapshot ----
  server.tool(
    'brand-snapshot',
    'Quick brand health check. Returns mention rate, total prompts, top competitor, source count. Use for "how am I doing?" or "give me a summary". Do NOT use for detailed per-topic or per-model breakdowns.',
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

      const { rate, mentioned, total } = computeMentionRate(responses);

      const compCounts = competitorPromptCounts(responses);
      const topComp = [...compCounts.entries()].sort(
        (a, b) => b[1].size - a[1].size,
      )[0];

      const sources = await storage.getSources();

      return textResult({
        brandMentionRate: rate,
        mentionedPrompts: mentioned,
        totalUniquePrompts: total,
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
    'Comprehensive brand assessment. Returns per-model rates, per-topic rates, top competitors with rates, top sources, AND the list of prompts where brand is NOT mentioned (the gap list). Use when you need a full picture. Do NOT use for a single quick number — use brand-snapshot instead.',
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

      const { rate, mentioned, total } = computeMentionRate(responses);

      // Per-model breakdown
      const modelGroups = new Map<string, ResponseWithPrompt[]>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelGroups.has(p)) modelGroups.set(p, []);
        modelGroups.get(p)!.push(r);
      }
      const modelRates = [...modelGroups.entries()].map(([name, resps]) => {
        const m = computeMentionRate(resps);
        return { model: name, mentionRate: m.rate, mentioned: m.mentioned, total: m.total };
      });

      // Per-topic breakdown
      const topicGroups = new Map<string, { id: number; responses: ResponseWithPrompt[] }>();
      for (const r of responses) {
        const tName = r.prompt?.topic?.name || 'Uncategorized';
        const tId = r.prompt?.topic?.id || 0;
        if (!topicGroups.has(tName)) topicGroups.set(tName, { id: tId, responses: [] });
        topicGroups.get(tName)!.responses.push(r);
      }
      const topicRates = [...topicGroups.entries()].map(([name, { id, responses: resps }]) => {
        const m = computeMentionRate(resps);
        return { topicId: id, topicName: name, mentionRate: m.rate, mentioned: m.mentioned, total: m.total };
      });

      // Top 5 competitors
      const compCounts = competitorPromptCounts(responses);
      const topCompetitors = [...compCounts.entries()]
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 5)
        .map(([name, promptSet]) => ({
          name,
          promptCount: promptSet.size,
          rate: total > 0 ? Math.round((promptSet.size / total) * 1000) / 10 : 0,
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
        brandMentionRate: rate,
        mentionedPrompts: mentioned,
        totalUniquePrompts: total,
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
    'Per-model mention rate breakdown. Returns an array with each model\'s mention rate, count, and total prompts. Use when asked "which model mentions us most?" or "show model comparison". Do NOT use for full side-by-side diff — use compare-models instead.',
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

      const labels: Record<string, string> = {
        perplexity: 'Perplexity',
        chatgpt: 'ChatGPT',
        gemini: 'Gemini',
      };

      const result = [...modelGroups.entries()].map(([name, resps]) => {
        const m = computeMentionRate(resps);
        return {
          model: name,
          label: labels[name] || name,
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
    'Ranked list of competitors by mention rate (unique prompt count). Returns name, category, mention rate, mention count, total prompts. Use for "who are my competitors?" or "show competitor ranking". Do NOT use for a single competitor deep dive — use get-competitor instead.',
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
    'Topic-level mention rate breakdown. Returns topicId, topicName, mentionRate, totalPrompts, brandMentions. Use for "which topics mention us?" or "show topic analysis". Do NOT use for response-level data — use search-prompts instead.',
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
          const promptMap = new Map<string, boolean>();
          for (const r of resps) {
            const key = r.prompt?.text?.toLowerCase().trim() || '';
            if (!promptMap.has(key)) promptMap.set(key, false);
            if (r.brandMentioned) promptMap.set(key, true);
          }
          const total = promptMap.size;
          const brandMentions = [...promptMap.values()].filter(Boolean).length;
          return {
            topicId: id,
            topicName: name,
            mentionRate:
              total > 0
                ? Math.round((brandMentions / total) * 1000) / 10
                : 0,
            totalPrompts: total,
            brandMentions,
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

  // ---- list-runs ----
  server.tool(
    'list-runs',
    'List all analysis runs with their status and progress. Returns id, startedAt, completedAt, status, brandName, totalPrompts, completedPrompts. Use for "show analysis history" or "what runs have been done?".',
    {},
    async () => {
      const runs = await storage.getAnalysisRuns();
      const result = runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        status: r.status,
        brandName: r.brandName,
        totalPrompts: r.totalPrompts,
        completedPrompts: r.completedPrompts,
      }));
      return textResult(result);
    },
  );

  // =========================================================================
  // 3. DETAIL / DRILL-DOWN
  // =========================================================================

  // ---- get-competitor ----
  server.tool(
    'get-competitor',
    'Deep dive into a single competitor. Returns name, category, mention rate, and the list of prompts where they appeared (with brand mention status). Use for "tell me about [competitor]". Do NOT use for ranking all competitors — use list-competitors instead.',
    {
      name: z.string().describe('Competitor name (case-insensitive)'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
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
    'Side-by-side comparison of models. Shows per-model mention rates AND a diff of which prompts are mentioned by which model. Use for "compare models" or "which model is best for us?". Do NOT use for a single model summary — use list-models instead.',
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
    'Brand vs. a specific competitor. Shows mention rates for both, overlap (prompts where both appear), and prompts where only one appears. Use for "how do we compare to [competitor]?" or "brand vs [competitor]". Do NOT use for ranking all competitors — use list-competitors instead.',
    {
      competitor: z.string().describe('Competitor name to compare against'),
      runId: z.number().optional().describe('Filter by analysis run ID'),
      model: z
        .string()
        .optional()
        .describe('Filter by model (perplexity, chatgpt, gemini)'),
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
    'Get details for a single analysis run including metrics, top competitors, failure count, and per-model breakdown. Use for "show me run #X" or "how did the last run go?". Do NOT use for listing all runs — use list-runs instead.',
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
      const { rate, mentioned, total } = computeMentionRate(responses);

      // Model breakdown
      const modelGroups = new Map<string, ResponseWithPrompt[]>();
      for (const r of responses) {
        const p = r.model || 'unknown';
        if (!modelGroups.has(p)) modelGroups.set(p, []);
        modelGroups.get(p)!.push(r);
      }
      const modelBreakdown = [...modelGroups.entries()].map(
        ([name, resps]) => {
          const m = computeMentionRate(resps);
          return { model: name, mentionRate: m.rate, mentioned: m.mentioned, total: m.total };
        },
      );

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
        mentionRate: rate,
        mentionedPrompts: mentioned,
        totalUniquePrompts: total,
        totalResponses: responses.length,
        topCompetitors,
        failureCount,
        modelBreakdown,
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

      const server = createMcpServer();
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
