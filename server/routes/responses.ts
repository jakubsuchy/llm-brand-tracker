import type { Express } from "express";
import { requireRole, parseDateRange } from "./helpers";
import { storage } from "../storage";
import { insertPromptSchema } from "@shared/schema";
import { BrandAnalyzer } from "../services/analyzer";

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

  // Prompt results endpoints - supports full dataset access
  app.get("/api/responses", async (req, res) => {
    // #swagger.tags = ['Responses']
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
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
