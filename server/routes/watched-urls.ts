import type { Express } from "express";
import { requireRole } from "./helpers";
import { storage } from "../storage";
import { normalizeUrl, parseHttpUrl } from "../services/analysis";

/**
 * Source Watchlist routes — user-registered URLs tracked against LLM citations.
 *
 * Access model:
 *  - Reads (GET): any authenticated user
 *  - Writes (POST/PUT/DELETE): analyst or admin
 *  - No per-user ownership — watchlist is tenant-wide
 *
 * URL validation: `parseHttpUrl` rejects non-http(s) schemes at ingress so a
 * `javascript:` URL can never reach the `<a href>` sink in the UI.
 *
 * Citation matching is indexed via `source_urls.normalized_url` (see
 * getWatchedUrlCitations in database-storage.ts).
 */
export function registerWatchedUrlRoutes(app: Express) {
  app.get("/api/watched-urls", async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const withCitations = req.query.citations === 'true';
      if (withCitations) {
        const result = await storage.getWatchedUrlsWithCitations(runId, model);
        res.json(result);
      } else {
        res.json(await storage.getWatchedUrls());
      }
    } catch (error) {
      console.error("Error fetching watched URLs:", error);
      res.status(500).json({ error: "Failed to fetch watched URLs" });
    }
  });

  // Watched URLs first cited AFTER the given run. Used for post-run polling —
  // a URL appears here only if it was never cited before run (sinceRunId) and
  // has at least one citation in a later run. Strict "newly discovered" semantic.
  app.get("/api/watched-urls/new-citations", async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const sinceRunId = req.query.sinceRunId ? parseInt(req.query.sinceRunId as string) : undefined;
      if (sinceRunId === undefined || Number.isNaN(sinceRunId)) {
        return res.status(400).json({ error: "sinceRunId query param is required" });
      }
      const all = await storage.getWatchedUrlsWithCitations();
      const newly = all.filter((w) => w.firstCitedRunId !== null && w.firstCitedRunId > sinceRunId);
      res.json(newly);
    } catch (error) {
      console.error("Error fetching new watched URL citations:", error);
      res.status(500).json({ error: "Failed to fetch new citations" });
    }
  });

  app.get("/api/watched-urls/:id/citations", async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const result = await storage.getWatchedUrlCitations(id, runId, model);
      if (!result) return res.status(404).json({ error: "Watched URL not found" });
      res.json(result);
    } catch (error) {
      console.error("Error fetching watched URL citations:", error);
      res.status(500).json({ error: "Failed to fetch citations" });
    }
  });

  app.post("/api/watched-urls", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const { url, title, notes } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "url is required" });
      }
      if (!parseHttpUrl(url)) {
        return res.status(400).json({ error: "url must be a valid http(s) URL" });
      }
      const normalizedUrl = normalizeUrl(url);
      const existing = await storage.getWatchedUrlByNormalized(normalizedUrl);
      if (existing) {
        return res.status(409).json({ error: "URL already in watchlist", watchedUrl: existing });
      }
      const userId = (req.user as any)?.id;
      const created = await storage.createWatchedUrl({
        url: url.trim(),
        normalizedUrl,
        title: title || null,
        notes: notes || null,
        addedByUserId: userId || null,
      });
      res.status(201).json(created);
    } catch (error) {
      console.error("Error creating watched URL:", error);
      res.status(500).json({ error: "Failed to create watched URL" });
    }
  });

  app.put("/api/watched-urls/:id", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { title, notes } = req.body || {};
      const updated = await storage.updateWatchedUrl(id, { title, notes });
      if (!updated) return res.status(404).json({ error: "Watched URL not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating watched URL:", error);
      res.status(500).json({ error: "Failed to update watched URL" });
    }
  });

  app.delete("/api/watched-urls/:id", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Watched URLs']
    try {
      const id = parseInt(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await storage.deleteWatchedUrl(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting watched URL:", error);
      res.status(500).json({ error: "Failed to delete watched URL" });
    }
  });
}
