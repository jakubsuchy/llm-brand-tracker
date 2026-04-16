import type { Express } from "express";
import { parseDateRange } from "./helpers";
import { storage } from "../storage";

export function registerTopicRoutes(app: Express) {
  app.get("/api/topics", async (req, res) => {
    // #swagger.tags = ['Topics']
    try {
      const topics = await storage.getTopics();
      res.json(topics);
    } catch (error) {
      console.error("Error fetching topics:", error);
      res.status(500).json({ error: "Failed to fetch topics" });
    }
  });

  // Get topics with their prompts (for prompt generator review)
  app.get("/api/topics/with-prompts", async (req, res) => {
    // #swagger.tags = ['Topics']
    try {
      const allTopics = await storage.getTopics();
      const allPrompts = await storage.getPrompts();
      const result = allTopics
        .filter(t => !t.deleted)
        .map(topic => ({
          id: topic.id,
          name: topic.name,
          description: topic.description,
          prompts: allPrompts
            .filter(p => p.topicId === topic.id && !p.deleted)
            .map(p => ({ id: p.id, text: p.text }))
        }));
      res.json(result);
    } catch (error) {
      console.error("Error fetching topics with prompts:", error);
      res.status(500).json({ error: "Failed to fetch topics with prompts" });
    }
  });

  // Soft-delete a topic and its prompts
  app.delete("/api/topics/:id", async (req, res) => {
    // #swagger.tags = ['Topics']
    try {
      const topicId = parseInt(req.params.id);
      await storage.softDeleteTopic(topicId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting topic:", error);
      res.status(500).json({ error: "Failed to delete topic" });
    }
  });

  // Soft-delete a prompt
  app.delete("/api/prompts/:id", async (req, res) => {
    // #swagger.tags = ['Topics']
    try {
      const promptId = parseInt(req.params.id);
      await storage.softDeletePrompt(promptId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting prompt:", error);
      res.status(500).json({ error: "Failed to delete prompt" });
    }
  });

  app.get("/api/topics/analysis", async (req, res) => {
    // #swagger.tags = ['Topics']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const { from, to } = parseDateRange(req);
      let allResponses = await storage.getResponsesWithPrompts(runId, from, to);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      const topicMap = new Map<number, { name: string; total: number; brandMentions: number }>();
      for (const r of allResponses) {
        const topicId = r.prompt?.topicId || 0;
        const topicName = r.prompt?.topic?.name || 'General';
        if (!topicMap.has(topicId)) topicMap.set(topicId, { name: topicName, total: 0, brandMentions: 0 });
        const t = topicMap.get(topicId)!;
        t.total++;
        if (r.brandMentioned) t.brandMentions++;
      }
      const analysis = [...topicMap.entries()].map(([topicId, t]) => ({
        topicId,
        topicName: t.name,
        totalPrompts: t.total,
        brandMentions: t.brandMentions,
        mentionRate: t.total > 0 ? (t.brandMentions / t.total) * 100 : 0
      }));
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching topic analysis:", error);
      res.status(500).json({ error: "Failed to fetch topic analysis" });
    }
  });
}
