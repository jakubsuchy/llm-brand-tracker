import type { Express } from "express";
import { parseDateRange, computeVisibilityScore } from "./helpers";
import { storage } from "../storage";

export function registerMetricsRoutes(app: Express) {
  // Brand Visibility Score — single-run score when runId given, otherwise average across recent runs
  app.get("/api/metrics/visibility-score", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const { from, to } = parseDateRange(req);

      if (runId) {
        const responses = await storage.getResponsesWithPrompts(runId);
        const { score, modelCount } = computeVisibilityScore(responses);
        return res.json({ score: Math.round(score * 10) / 10, runCount: 1, modelCount });
      }

      // Aggregate: average across completed runs in date range (default: last 2 weeks)
      const effectiveFrom = from || new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const runs = await storage.getAnalysisRuns(effectiveFrom, to);
      const recentRuns = runs.filter(r => r.status === 'complete');

      if (recentRuns.length === 0) {
        return res.json({ score: 0, runCount: 0, modelCount: 0 });
      }

      const runScores: number[] = [];
      const allModels = new Set<string>();
      for (const run of recentRuns) {
        const responses = await storage.getResponsesWithPrompts(run.id);
        if (responses.length === 0) continue;
        const { score } = computeVisibilityScore(responses);
        runScores.push(score);
        for (const r of responses) allModels.add(r.model || 'unknown');
      }

      const score = runScores.length > 0 ? runScores.reduce((a, b) => a + b, 0) / runScores.length : 0;
      res.json({ score: Math.round(score * 10) / 10, runCount: runScores.length, modelCount: allModels.size });
    } catch (error) {
      console.error("Error computing visibility score:", error);
      res.status(500).json({ error: "Failed to compute visibility score" });
    }
  });

  // Trend data: per-run visibility scores for charting
  app.get("/api/metrics/trends", async (req, res) => {
    try {
      const { from, to } = parseDateRange(req);
      const model = req.query.model as string | undefined;
      const allRuns = await storage.getAnalysisRuns(from, to);
      const completedRuns = allRuns.filter(r => r.status === 'complete');

      // Get display labels
      const { MODEL_META } = await import('@shared/models');
      const defaultLabels: Record<string, string> = Object.fromEntries(Object.entries(MODEL_META).map(([k, v]) => [k, v.label]));
      const modelsConfigRaw = await storage.getSetting('modelsConfig');
      const modelsConfig = modelsConfigRaw ? JSON.parse(modelsConfigRaw) : {};

      const runs = [];
      for (const run of completedRuns) {
        const responses = await storage.getResponsesWithPrompts(run.id);
        if (responses.length === 0) continue;

        const { score, modelMap } = computeVisibilityScore(responses);
        const modelRates: Record<string, number> = {};
        for (const [mdl, promptMap] of modelMap.entries()) {
          if (model && mdl !== model) continue;
          const total = promptMap.size;
          const mentioned = [...promptMap.values()].filter(Boolean).length;
          modelRates[mdl] = total > 0 ? Math.round((mentioned / total) * 1000) / 10 : 0;
        }

        runs.push({
          runId: run.id,
          date: run.completedAt || run.startedAt,
          overallRate: Math.round(score * 10) / 10,
          modelRates,
        });
      }

      // Return oldest first for charting
      runs.reverse();

      // Collect all model keys for label lookup
      const modelLabels: Record<string, string> = {};
      for (const r of runs) {
        for (const m of Object.keys(r.modelRates)) {
          if (!modelLabels[m]) {
            modelLabels[m] = modelsConfig[m]?.label || defaultLabels[m] || m;
          }
        }
      }

      res.json({ runs, modelLabels });
    } catch (error) {
      console.error("Error fetching trends:", error);
      res.status(500).json({ error: "Failed to fetch trends" });
    }
  });

  app.get("/api/metrics/by-model", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const { from, to } = parseDateRange(req);
      const allResponses = await storage.getResponsesWithPrompts(runId, from, to);

      // Group by model, then by unique prompt text
      const modelMap = new Map<string, Map<string, boolean>>();
      for (const r of allResponses) {
        const mdl = r.model || 'unknown';
        if (!modelMap.has(mdl)) modelMap.set(mdl, new Map());
        const promptMap = modelMap.get(mdl)!;
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMap.has(key)) promptMap.set(key, false);
        if (r.brandMentioned) promptMap.set(key, true);
      }

      // Get display labels from model config
      const { MODEL_META } = await import('@shared/models');
      const defaultLabels: Record<string, string> = Object.fromEntries(Object.entries(MODEL_META).map(([k, v]) => [k, v.label]));
      const modelsConfigRaw = await storage.getSetting('modelsConfig');
      const modelsConfig = modelsConfigRaw ? JSON.parse(modelsConfigRaw) : {};

      const results = [...modelMap.entries()].map(([model, promptMap]) => {
        const total = promptMap.size;
        const mentioned = [...promptMap.values()].filter(Boolean).length;
        return {
          model,
          label: modelsConfig[model]?.label || defaultLabels[model] || model,
          total,
          mentioned,
          rate: total > 0 ? Math.round((mentioned / total) * 1000) / 10 : 0,
        };
      }).sort((a, b) => b.rate - a.rate);

      res.json(results);
    } catch (error) {
      console.error("Error fetching model metrics:", error);
      res.status(500).json({ error: "Failed to fetch model metrics" });
    }
  });

  // Overview metrics endpoint
  app.get("/api/metrics", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const { from, to } = parseDateRange(req);
      let allResponses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) allResponses = allResponses.filter(r => r.model === model);

      // Group by unique prompt text — a prompt "mentions brand" if ANY response for it did
      const promptMap = new Map<string, { mentioned: boolean; count: number }>();
      for (const r of allResponses) {
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMap.has(key)) promptMap.set(key, { mentioned: false, count: 0 });
        const entry = promptMap.get(key)!;
        entry.count++;
        if (r.brandMentioned) entry.mentioned = true;
      }
      const uniquePrompts = promptMap.size;
      const brandMentions = [...promptMap.values()].filter(p => p.mentioned).length;
      const brandMentionRate = uniquePrompts > 0 ? (brandMentions / uniquePrompts) * 100 : 0;

      // Get top competitor from competitor_mentions table
      let topCompetitorName = 'N/A';
      const mentions = runId
        ? await storage.getCompetitorAnalysisByRun(runId)
        : await storage.getCompetitorAnalysisAllRuns();
      const top = mentions.sort((a, b) => b.mentionCount - a.mentionCount)[0];
      if (top) topCompetitorName = top.name;

      // Get source counts
      const allSources = await storage.getSources();
      let sourceCount = 0;
      let domainCount = 0;
      if (runId || model) {
        const sourcesWithUrls = await Promise.all(
          allSources.map(async s => {
            const urls = await storage.getSourceUrlsBySourceId(s.id, runId, model);
            return urls.length > 0 ? s : null;
          })
        );
        const activeSources = sourcesWithUrls.filter(Boolean);
        domainCount = activeSources.length;
        sourceCount = activeSources.reduce((sum, s) => {
          return sum; // counted below
        }, 0);
        // Count total URLs for this run/model
        let totalUrls = 0;
        for (const s of allSources) {
          const urls = await storage.getSourceUrlsBySourceId(s.id, runId, model);
          totalUrls += urls.length;
        }
        sourceCount = totalUrls;
      } else {
        domainCount = allSources.length;
        sourceCount = allSources.reduce((sum, s) => sum + (s.citationCount || 0), 0);
      }

      res.json({
        brandMentionRate,
        totalPrompts: uniquePrompts,
        brandMentions,
        topCompetitor: topCompetitorName,
        totalSources: sourceCount,
        totalDomains: domainCount
      });
    } catch (error) {
      console.error("Error fetching metrics:", error);
      res.status(500).json({ error: "Failed to fetch metrics" });
    }
  });

  // Total counts endpoint for accurate statistics
  app.get("/api/counts", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const { from, to } = parseDateRange(req);
      let allResponses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      const allPrompts = await storage.getPrompts();
      const allTopics = await storage.getTopics();

      // Unique prompt mention calculation
      const promptMap = new Map<string, boolean>();
      for (const r of allResponses) {
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMap.has(key)) promptMap.set(key, false);
        if (r.brandMentioned) promptMap.set(key, true);
      }
      const uniquePrompts = promptMap.size;
      const brandMentions = [...promptMap.values()].filter(Boolean).length;

      res.json({
        totalResponses: allResponses.length,
        totalPrompts: uniquePrompts,
        totalTopics: allTopics.length,
        totalCompetitors: 0,
        totalSources: 0,
        brandMentions,
        brandMentionRate: uniquePrompts > 0 ? (brandMentions / uniquePrompts) * 100 : 0
      });
    } catch (error) {
      console.error("Error fetching counts:", error);
      res.status(500).json({ error: "Failed to fetch counts" });
    }
  });
}
