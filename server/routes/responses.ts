import type { Express } from "express";
import { requireRole, parseDateRange } from "./helpers";
import { storage } from "../storage";
import { insertPromptSchema } from "@shared/schema";
import { BrandAnalyzer } from "../services/analyzer";
import { buildSourceClassifier } from "./sources";
import { parseHttpUrl } from "../services/analysis";

export function registerResponseRoutes(app: Express) {
  // Prompts endpoint - shows only latest analysis prompts
  app.get("/api/prompts", async (req, res) => {
    // #swagger.tags = ['Responses']
    try {
      const latestPrompts = await storage.getLatestPrompts();
      // Add topic information to each prompt
      const promptsWithTopics = await Promise.all(
        latestPrompts.map(async (prompt) => {
          const topic = prompt.topicId ? await storage.getTopicById(prompt.topicId) : null;
          return { ...prompt, topic };
        })
      );
      res.json(promptsWithTopics);
    } catch (error) {
      console.error("Error fetching prompts:", error);
      res.status(500).json({ error: "Failed to fetch prompts" });
    }
  });

  // Per-prompt ranking — feeds the /prompts page and the dashboard
  // "worst-performing prompts" widget. Aggregates by promptId across all
  // responses, returning total/brandMentions/mentionRate plus per-model
  // breakdown so the table can show a sparkline-style breakdown if desired.
  app.get("/api/prompts/ranked", requireRole('user'), async (req, res) => {
    // #swagger.tags = ['Responses']
    // #swagger.parameters['runId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['model'] = { in: 'query', type: 'string' }
    // #swagger.parameters['from'] = { in: 'query', type: 'string', format: 'date-time' }
    // #swagger.parameters['to'] = { in: 'query', type: 'string', format: 'date-time' }
    // #swagger.parameters['topicId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['sort'] = { in: 'query', type: 'string', description: 'mentionRate (default), asc, or desc' }
    // #swagger.parameters['limit'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['offset'] = { in: 'query', type: 'integer' }
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const topicId = req.query.topicId ? parseInt(req.query.topicId as string) : undefined;
      const { from, to } = parseDateRange(req);
      const sort = (req.query.sort as string) || 'desc';
      const limit = req.query.limit ? Math.max(1, parseInt(req.query.limit as string)) : undefined;
      const offset = req.query.offset ? Math.max(0, parseInt(req.query.offset as string)) : 0;

      let allResponses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      if (topicId) allResponses = allResponses.filter(r => r.prompt?.topicId === topicId);

      // Group by promptId. Track per-model totals so each prompt knows
      // which models mentioned the brand and at what rate.
      type PerModel = { total: number; mentioned: number };
      type Bucket = {
        id: number;
        text: string;
        topicId: number | null;
        topicName: string;
        totalResponses: number;
        brandMentions: number;
        byModel: Map<string, PerModel>;
      };
      const promptMap = new Map<number, Bucket>();
      for (const r of allResponses) {
        if (!r.prompt) continue;
        const id = r.prompt.id;
        if (!promptMap.has(id)) {
          promptMap.set(id, {
            id,
            text: r.prompt.text,
            topicId: r.prompt.topicId ?? null,
            topicName: r.prompt.topic?.name || 'General',
            totalResponses: 0,
            brandMentions: 0,
            byModel: new Map(),
          });
        }
        const b = promptMap.get(id)!;
        b.totalResponses++;
        if (r.brandMentioned) b.brandMentions++;
        const mdl = r.model || 'unknown';
        if (!b.byModel.has(mdl)) b.byModel.set(mdl, { total: 0, mentioned: 0 });
        const pm = b.byModel.get(mdl)!;
        pm.total++;
        if (r.brandMentioned) pm.mentioned++;
      }

      const prompts = [...promptMap.values()].map(b => ({
        id: b.id,
        text: b.text,
        topicId: b.topicId,
        topicName: b.topicName,
        totalResponses: b.totalResponses,
        brandMentions: b.brandMentions,
        mentionRate: b.totalResponses > 0
          ? Math.round((b.brandMentions / b.totalResponses) * 1000) / 10
          : 0,
        byModel: [...b.byModel.entries()].map(([mdl, pm]) => ({
          model: mdl,
          total: pm.total,
          mentioned: pm.mentioned,
          rate: pm.total > 0 ? Math.round((pm.mentioned / pm.total) * 1000) / 10 : 0,
        })),
      }));

      // Stable secondary sort by id so identical-rate rows don't reshuffle
      // between requests. asc/desc both work on mentionRate.
      const dir = sort === 'asc' ? 1 : -1;
      prompts.sort((a, b) =>
        (a.mentionRate - b.mentionRate) * dir || a.id - b.id
      );

      const total = prompts.length;
      const sliced = limit !== undefined
        ? prompts.slice(offset, offset + limit)
        : prompts.slice(offset);

      res.json({ total, prompts: sliced });
    } catch (error) {
      console.error("Error fetching ranked prompts:", error);
      res.status(500).json({ error: "Failed to fetch ranked prompts" });
    }
  });

  // Per-prompt analytics — drill-in detail. Aggregates everything visible
  // on /prompts/:id: KPIs, per-model bars, trend across runs, top
  // competitors mentioned alongside this prompt, and top cited sources.
  app.get("/api/prompts/:id/analytics", requireRole('user'), async (req, res) => {
    // #swagger.tags = ['Responses']
    // #swagger.parameters['id'] = { in: 'path', required: true, type: 'integer' }
    // #swagger.parameters['runId'] = { in: 'query', type: 'integer' }
    // #swagger.parameters['from'] = { in: 'query', type: 'string', format: 'date-time' }
    // #swagger.parameters['to'] = { in: 'query', type: 'string', format: 'date-time' }
    try {
      const promptId = parseInt(req.params.id);
      if (!Number.isFinite(promptId)) {
        return res.status(400).json({ error: "id must be a number" });
      }
      const prompt = await storage.getPromptById(promptId);
      if (!prompt) return res.status(404).json({ error: "Prompt not found" });
      const topic = prompt.topicId ? await storage.getTopicById(prompt.topicId) : null;

      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const { from, to } = parseDateRange(req);

      const all = await storage.getResponsesWithPrompts(runId, from, to);
      const responses = all.filter(r => r.promptId === promptId);

      // Model labels — same source the metrics endpoints use.
      const { MODEL_META } = await import('@shared/models');
      const defaultLabels: Record<string, string> = Object.fromEntries(
        Object.entries(MODEL_META).map(([k, v]) => [k, v.label])
      );
      const modelsConfigRaw = await storage.getSetting('modelsConfig');
      const modelsConfig = modelsConfigRaw ? JSON.parse(modelsConfigRaw) : {};
      const labelOf = (m: string) => modelsConfig[m]?.label || defaultLabels[m] || m;

      // byModel — count every response, no dedup. A single prompt has one
      // response per (model, run), so this directly answers "of all the
      // times we asked Gemini this prompt, how often did it mention us?"
      const modelTallies = new Map<string, { total: number; mentioned: number }>();
      for (const r of responses) {
        const mdl = r.model || 'unknown';
        if (!modelTallies.has(mdl)) modelTallies.set(mdl, { total: 0, mentioned: 0 });
        const pm = modelTallies.get(mdl)!;
        pm.total++;
        if (r.brandMentioned) pm.mentioned++;
      }
      const byModel = [...modelTallies.entries()]
        .map(([model, pm]) => ({
          model,
          label: labelOf(model),
          total: pm.total,
          mentioned: pm.mentioned,
          rate: pm.total > 0 ? Math.round((pm.mentioned / pm.total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.rate - a.rate);

      // Totals — runs counts distinct analysisRunIds touched by this prompt.
      const runIds = new Set<number>();
      for (const r of responses) {
        if (r.analysisRunId != null) runIds.add(r.analysisRunId);
      }
      const totals = {
        runs: runIds.size,
        responses: responses.length,
        brandMentions: responses.filter(r => r.brandMentioned).length,
        brandMentionRate: responses.length > 0
          ? Math.round((responses.filter(r => r.brandMentioned).length / responses.length) * 1000) / 10
          : 0,
      };

      // Trend per run — fetch run start times so the chart x-axis can show
      // dates, not run ids. One row per run id; perModel maps each model to
      // 1 (mentioned in this run) / 0 (not mentioned) / null (not asked).
      const runMeta = new Map<number, { startedAt: Date | null; completedAt: Date | null }>();
      const allRuns = await storage.getAnalysisRuns();
      for (const run of allRuns) {
        runMeta.set(run.id, { startedAt: run.startedAt, completedAt: run.completedAt });
      }
      const trendMap = new Map<number, { runId: number; runStartedAt: Date | null; perModel: Record<string, number>; anyMentioned: boolean }>();
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
      const trend = [...trendMap.values()].sort((a, b) => {
        const ad = a.runStartedAt?.getTime() ?? 0;
        const bd = b.runStartedAt?.getTime() ?? 0;
        return ad - bd;
      });

      // Top competitors — pulled from competitorsMentioned text array on
      // each response. Resolve each name to a competitor row so the UI can
      // deep-link by id (the canonical handle the rest of the app uses).
      // Names that don't match any record are dropped — they're noise from
      // model hallucinations rather than real competitors.
      //
      // Merge handling matters: a competitor with `mergedInto === id` is
      // blocked/dead and must NEVER surface (the rest of the app filters it
      // out, so a deep-link to its id 404s). A competitor with
      // `mergedInto = otherId` was rolled into another record — its old
      // mentions should resolve to the canonical record so historical data
      // doesn't get dropped.
      const allCompetitors = await storage.getAllCompetitorsIncludingMerged();
      const canonicalById = new Map<number, { id: number; name: string }>();
      for (const c of allCompetitors) {
        if (c.mergedInto != null) continue; // skip merged-out and blocked
        canonicalById.set(c.id, { id: c.id, name: c.name });
      }
      const competitorByName = new Map<string, { id: number; name: string }>();
      for (const c of allCompetitors) {
        if (c.mergedInto === c.id) continue; // blocked/self-merge
        const target = c.mergedInto != null
          ? canonicalById.get(c.mergedInto)
          : { id: c.id, name: c.name };
        if (!target) continue;
        competitorByName.set(c.name.toLowerCase(), target);
      }
      const competitorCounts = new Map<number, { id: number; name: string; count: number }>();
      for (const r of responses) {
        if (!r.competitorsMentioned || r.competitorsMentioned.length === 0) continue;
        const seenIds = new Set<number>();
        for (const raw of r.competitorsMentioned) {
          const name = (raw || '').trim();
          if (!name) continue;
          const match = competitorByName.get(name.toLowerCase());
          if (!match) continue;
          if (seenIds.has(match.id)) continue;
          seenIds.add(match.id);
          const entry = competitorCounts.get(match.id) || { id: match.id, name: match.name, count: 0 };
          entry.count++;
          competitorCounts.set(match.id, entry);
        }
      }
      const topCompetitors = [...competitorCounts.values()]
        .map(c => ({
          id: c.id,
          name: c.name,
          count: c.count,
          rate: responses.length > 0
            ? Math.round((c.count / responses.length) * 1000) / 10
            : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Top sources — count distinct citing responses per domain (one
      // response can cite the same domain twice, count it once). Resolve
      // each domain to a source row so the UI can deep-link by id.
      // Classify using the shared helper so brand/competitor/neutral
      // matches /sources.
      const { classifyDomain } = await buildSourceClassifier();
      const allSourceRows = await storage.getSources();
      const sourceByDomain = new Map<string, { id: number; domain: string }>();
      for (const s of allSourceRows) {
        sourceByDomain.set(s.domain.toLowerCase(), { id: s.id, domain: s.domain });
      }
      const sourceCounts = new Map<string, number>();
      for (const r of responses) {
        if (!r.sources || r.sources.length === 0) continue;
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
      const topSources = [...sourceCounts.entries()]
        .map(([domain, count]) => {
          const match = sourceByDomain.get(domain);
          return {
            id: match?.id ?? null,
            domain,
            count,
            classification: classifyDomain(domain),
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.json({
        prompt: {
          id: prompt.id,
          text: prompt.text,
          topicId: prompt.topicId,
          topicName: topic?.name || 'General',
        },
        totals,
        byModel,
        trend,
        topCompetitors,
        topSources,
      });
    } catch (error) {
      console.error("Error fetching prompt analytics:", error);
      res.status(500).json({ error: "Failed to fetch prompt analytics" });
    }
  });

  // Prompt results endpoints - supports full dataset access
  app.get("/api/responses", async (req, res) => {
    // #swagger.tags = ['Responses']
    // #swagger.parameters['promptId'] = { in: 'query', type: 'integer', description: 'Filter to responses for a specific prompt id' }
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const promptId = req.query.promptId ? parseInt(req.query.promptId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const { from, to } = parseDateRange(req);
      const useFullDataset = req.query.full === 'true' || limit > 100;

      let responses;
      if (useFullDataset) {
        responses = await storage.getResponsesWithPrompts(runId, from, to);
      } else {
        responses = await storage.getRecentResponses(limit, runId, from, to);
      }
      if (model) responses = responses.filter(r => r.model === model);
      // promptId filter applied AFTER fetch but BEFORE the slice — otherwise
      // a load-and-slice on a large dataset can drop matching rows for the
      // requested prompt while keeping unrelated ones (the bug that hid 3
      // of 4 responses for prompt 206).
      if (promptId !== undefined) responses = responses.filter(r => r.promptId === promptId);

      res.json(responses.slice(0, limit));
    } catch (error) {
      console.error("Error fetching responses:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });

  app.get("/api/responses/:id", async (req, res) => {
    // #swagger.tags = ['Responses']
    try {
      const id = parseInt(req.params.id);
      const response = await storage.getResponseById(id);
      if (!response) {
        return res.status(404).json({ error: "Response not found" });
      }
      res.json(response);
    } catch (error) {
      console.error("Error fetching response:", error);
      res.status(500).json({ error: "Failed to fetch response" });
    }
  });

  // Manual prompt testing
  app.post("/api/prompts/test", requireRole("analyst"), async (req, res) => {
    // #swagger.tags = ['Responses']
    try {
      const { text, topicId } = insertPromptSchema.parse(req.body);

      // Create prompt
      const prompt = await storage.createPrompt({ text, topicId });

      // Test with analyzer (this will create the response automatically)
      const testAnalyzer = new BrandAnalyzer();
      // Note: In a real implementation, you'd want to test just this single prompt
      // For now, we'll return the created prompt

      res.json({
        success: true,
        prompt,
        message: "Prompt queued for testing"
      });
    } catch (error) {
      console.error("Error testing prompt:", error);
      res.status(500).json({ error: "Failed to test prompt" });
    }
  });

  // Data management endpoints
  app.post("/api/data/clear", requireRole("admin"), async (req, res) => {
    // #swagger.tags = ['Responses']
    try {
      const { type } = req.body;

      if (type === 'all') {
        await storage.clearAllPrompts();
        await storage.clearAllResponses();
        await storage.clearAllCompetitors();
        res.json({ success: true, message: "All data cleared successfully" });
      } else if (type === 'prompts') {
        await storage.clearAllPrompts();
        res.json({ success: true, message: "All prompts cleared successfully" });
      } else if (type === 'responses') {
        await storage.clearAllResponses();
        res.json({ success: true, message: "All responses cleared successfully" });
      } else if (type === 'results') {
        await storage.clearResultsOnly();
        res.json({ success: true, message: "Results cleared. Prompts and topics preserved." });
      } else if (type === 'nuclear') {
        await storage.clearAllAnalysisData();
        res.json({ success: true, message: "All analysis data cleared. Settings preserved." });
      } else {
        res.status(400).json({ error: "Invalid type" });
      }
    } catch (error) {
      console.error("Error clearing data:", error);
      res.status(500).json({ error: "Failed to clear data" });
    }
  });
}
