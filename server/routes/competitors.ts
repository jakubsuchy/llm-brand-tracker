import type { Express } from "express";
import { parseDateRange, DEFAULT_BLOCKLIST } from "./helpers";
import { storage } from "../storage";

export function registerCompetitorRoutes(app: Express) {
  // Competitor merge endpoints — registered BEFORE /api/competitors
  app.get("/api/competitors/merge-suggestions", async (req, res) => {
    try {
      const suggestions = await storage.getMergeSuggestions();
      res.json(suggestions);
    } catch (error) {
      console.error("Error fetching merge suggestions:", error);
      res.status(500).json({ error: "Failed to fetch merge suggestions" });
    }
  });

  app.post("/api/competitors/merge", async (req, res) => {
    try {
      const { primaryId, absorbedIds } = req.body;
      if (!primaryId || !Array.isArray(absorbedIds) || absorbedIds.length === 0) {
        return res.status(400).json({ error: "primaryId and absorbedIds[] are required" });
      }
      const count = await storage.mergeCompetitors(primaryId, absorbedIds);
      res.json({ success: true, mergedCount: count });
    } catch (error) {
      console.error("Error merging competitors:", error);
      res.status(500).json({ error: (error as Error).message || "Failed to merge competitors" });
    }
  });

  app.post("/api/competitors/unmerge", async (req, res) => {
    try {
      const { competitorId } = req.body;
      if (!competitorId) {
        return res.status(400).json({ error: "competitorId is required" });
      }
      await storage.unmergeCompetitor(competitorId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error unmerging competitor:", error);
      res.status(500).json({ error: "Failed to unmerge competitor" });
    }
  });

  app.get("/api/competitors/merge-history", async (req, res) => {
    try {
      const history = await storage.getMergeHistory();
      res.json(history);
    } catch (error) {
      console.error("Error fetching merge history:", error);
      res.status(500).json({ error: "Failed to fetch merge history" });
    }
  });

  // Competitor analysis endpoint
  app.get("/api/competitors", async (req, res) => {
    try {
      const competitors = await storage.getCompetitors();
      res.json(competitors);
    } catch (error) {
      console.error("Error fetching competitors:", error);
      res.status(500).json({ error: "Failed to fetch competitors" });
    }
  });

  app.get("/api/competitors/analysis", async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const { from, to } = parseDateRange(req);

      // Unified approach: count unique prompts where each competitor was mentioned
      let allResponses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) allResponses = allResponses.filter(r => r.model === model);

      // Count unique prompts total
      const uniquePrompts = new Set(allResponses.map(r => r.prompt?.text?.toLowerCase().trim() || ''));
      const totalUniquePrompts = uniquePrompts.size;

      // Build name→primary lookup including merged competitors
      const allCompsIncMerged = await storage.getAllCompetitorsIncludingMerged();
      const activeComps = await storage.getCompetitors(); // non-merged only
      const activeById = new Map(activeComps.map(c => [c.id, c]));
      // Map every competitor name (including merged) to its primary ID
      const nameToPrimaryId = new Map<string, number>();
      for (const c of allCompsIncMerged) {
        const primaryId = c.mergedInto || c.id;
        if (activeById.has(primaryId)) {
          nameToPrimaryId.set(c.name.toLowerCase(), primaryId);
        }
      }

      // Count unique prompts per primary competitor (merges roll up)
      const primaryPrompts = new Map<number, Set<string>>();
      for (const r of allResponses) {
        const promptKey = r.prompt?.text?.toLowerCase().trim() || '';
        if (r.competitorsMentioned && Array.isArray(r.competitorsMentioned)) {
          for (const name of r.competitorsMentioned) {
            const primaryId = nameToPrimaryId.get(name.toLowerCase());
            if (!primaryId) continue; // unknown or blocked competitor
            if (!primaryPrompts.has(primaryId)) primaryPrompts.set(primaryId, new Set());
            primaryPrompts.get(primaryId)!.add(promptKey);
          }
        }
      }

      const analysis = [...primaryPrompts.entries()].map(([primaryId, prompts]) => {
        const comp = activeById.get(primaryId)!;
        const mentionCount = prompts.size;
        return {
          competitorId: comp.id,
          name: comp.name,
          domain: comp.domain || null,
          category: comp.category || null,
          mentionCount,
          mentionRate: totalUniquePrompts > 0 ? (mentionCount / totalUniquePrompts) * 100 : 0,
          changeRate: 0
        };
      }).sort((a, b) => b.mentionCount - a.mentionCount);

      res.json(analysis);
    } catch (error) {
      console.error("Error fetching competitor analysis:", error);
      res.status(500).json({ error: "Failed to fetch competitor analysis" });
    }
  });

  // Block a competitor: add to blocklist + soft-remove from competitor data
  app.post("/api/competitors/block", async (req, res) => {
    try {
      const { competitorId } = req.body;
      if (!competitorId) {
        return res.status(400).json({ error: "competitorId is required" });
      }

      // Get competitor name
      const allComps = await storage.getAllCompetitorsIncludingMerged();
      const comp = allComps.find(c => c.id === competitorId);
      if (!comp) {
        return res.status(404).json({ error: "Competitor not found" });
      }

      // Add to blocklist
      const value = await storage.getSetting('competitorBlocklist');
      const current = value ? value.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_BLOCKLIST;
      const nameLower = comp.name.toLowerCase();
      if (!current.includes(nameLower)) {
        current.push(nameLower);
        await storage.setSetting('competitorBlocklist', current.join(','));
      }

      const { db } = await import("../db");
      const { competitors, competitorMentions } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      await db.delete(competitorMentions).where(eq(competitorMentions.competitorId, competitorId));

      const mergedInto = allComps.filter(c => c.mergedInto === competitorId);
      for (const m of mergedInto) {
        await db.delete(competitorMentions).where(eq(competitorMentions.competitorId, m.id));
        await db.update(competitors).set({ mergedInto: competitorId }).where(eq(competitors.id, m.id));
      }

      await db.update(competitors).set({ mergedInto: competitorId }).where(eq(competitors.id, competitorId));

      res.json({ success: true, blocked: comp.name });
    } catch (error) {
      console.error("Error blocking competitor:", error);
      res.status(500).json({ error: "Failed to block competitor" });
    }
  });
}
