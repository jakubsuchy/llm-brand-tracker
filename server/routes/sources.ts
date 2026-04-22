import type { Express } from "express";
import { parseDateRange, getCurrentBrandName, requireRole } from "./helpers";
import { storage } from "../storage";
import { normalizeUrl, parseHttpUrl } from "../services/analysis";

export function registerSourceRoutes(app: Express) {
  app.get("/api/sources", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const sources = await storage.getSources();
      res.json(sources);
    } catch (error) {
      console.error("Error fetching sources:", error);
      res.status(500).json({ error: "Failed to fetch sources" });
    }
  });

  // Reclassify a source domain as competitor or neutral
  app.post("/api/sources/reclassify", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const { domain, sourceType } = req.body;
      if (!domain || !sourceType) {
        return res.status(400).json({ error: "domain and sourceType are required" });
      }

      if (sourceType === 'competitor') {
        // Check if it's a subdomain (3+ parts like techdocs.f5.com)
        const parts = domain.split('.');
        if (parts.length >= 3) {
          // Add to subdomain recognition setting
          const value = await storage.getSetting('competitorSubdomains');
          const entries = value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : ['docs'];
          if (!entries.includes(domain.toLowerCase())) {
            entries.push(domain.toLowerCase());
            await storage.setSetting('competitorSubdomains', entries.join(','));
          }
        } else {
          // Root domain — create/find a competitor record with this domain
          const domainBase = parts[0]; // "radware" from "radware.com"
          const name = domainBase.charAt(0).toUpperCase() + domainBase.slice(1); // "Radware"
          let competitor = await storage.getCompetitorByName(name);
          if (!competitor) {
            competitor = await storage.createCompetitor({
              name,
              category: null,
              mentionCount: 0,
            });
          }
          // Force-set the domain on the competitor record
          const { db: database } = await import("../db");
          const { competitors: competitorsTable } = await import("@shared/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          await database.update(competitorsTable).set({ domain: domain.toLowerCase() }).where(eqOp(competitorsTable.id, competitor.id));
        }
        // Remove from blocklist and brand domains if present
        for (const settingKey of ['competitorBlocklist', 'brandDomains']) {
          const raw = await storage.getSetting(settingKey);
          if (raw) {
            const list = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
            const updated = list.filter((e: string) => e !== domain.toLowerCase());
            if (updated.length !== list.length) {
              await storage.setSetting(settingKey, updated.join(','));
            }
          }
        }
        res.json({ success: true, message: `${domain} classified as competitor` });
      } else if (sourceType === 'neutral') {
        // Remove from subdomain recognition if present
        const value = await storage.getSetting('competitorSubdomains');
        if (value) {
          const entries = value.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = entries.filter((e: string) => e !== domain.toLowerCase());
          if (updated.length !== entries.length) {
            await storage.setSetting('competitorSubdomains', updated.join(','));
          }
        }
        // Add to "Not Competitors" blocklist so it stays neutral
        const blockRaw = await storage.getSetting('competitorBlocklist');
        const blockList = blockRaw ? blockRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];
        if (!blockList.includes(domain.toLowerCase())) {
          blockList.push(domain.toLowerCase());
          await storage.setSetting('competitorBlocklist', blockList.join(','));
        }
        // Remove from brand domains if present
        const brandRaw = await storage.getSetting('brandDomains');
        if (brandRaw) {
          const brandList = brandRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = brandList.filter((e: string) => e !== domain.toLowerCase());
          if (updated.length !== brandList.length) {
            await storage.setSetting('brandDomains', updated.join(','));
          }
        }
        res.json({ success: true, message: `${domain} classified as neutral` });
      } else if (sourceType === 'brand') {
        const domainLower = domain.toLowerCase();
        // Add to brand domains
        const brandRaw = await storage.getSetting('brandDomains');
        const brandList = brandRaw ? brandRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        if (!brandList.includes(domainLower)) {
          brandList.push(domainLower);
          await storage.setSetting('brandDomains', brandList.join(','));
        }
        // Remove from blocklist and competitor subdomains if present
        const blockRaw = await storage.getSetting('competitorBlocklist');
        if (blockRaw) {
          const blockList = blockRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = blockList.filter((e: string) => e !== domainLower);
          if (updated.length !== blockList.length) {
            await storage.setSetting('competitorBlocklist', updated.join(','));
          }
        }
        const subRaw = await storage.getSetting('competitorSubdomains');
        if (subRaw) {
          const subList = subRaw.split(',').map((s: string) => s.trim()).filter(Boolean);
          const updated = subList.filter((e: string) => e !== domainLower);
          if (updated.length !== subList.length) {
            await storage.setSetting('competitorSubdomains', updated.join(','));
          }
        }
        res.json({ success: true, message: `${domain} classified as brand` });
      } else {
        res.status(400).json({ error: "sourceType must be 'competitor', 'neutral', or 'brand'" });
      }
    } catch (error) {
      console.error("Error reclassifying source:", error);
      res.status(500).json({ error: "Failed to reclassify source" });
    }
  });

  app.get("/api/sources/analysis", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      const topicId = req.query.topicId ? parseInt(req.query.topicId as string) : undefined;
      const { from, to } = parseDateRange(req);
      const allSources = await storage.getSources();

      // If topic filter is set, find which domains are cited in responses for that topic
      let topicDomains: Set<string> | null = null;
      if (topicId) {
        let responses = await storage.getResponsesWithPrompts(runId, from, to);
        if (model) responses = responses.filter(r => r.model === model);
        responses = responses.filter(r => r.prompt?.topicId === topicId);
        topicDomains = new Set<string>();
        for (const r of responses) {
          if (r.sources) {
            for (const s of r.sources) {
              try { topicDomains.add(new URL(s).hostname.replace(/^www\./, '')); } catch {}
            }
          }
          // Also check text for domain mentions
          for (const src of allSources) {
            if (r.text.toLowerCase().includes(src.domain.toLowerCase())) {
              topicDomains.add(src.domain.toLowerCase());
            }
          }
        }
      }

      // Derive source type dynamically from brand name and competitor list
      // Include merged competitors so their domains still match for classification
      // Exclude self-merged (blocked/reclassified) competitors
      const currentBrandName = getCurrentBrandName();
      const brandName = (currentBrandName || await storage.getSetting('brandName') || '').toLowerCase();
      const allCompetitors = (await storage.getAllCompetitorsIncludingMerged())
        .filter(c => c.mergedInto !== c.id);

      // Load subdomain recognition setting (default: "docs")
      // Entries without dots are prefixes (e.g. "docs" matches docs.*.com)
      // Entries with dots are exact domains (e.g. "techdocs.f5.com" maps to f5.com)
      const subdomainSetting = await storage.getSetting('competitorSubdomains');
      const subdomainEntries = (subdomainSetting
        ? subdomainSetting.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : ['docs']);
      const subdomainPrefixes = subdomainEntries.filter(e => !e.includes('.'));
      const exactSubdomainMap = new Map<string, string>(); // full domain → base domain
      for (const entry of subdomainEntries.filter(e => e.includes('.'))) {
        // "techdocs.f5.com" → strip first segment → "f5.com"
        const parts = entry.split('.');
        if (parts.length >= 3) {
          exactSubdomainMap.set(entry, parts.slice(1).join('.'));
        }
      }

      // Load blocklist (used for both competitor extraction AND source classification)
      const blocklistRaw = await storage.getSetting('competitorBlocklist');
      const blocklist = new Set(
        blocklistRaw
          ? blocklistRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
          : ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com']
      );

      // Load additional brand domains
      const brandDomainsRaw = await storage.getSetting('brandDomains');
      const brandDomains = new Set(
        brandDomainsRaw ? brandDomainsRaw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean) : []
      );

      // Build lookup: competitor domains (if set) + name-based matching
      const competitorDomains = new Set<string>();
      const competitorNameWords: string[][] = [];
      for (const c of allCompetitors) {
        if (c.domain) competitorDomains.add(c.domain.toLowerCase());
        competitorNameWords.push(c.name.toLowerCase().split(/\s+/));
      }

      // Strip recognized subdomain prefixes or resolve exact domains to base
      const stripSubdomain = (domain: string): string => {
        // Check exact domain map first
        const exact = exactSubdomainMap.get(domain);
        if (exact) return exact;
        // Then check prefixes
        for (const prefix of subdomainPrefixes) {
          if (domain.startsWith(prefix + '.')) {
            return domain.slice(prefix.length + 1);
          }
        }
        return domain;
      };

      const results = await Promise.all(allSources.map(async source => {
        // Skip sources not matching topic filter
        if (topicDomains && !topicDomains.has(source.domain.toLowerCase())) return null;
        const urls = await storage.getSourceUrlsBySourceId(source.id, runId, model);
        if (urls.length === 0) return null;

        const domainLower = source.domain.toLowerCase();
        const domainBase = domainLower.split('.')[0];
        const strippedDomain = stripSubdomain(domainLower);
        const strippedBase = strippedDomain.split('.')[0];
        let sourceType = 'neutral';
        if (brandDomains.has(domainLower) || brandDomains.has(strippedDomain)) {
          // Explicitly marked as brand domain
          sourceType = 'brand';
        } else if (blocklist.has(domainLower) || blocklist.has(strippedDomain) || blocklist.has(domainBase)) {
          // In the "Not Competitors" list — force neutral
        } else if (brandName && (domainLower.includes(brandName) || brandName.includes(domainBase) || strippedDomain.includes(brandName) || brandName.includes(strippedBase))) {
          sourceType = 'brand';
        } else if (
          competitorDomains.has(domainLower) ||
          competitorDomains.has(strippedDomain) ||
          competitorNameWords.some(words => words.some(w => domainBase.includes(w) || w.includes(domainBase) || strippedBase.includes(w) || w.includes(strippedBase)))
        ) {
          sourceType = 'competitor';
        }

        return {
          sourceId: source.id,
          domain: source.domain,
          sourceType,
          citationCount: urls.length,
          urls
        };
      }));
      res.json(results.filter(Boolean));
    } catch (error) {
      console.error("Error fetching source analysis:", error);
      res.status(500).json({ error: "Failed to fetch source analysis" });
    }
  });

  // --- Watched URLs (Source Watchlist) ---

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

  // Get responses that cite a specific domain
  app.get("/api/sources/:domain/responses", async (req, res) => {
    // #swagger.tags = ['Sources']
    try {
      const domain = req.params.domain;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const model = (req.query.model || req.query.provider) as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (model) allResponses = allResponses.filter(r => r.model === model);
      // Filter responses that cite this domain (in text body OR sources array)
      const domainLower = domain.toLowerCase();
      const matching = allResponses.filter(r =>
        r.text.toLowerCase().includes(domainLower) ||
        (r.sources && r.sources.some(s => s.toLowerCase().includes(domainLower)))
      );
      res.json(matching);
    } catch (error) {
      console.error("Error fetching responses for domain:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });
}
