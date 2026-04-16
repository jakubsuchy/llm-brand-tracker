import type { Express } from "express";
import { parseDateRange, getCurrentBrandName } from "./helpers";
import { storage } from "../storage";

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
        res.json({ success: true, message: `${domain} classified as neutral` });
      } else {
        res.status(400).json({ error: "sourceType must be 'competitor' or 'neutral'" });
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
        if (brandName && (domainLower.includes(brandName) || brandName.includes(domainBase) || strippedDomain.includes(brandName) || brandName.includes(strippedBase))) {
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
