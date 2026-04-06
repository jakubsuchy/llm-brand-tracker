import type { Express } from "express";
import { createServer, type Server } from "http";
import passport from 'passport';
import { storage } from "./storage";
import { analyzer, BrandAnalyzer, cancelAnalysisRun, getAnalysisProgressFromDB, isAnalysisRunningInDB } from "./services/analyzer";
import { generatePromptsForTopic } from "./services/openai";
import { insertPromptSchema, insertResponseSchema } from "@shared/schema";

// Explicitly allows a route for the given role(s). Admin always passes.
// Also marks the request so the default admin guard doesn't block it.
function requireRole(...requiredRoles: string[]) {
  return (req: any, res: any, next: any) => {
    const userRoles: string[] = req.user?.roles || [];
    if (userRoles.includes('admin')) { req._roleChecked = true; return next(); }
    if (!userRoles.some((r: string) => requiredRoles.includes(r))) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    req._roleChecked = true;
    next();
  };
}

// Allows any authenticated user (no specific role needed).
function anyUser() {
  return (req: any, _res: any, next: any) => {
    req._roleChecked = true;
    next();
  };
}

// Brand name for filtering — loaded from DB on startup, persisted on change
let currentBrandName: string = '';

async function loadBrandName() {
  try {
    const saved = await storage.getSetting('brandName');
    if (saved) currentBrandName = saved;
    console.log(`[DEBUG] Loaded brandName from DB: "${currentBrandName}"`);
  } catch {}
}

async function saveBrandName(name: string) {
  currentBrandName = name;
  await storage.setSetting('brandName', name);
}

// Shared analysis launcher — single source of truth
async function launchAnalysis(brandUrl?: string, savedPrompts?: any[]) {
  // Extract brand name from URL, or keep existing, or recover from DB
  if (brandUrl) {
    const { extractDomainFromUrl } = await import("./services/scraper");
    const domain = extractDomainFromUrl(brandUrl);
    await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
    await storage.setSetting('brandUrl', brandUrl);
  }
  if (!currentBrandName) {
    // Try to recover from saved brandUrl in DB
    const savedUrl = await storage.getSetting('brandUrl');
    if (savedUrl) {
      const { extractDomainFromUrl } = await import("./services/scraper");
      const domain = extractDomainFromUrl(savedUrl);
      await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
    }
  }
  const brandName = currentBrandName;
  console.log(`[DEBUG] launchAnalysis: brandName="${brandName}", savedPrompts=${savedPrompts?.length ?? 'none'}`);

  // Create analysis run record
  const totalPrompts = savedPrompts?.length || (await storage.getPrompts()).length;
  const analysisRun = await storage.createAnalysisRun({
    status: 'running',
    brandName: brandName || null,
    brandUrl: brandUrl || null,
    totalPrompts,
    completedPrompts: 0
  });
  console.log(`[DEBUG] Created analysis run #${analysisRun.id}`);

  const sessionId = `analysis_${analysisRun.id}`;
  const analysisWorker = new BrandAnalyzer();
  analysisWorker.setBrandName(brandName);
  analysisWorker.setAnalysisRunId(analysisRun.id);
  if (brandUrl) {
    analysisWorker.setBrandUrl(brandUrl.trim());
  }

  const useExisting = !savedPrompts;
  analysisWorker.runFullAnalysis(useExisting, savedPrompts || undefined).then(async () => {
    await storage.completeAnalysisRun(analysisRun.id, 'complete');
    console.log(`[DEBUG] Analysis run #${analysisRun.id} completed`);
  }).catch(async (error) => {
    await storage.completeAnalysisRun(analysisRun.id, 'error');
    console.error("Analysis failed:", error);
  });

  return sessionId;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Load persisted brand name from DB
  await loadBrandName();

  // Load persisted response method
  try {
    const { setResponseMethod } = await import('./services/openai');
    const savedMethod = await storage.getSetting('responseMethod');
    if (savedMethod === 'browser' || savedMethod === 'api') {
      setResponseMethod(savedMethod);
    }
  } catch {}

  // --- Load DB settings into env ---
  try {
    const { loadSettingsIntoEnv } = await import('./services/settings');
    await loadSettingsIntoEnv();
  } catch (error) {
    console.error('[STARTUP] Failed to load settings from DB:', error);
  }

  // --- Public auth routes (no auth required) ---
  app.get("/api/auth/needs-setup", async (req, res) => {
    const { getUserCount, getAuthProviderConfig } = await import('./services/auth');
    const count = await getUserCount();
    const config = await getAuthProviderConfig();
    res.json({
      needsSetup: count === 0,
      googleEnabled: !!config.google?.enabled,
      samlEnabled: !!config.saml?.enabled,
    });
  });

  app.get("/api/auth/session", async (req, res) => {
    if (req.isAuthenticated()) {
      const { getAuthProviderConfig } = await import('./services/auth');
      const config = await getAuthProviderConfig();
      res.json({
        user: { ...req.user, apiKey: req.user!.apiKey },
        googleEnabled: !!config.google?.enabled,
        samlEnabled: !!config.saml?.enabled,
      });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || 'Invalid credentials' });
      req.logIn(user, (err) => {
        if (err) return next(err);
        res.json({ user });
      });
    })(req, res, next);
  });

  // Google OAuth routes (dynamic — check if strategy is registered)
  app.get("/api/auth/google", (req, res, next) => {
    if (!(passport as any)._strategy('google')) return res.status(404).json({ message: "Google auth not configured" });
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  app.get("/api/auth/google/callback",
    (req, res, next) => {
      if (!(passport as any)._strategy('google')) return res.redirect('/login?error=google');
      passport.authenticate('google', { failureRedirect: '/login?error=google' })(req, res, next);
    },
    (req, res) => { res.redirect('/'); }
  );

  // SAML routes (dynamic — check if strategy is registered)
  app.get("/api/auth/saml", (req, res, next) => {
    if (!(passport as any)._strategy('saml')) return res.status(404).json({ message: "SAML auth not configured" });
    passport.authenticate('saml')(req, res, next);
  });

  app.post("/api/auth/saml/callback",
    (req, res, next) => {
      if (!(passport as any)._strategy('saml')) return res.redirect('/login?error=saml');
      passport.authenticate('saml', { failureRedirect: '/login?error=saml' })(req, res, next);
    },
    (req, res) => { res.redirect('/'); }
  );

  // SAML metadata endpoint
  app.get("/api/auth/saml/metadata", (req, res) => {
    const strategy = (passport as any)._strategy('saml') as any;
    if (!strategy) return res.status(404).json({ message: "SAML not configured" });
    res.type('application/xml').send(strategy.generateServiceProviderMetadata());
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ success: true });
    });
  });

  app.post("/api/initialize", async (req, res) => {
    try {
      const { getUserCount, createUser, assignRole } = await import('./services/auth');
      if (await getUserCount() > 0) return res.status(403).json({ message: "Already initialized" });
      const { email, fullName, password } = req.body;
      if (!email || !fullName || !password) return res.status(400).json({ message: "All fields required" });
      const user = await createUser(email, fullName, password);
      await assignRole(user.id, 'admin');
      await assignRole(user.id, 'analyst');
      await assignRole(user.id, 'user');
      res.json({ success: true });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  // --- Auth guard: protect all subsequent API routes ---
  // Default: require admin role. Routes that allow lower roles must
  // explicitly use requireRole('analyst') or requireRole('user') which
  // will run BEFORE this check (Express middleware runs in order).
  const { PUBLIC_API_PATHS } = await import('./config');
  app.use("/api", (req, res, next) => {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    // If a previous requireRole middleware already called next(), we're here
    // and the role was sufficient. If no requireRole ran, require admin.
    if ((req as any)._roleChecked) return next();
    const userRoles: string[] = (req.user as any)?.roles || [];
    if (userRoles.includes('admin')) return next();
    res.status(403).json({ message: "Admin access required" });
  });

  // --- User management routes (admin only) ---
  app.get("/api/users", requireRole('admin'), async (req, res) => {
    const { getAllUsersWithRoles } = await import('./services/auth');
    const users = await getAllUsersWithRoles();
    res.json(users.map(u => ({ id: u.id, email: u.email, fullName: u.fullName, roles: u.roles, createdAt: u.createdAt, googleId: !!u.googleId })));
  });

  app.post("/api/users", requireRole('admin'), async (req, res) => {
    try {
      const { createUser, assignRole } = await import('./services/auth');
      const { email, fullName, password, roles } = req.body;
      if (!email || !fullName || !password) return res.status(400).json({ message: "All fields required" });
      const user = await createUser(email, fullName, password);
      for (const role of (roles || ['user'])) await assignRole(user.id, role);
      res.json({ id: user.id, email: user.email, fullName: user.fullName });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id", requireRole('admin'), async (req, res) => {
    try {
      const { db } = await import('./db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      const { email, fullName } = req.body;
      if (!email || !fullName) return res.status(400).json({ message: "Email and full name required" });
      const result = await db.update(users).set({ email, fullName }).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ id: result[0].id, email: result[0].email, fullName: result[0].fullName });
    } catch (err: any) {
      if (err.code === '23505') return res.status(409).json({ message: "Email already exists" });
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/users/:id/password", requireRole('admin'), async (req, res) => {
    try {
      const { hashPassword } = await import('./services/auth');
      const { db } = await import('./db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      const { password } = req.body;
      if (!password) return res.status(400).json({ message: "Password required" });
      const { hash, salt } = await hashPassword(password);
      const result = await db.update(users).set({ hashedPassword: hash, salt }).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/users/:id/roles", requireRole('admin'), async (req, res) => {
    try {
      const { removeUserRoles, assignRole } = await import('./services/auth');
      const userId = parseInt(req.params.id);
      const { roles } = req.body;
      if (!roles || !Array.isArray(roles)) return res.status(400).json({ message: "Roles array required" });
      // Prevent removing your own admin role
      if (userId === req.user!.id && req.user!.roles.includes('admin') && !roles.includes('admin')) {
        return res.status(400).json({ message: "You cannot remove your own admin role" });
      }
      await removeUserRoles(userId);
      for (const role of roles) await assignRole(userId, role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/users/:id", requireRole('admin'), async (req, res) => {
    try {
      const { removeUserRoles } = await import('./services/auth');
      const { db } = await import('./db');
      const { users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const userId = parseInt(req.params.id);
      if (userId === req.user!.id) {
        return res.status(400).json({ message: "You cannot delete your own account" });
      }
      await removeUserRoles(userId);
      const result = await db.delete(users).where(eq(users.id, userId)).returning();
      if (result.length === 0) return res.status(404).json({ message: "User not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // --- API key regeneration (admin or self) ---
  app.post("/api/users/:id/api-key", anyUser(), async (req, res) => {
    const userId = parseInt(req.params.id);
    // Allow admin or self
    if (req.user!.id !== userId && !req.user!.roles.includes('admin')) {
      return res.status(403).json({ message: "Can only regenerate your own key" });
    }
    const { regenerateApiKey } = await import('./services/auth');
    const newKey = await regenerateApiKey(userId);
    res.json({ apiKey: newKey });
  });

  // --- Auth provider configuration (admin only) ---
  app.get("/api/auth/providers", requireRole('admin'), async (req, res) => {
    const { getAuthProviderConfig } = await import('./services/auth');
    const config = await getAuthProviderConfig();
    // Mask secrets: show only whether they're set
    res.json({
      google: config.google
        ? { ...config.google, clientSecret: config.google.clientSecret ? '••••••••' : '' }
        : { enabled: false, clientId: '', clientSecret: '' },
      saml: config.saml
        ? { ...config.saml, cert: config.saml.cert ? '(configured)' : '' }
        : { enabled: false, entryPoint: '', issuer: '', cert: '' },
    });
  });

  app.post("/api/auth/providers", requireRole('admin'), async (req, res) => {
    const { saveAuthProviderConfig, configureAuthProviders } = await import('./services/auth');
    await saveAuthProviderConfig(req.body);
    await configureAuthProviders();
    res.json({ success: true });
  });

  // --- Crash recovery ---
  try {
    const recovered = await storage.recoverStalledJobs();
    if (recovered > 0) {
      console.log(`[RECOVERY] Reset ${recovered} stalled jobs back to pending`);
    }

    const latestRun = await storage.getLatestAnalysisRun();
    if (latestRun && latestRun.status === 'running') {
      const progress = await storage.getJobQueueProgress(latestRun.id);
      if (progress.pending > 0 || progress.processing > 0) {
        // Resume the worker loop in the background
        console.log(`[RECOVERY] Resuming analysis run #${latestRun.id} (${progress.pending} pending, ${progress.processing} processing)`);
        const resumeWorker = new BrandAnalyzer();
        resumeWorker.setBrandName(latestRun.brandName || currentBrandName);
        resumeWorker.setAnalysisRunId(latestRun.id);
        if (latestRun.brandUrl) resumeWorker.setBrandUrl(latestRun.brandUrl);

        // Default to serial (browser-safe) on resume — we don't know what providers are queued
        resumeWorker.runWorkerLoop(latestRun.id, true).then(async () => {
          await resumeWorker.generateAnalytics();
          await storage.completeAnalysisRun(latestRun.id, 'complete');
          console.log(`[RECOVERY] Analysis run #${latestRun.id} completed after resume`);
        }).catch(async (error) => {
          await storage.completeAnalysisRun(latestRun.id, 'error');
          console.error(`[RECOVERY] Analysis run #${latestRun.id} failed after resume:`, error);
        });
      } else if (progress.total > 0) {
        // All jobs done but run still marked 'running' — complete it
        console.log(`[RECOVERY] Analysis run #${latestRun.id} has all jobs done, marking complete`);
        await storage.completeAnalysisRun(latestRun.id, 'complete');
      }
    }
  } catch (error) {
    console.error('[RECOVERY] Crash recovery failed:', error);
  }

  // --- Browser actor health check ---
  try {
    const { isBrowserAvailable } = await import('./services/chatgpt-browser');
    if (process.env.APIFY_TOKEN) {
      console.log('[STARTUP] Browser mode: Apify Cloud (APIFY_TOKEN set)');
    } else if (await isBrowserAvailable()) {
      console.log(`[STARTUP] Browser mode: local container (${process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888'})`);
    } else {
      console.log('[STARTUP] Browser actor not available — browser providers disabled, API-only mode');
      if (!process.env.APIFY_TOKEN) {
        console.log('[STARTUP] To enable browser providers: set APIFY_TOKEN or start with --profile browser');
      }
    }
  } catch (error) {
    console.error('[STARTUP] Browser health check failed:', error);
  }

  // Test analysis endpoint - process just one prompt
  app.post("/api/test-analysis", async (req, res) => {
    try {
      const { prompt } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      console.log(`[${new Date().toISOString()}] Testing analysis with prompt: ${prompt}`);
      
      const { analyzePromptResponse } = await import('./services/openai');
      const result = await analyzePromptResponse(prompt);
      
      console.log(`[${new Date().toISOString()}] Test analysis completed successfully`);
      
      res.json({ 
        success: true, 
        result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Test analysis failed:`, error);
      res.status(500).json({ 
        error: "Test analysis failed", 
        message: (error as Error).message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Test endpoint for debugging
  app.get("/api/test", async (req, res) => {
    try {
      res.json({ 
        success: true, 
        message: "Server is running",
        timestamp: new Date().toISOString(),
        env: {
          hasOpenAIKey: !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR),
          nodeEnv: process.env.NODE_ENV
        }
      });
    } catch (error) {
      console.error("Error in test endpoint:", error);
      res.status(500).json({ error: "Test endpoint failed" });
    }
  });

  // Per-provider brand mention rates
  app.get("/api/metrics/by-provider", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const allResponses = await storage.getResponsesWithPrompts(runId);

      // Group by provider, then by unique prompt text
      const providerMap = new Map<string, Map<string, boolean>>();
      for (const r of allResponses) {
        const prov = r.provider || 'unknown';
        if (!providerMap.has(prov)) providerMap.set(prov, new Map());
        const promptMap = providerMap.get(prov)!;
        const key = r.prompt?.text?.toLowerCase().trim() || '';
        if (!promptMap.has(key)) promptMap.set(key, false);
        if (r.brandMentioned) promptMap.set(key, true);
      }

      // Get display labels from provider config
      const defaultLabels: Record<string, string> = { perplexity: 'Perplexity', chatgpt: 'ChatGPT', gemini: 'Google Gemini' };
      const provConfigRaw = await storage.getSetting('providersConfig');
      const provConfig = provConfigRaw ? JSON.parse(provConfigRaw) : {};

      const results = [...providerMap.entries()].map(([provider, promptMap]) => {
        const total = promptMap.size;
        const mentioned = [...promptMap.values()].filter(Boolean).length;
        return {
          provider,
          label: provConfig[provider]?.label || defaultLabels[provider] || provider,
          total,
          mentioned,
          rate: total > 0 ? Math.round((mentioned / total) * 1000) / 10 : 0,
        };
      }).sort((a, b) => b.rate - a.rate);

      res.json(results);
    } catch (error) {
      console.error("Error fetching provider metrics:", error);
      res.status(500).json({ error: "Failed to fetch provider metrics" });
    }
  });

  // Overview metrics endpoint
  app.get("/api/metrics", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (provider) allResponses = allResponses.filter(r => r.provider === provider);

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
      if (runId || provider) {
        const sourcesWithUrls = await Promise.all(
          allSources.map(async s => {
            const urls = await storage.getSourceUrlsBySourceId(s.id, runId, provider);
            return urls.length > 0 ? s : null;
          })
        );
        const activeSources = sourcesWithUrls.filter(Boolean);
        domainCount = activeSources.length;
        sourceCount = activeSources.reduce((sum, s) => {
          return sum; // counted below
        }, 0);
        // Count total URLs for this run/provider
        let totalUrls = 0;
        for (const s of allSources) {
          const urls = await storage.getSourceUrlsBySourceId(s.id, runId, provider);
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
  app.get("/api/counts", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (provider) allResponses = allResponses.filter(r => r.provider === provider);
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

  // Topic analysis endpoint
  app.get("/api/topics", anyUser(), async (req, res) => {
    try {
      const topics = await storage.getTopics();
      res.json(topics);
    } catch (error) {
      console.error("Error fetching topics:", error);
      res.status(500).json({ error: "Failed to fetch topics" });
    }
  });

  // Get topics with their prompts (for prompt generator review)
  app.get("/api/topics/with-prompts", anyUser(), async (req, res) => {
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
    try {
      const promptId = parseInt(req.params.id);
      await storage.softDeletePrompt(promptId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting prompt:", error);
      res.status(500).json({ error: "Failed to delete prompt" });
    }
  });

  app.get("/api/topics/analysis", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      // Derive topic analysis from responses
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (provider) allResponses = allResponses.filter(r => r.provider === provider);
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

  // Competitor merge endpoints — registered BEFORE /api/competitors
  app.get("/api/competitors/merge-suggestions", anyUser(), async (req, res) => {
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

  app.get("/api/competitors/merge-history", anyUser(), async (req, res) => {
    try {
      const history = await storage.getMergeHistory();
      res.json(history);
    } catch (error) {
      console.error("Error fetching merge history:", error);
      res.status(500).json({ error: "Failed to fetch merge history" });
    }
  });

  // Competitor analysis endpoint
  app.get("/api/competitors", anyUser(), async (req, res) => {
    try {
      const competitors = await storage.getCompetitors();
      res.json(competitors);
    } catch (error) {
      console.error("Error fetching competitors:", error);
      res.status(500).json({ error: "Failed to fetch competitors" });
    }
  });

  app.get("/api/competitors/analysis", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;

      // Unified approach: count unique prompts where each competitor was mentioned
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (provider) allResponses = allResponses.filter(r => r.provider === provider);

      // Count unique prompts total
      const uniquePrompts = new Set(allResponses.map(r => r.prompt?.text?.toLowerCase().trim() || ''));
      const totalUniquePrompts = uniquePrompts.size;

      // For each competitor: count unique prompts where they were mentioned
      const competitorPrompts = new Map<string, Set<string>>();
      for (const r of allResponses) {
        const promptKey = r.prompt?.text?.toLowerCase().trim() || '';
        if (r.competitorsMentioned && Array.isArray(r.competitorsMentioned)) {
          for (const name of r.competitorsMentioned) {
            if (!competitorPrompts.has(name)) competitorPrompts.set(name, new Set());
            competitorPrompts.get(name)!.add(promptKey);
          }
        }
      }

      const allCompetitors = await storage.getCompetitors();
      const compByName = new Map(allCompetitors.map(c => [c.name.toLowerCase(), c]));

      const analysis = [...competitorPrompts.entries()].map(([name, prompts]) => {
        const comp = compByName.get(name.toLowerCase());
        const mentionCount = prompts.size;
        return {
          competitorId: comp?.id || 0,
          name: comp?.name || name,
          category: comp?.category || null,
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

  // Sources endpoints
  app.get("/api/sources", anyUser(), async (req, res) => {
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
          const { db: database } = await import("./db");
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

  app.get("/api/sources/analysis", anyUser(), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      const allSources = await storage.getSources();

      // Derive source type dynamically from brand name and competitor list
      // Include merged competitors so their domains still match for classification
      // Exclude self-merged (blocked/reclassified) competitors
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
        const urls = await storage.getSourceUrlsBySourceId(source.id, runId, provider);
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
  app.get("/api/sources/:domain/responses", anyUser(), async (req, res) => {
    try {
      const domain = req.params.domain;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      let allResponses = await storage.getResponsesWithPrompts(runId);
      if (provider) allResponses = allResponses.filter(r => r.provider === provider);
      // Filter responses whose text contains this domain
      const matching = allResponses.filter(r =>
        r.text.toLowerCase().includes(domain.toLowerCase())
      );
      res.json(matching);
    } catch (error) {
      console.error("Error fetching responses for domain:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });

  // Prompts endpoint - shows only latest analysis prompts
  app.get("/api/prompts", anyUser(), async (req, res) => {
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
  app.get("/api/responses", anyUser(), async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      const provider = req.query.provider as string | undefined;
      const useFullDataset = req.query.full === 'true' || limit > 100;

      let responses;
      if (useFullDataset) {
        responses = await storage.getResponsesWithPrompts(runId);
      } else {
        responses = await storage.getRecentResponses(limit, runId);
      }
      if (provider) responses = responses.filter(r => r.provider === provider);

      res.json(responses.slice(0, limit));
    } catch (error) {
      console.error("Error fetching responses:", error);
      res.status(500).json({ error: "Failed to fetch responses" });
    }
  });

  app.get("/api/responses/:id", anyUser(), async (req, res) => {
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

  // Test endpoint to verify server is working
  app.get("/api/test", (req, res) => {
    console.log(`[${new Date().toISOString()}] /api/test endpoint called`);
    res.json({ message: "Server is working", timestamp: new Date().toISOString() });
  });

  // New prompt generator endpoints
  app.post("/api/analyze-brand", requireRole("analyst"), async (req, res) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      console.log(`[${new Date().toISOString()}] Analyzing brand URL: ${url}`);

      // Persist brand name from URL
      const { extractDomainFromUrl } = await import("./services/scraper");
      const domain = extractDomainFromUrl(url);
      await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
      await storage.setSetting('brandUrl', url);
      console.log(`[${new Date().toISOString()}] Brand name set to: ${currentBrandName}`);

      // Use OpenAI to analyze the brand and find competitors
      const { analyzeBrandAndFindCompetitors } = await import("./services/openai");
      const competitors = await analyzeBrandAndFindCompetitors(url);
      
      console.log(`[${new Date().toISOString()}] Found ${competitors.length} competitors for ${url}`);

      res.json({ competitors });
    } catch (error) {
      console.error("Error analyzing brand:", error);
      res.status(500).json({ error: "Failed to analyze brand" });
    }
  });

  app.post("/api/generate-prompts", requireRole("analyst"), async (req, res) => {
    try {
      const { brandUrl, competitors, settings } = req.body;
      
      if (!brandUrl || !competitors || !settings) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Generate diverse topics and prompts using OpenAI
      const { generatePromptsForTopic } = await import("./services/openai");

      const customTopics: string[] = settings.customTopics || [];

      // Start with user-specified custom topics
      let topics: Array<{name: string, description: string}> = customTopics.map((name: string) => ({
        name,
        description: `Analysis of ${name.toLowerCase()} in the competitive landscape`
      }));

      // Fill remaining slots with AI-generated topics if needed
      const targetCount = Math.max(settings.numberOfTopics, customTopics.length);
      if (topics.length < targetCount) {
        const remaining = targetCount - topics.length;

        // Check existing DB topics first
        const existingTopics = await storage.getTopics();
        const existingMapped = existingTopics
          .filter(t => !customTopics.some(ct => ct.toLowerCase() === t.name.toLowerCase()))
          .map(topic => ({
            name: topic.name,
            description: topic.description || `Questions about ${topic.name.toLowerCase()}`
          }));

        if (existingMapped.length >= remaining) {
          topics = [...topics, ...existingMapped.slice(0, remaining)];
        } else {
          topics = [...topics, ...existingMapped];
          const stillNeeded = remaining - existingMapped.length;
          if (stillNeeded > 0) {
            const { generateDynamicTopics } = await import("./services/openai");
            const newTopics = await generateDynamicTopics(
              brandUrl,
              stillNeeded,
              competitors.map((c: any) => c.name)
            );
            topics = [...topics, ...newTopics];
          }
        }
      }

      // Generate prompts for all topics in parallel
      const competitorNames = competitors.map((c: any) => c.name);
      const topicsWithPrompts = await Promise.all(
        topics.map(async (topic) => {
          console.log(`[${new Date().toISOString()}] Generating prompts for topic: ${topic.name}`);
          try {
            const prompts = await generatePromptsForTopic(
              topic.name,
              topic.description,
              settings.promptsPerTopic,
              competitorNames
            );
            console.log(`[${new Date().toISOString()}] Generated ${prompts.length} prompts for topic: ${topic.name}`);
            return { name: topic.name, description: topic.description, prompts };
          } catch (error) {
            console.error(`[${new Date().toISOString()}] Error generating prompts for topic ${topic.name}:`, error);
            return { name: topic.name, description: topic.description, prompts: [] };
          }
        })
      );

      res.json({ topics: topicsWithPrompts });
    } catch (error) {
      console.error("Error generating prompts:", error);
      res.status(500).json({ error: "Failed to generate prompts" });
    }
  });

  app.post("/api/save-and-analyze", requireRole("analyst"), async (req, res) => {
    try {
      const { topics, brandUrl } = req.body;

      if (!topics || !Array.isArray(topics)) {
        return res.status(400).json({ error: "Topics array is required" });
      }

      // Build a set of incoming prompt texts for comparison
      const incomingPrompts = new Set<string>();
      for (const topic of topics) {
        for (const promptText of topic.prompts) {
          incomingPrompts.add(promptText.toLowerCase().trim());
        }
      }

      // Check existing prompts — deduplicate by text (keep first/lowest id)
      const rawExistingPrompts = await storage.getPrompts();
      const existingByText = new Map<string, typeof rawExistingPrompts[0]>();
      for (const p of rawExistingPrompts) {
        const key = p.text.toLowerCase().trim();
        if (!existingByText.has(key)) existingByText.set(key, p);
      }

      // Determine if prompts changed
      const promptsChanged = incomingPrompts.size !== existingByText.size ||
        [...incomingPrompts].some(p => !existingByText.has(p));

      let allPrompts;

      if (promptsChanged) {
        // Prompts differ — create new topic/prompt records for any that don't exist
        console.log(`[${new Date().toISOString()}] Prompts changed, syncing ${incomingPrompts.size} prompts`);
        const newPrompts = [];
        for (const topic of topics) {
          let topicRecord = await storage.getTopics().then(t =>
            t.find(existing => existing.name === topic.name)
          );
          if (!topicRecord) {
            topicRecord = await storage.createTopic({
              name: topic.name,
              description: topic.description
            });
          }
          for (const promptText of topic.prompts) {
            const key = promptText.toLowerCase().trim();
            const existing = existingByText.get(key);
            if (existing) {
              newPrompts.push(existing);
            } else {
              const prompt = await storage.createPrompt({
                text: promptText,
                topicId: topicRecord.id
              });
              newPrompts.push(prompt);
              existingByText.set(key, prompt); // prevent creating again in same batch
            }
          }
        }
        allPrompts = newPrompts;
      } else {
        // Same prompts — reuse existing deduplicated records
        console.log(`[${new Date().toISOString()}] Prompts unchanged, reusing ${existingByText.size} existing prompts`);
        allPrompts = [...existingByText.values()];
      }

      const sessionId = await launchAnalysis(brandUrl, allPrompts);

      res.json({
        success: true,
        message: promptsChanged
          ? `Prompts updated and analysis started (${allPrompts.length} prompts)`
          : `Analysis started with existing prompts (${allPrompts.length} prompts)`,
        promptCount: allPrompts.length,
        sessionId
      });
    } catch (error) {
      console.error("Error saving prompts and starting analysis:", error);
      res.status(500).json({ error: "Failed to save prompts and start analysis" });
    }
  });

  // Re-run analysis on existing prompts
  app.post("/api/analysis/start", requireRole("analyst"), async (req, res) => {
    try {
      const { brandUrl } = req.body || {};

      const existingPrompts = await storage.getPrompts();
      if (existingPrompts.length === 0) {
        return res.status(400).json({ error: "No prompts found. Use the Prompt Generator first." });
      }

      // brandUrl from client localStorage, or launchAnalysis will recover from DB
      const sessionId = await launchAnalysis(brandUrl || undefined, undefined);

      res.json({
        success: true,
        sessionId,
        message: `Analysis started with ${existingPrompts.length} existing prompts`
      });
    } catch (error) {
      console.error("Error starting analysis:", error);
      res.status(500).json({ error: "Failed to start analysis" });
    }
  });

  // List all analysis runs
  app.get("/api/analysis/runs", anyUser(), async (req, res) => {
    try {
      const runs = await storage.getAnalysisRuns();
      // Include response count per run, filter out empty runs
      const runsWithCounts = await Promise.all(
        runs.map(async (run) => {
          const responses = await storage.getResponsesWithPrompts(run.id);
          return { ...run, responseCount: responses.length };
        })
      );
      res.json(runsWithCounts.filter(r => r.responseCount > 0));
    } catch (error) {
      console.error("Error fetching analysis runs:", error);
      res.status(500).json({ error: "Failed to fetch analysis runs" });
    }
  });

  // Get failed jobs for the latest (or specific) analysis run
  app.get("/api/analysis/failures", requireRole("analyst"), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      let targetRunId = runId;
      if (!targetRunId) {
        const latestRun = await storage.getLatestAnalysisRun();
        targetRunId = latestRun?.id;
      }
      if (!targetRunId) {
        return res.json([]);
      }
      const failures = await storage.getFailedJobs(targetRunId);
      res.json(failures.map(j => ({
        id: j.id,
        provider: j.provider,
        promptText: j.promptText,
        error: j.lastError,
        attempts: j.attempts,
        failedAt: j.completedAt,
      })));
    } catch (error) {
      console.error("Error fetching failures:", error);
      res.status(500).json({ error: "Failed to fetch failures" });
    }
  });

  // Get all jobs for the latest (or specific) analysis run — compact view
  app.get("/api/analysis/jobs", requireRole("analyst"), async (req, res) => {
    try {
      const runId = req.query.runId ? parseInt(req.query.runId as string) : undefined;
      let targetRunId = runId;
      if (!targetRunId) {
        const latestRun = await storage.getLatestAnalysisRun();
        targetRunId = latestRun?.id;
      }
      if (!targetRunId) return res.json([]);

      const { jobQueue } = await import("@shared/schema");
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");

      const jobs = await db.select({
        id: jobQueue.id,
        provider: jobQueue.provider,
        promptText: jobQueue.promptText,
        status: jobQueue.status,
        attempts: jobQueue.attempts,
        maxAttempts: jobQueue.maxAttempts,
        lastError: jobQueue.lastError,
        originalJobId: jobQueue.originalJobId,
        lockedAt: jobQueue.lockedAt,
        completedAt: jobQueue.completedAt,
        createdAt: jobQueue.createdAt,
      }).from(jobQueue)
        .where(sql`${jobQueue.analysisRunId} = ${targetRunId}`)
        .orderBy(sql`${jobQueue.id} DESC`);

      res.json(jobs);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  // Apify usage statistics
  app.get("/api/apify-usage", anyUser(), async (req, res) => {
    try {
      const { apifyUsage } = await import("@shared/schema");
      const { db } = await import("./db");
      const { sql, desc } = await import("drizzle-orm");

      // Totals
      const [totals] = await db
        .select({
          totalCost: sql<number>`coalesce(sum(cost_usd), 0)`,
          totalRuns: sql<number>`count(*)`,
          totalDurationMs: sql<number>`coalesce(sum(duration_ms), 0)`,
          totalComputeUnits: sql<number>`coalesce(sum(compute_units), 0)`,
        })
        .from(apifyUsage);

      // Per-run breakdown (last 50)
      const runs = await db
        .select()
        .from(apifyUsage)
        .orderBy(desc(apifyUsage.createdAt))
        .limit(50);

      res.json({
        totals: {
          costUsd: Number(totals.totalCost),
          runs: Number(totals.totalRuns),
          durationMs: Number(totals.totalDurationMs),
          computeUnits: Number(totals.totalComputeUnits),
        },
        runs: runs.map(r => ({
          ...r,
          costUsd: Number(r.costUsd),
          durationMs: Number(r.durationMs),
          computeUnits: Number(r.computeUnits),
        })),
      });
    } catch (error) {
      console.error("Error fetching apify usage:", error);
      res.status(500).json({ error: "Failed to fetch apify usage" });
    }
  });

  // Get analysis progress for a specific session (reads from job_queue)
  app.get("/api/analysis/:sessionId/progress", async (req, res) => {
    try {
      // sessionId format: "analysis_<runId>"
      const progress = await getAnalysisProgressFromDB();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching analysis progress:", error);
      res.status(500).json({ error: "Failed to fetch analysis progress" });
    }
  });

  // Settings - Get brand info
  // API usage statistics
  app.get("/api/usage", anyUser(), async (req, res) => {
    try {
      const { apiUsage, analysisRuns } = await import("@shared/schema");
      const { db } = await import("./db");
      const { sql, eq, desc } = await import("drizzle-orm");

      // Get last 10 runs that have usage data
      const recentRunIds = await db
        .select({ id: analysisRuns.id })
        .from(analysisRuns)
        .orderBy(desc(analysisRuns.startedAt))
        .limit(10);
      const runIds = recentRunIds.map(r => r.id);

      // Per-run totals (only recent runs + null for outside-run calls)
      const allPerRun = await db
        .select({
          analysisRunId: apiUsage.analysisRunId,
          model: apiUsage.model,
          inputTokens: sql<number>`sum(${apiUsage.inputTokens})`,
          outputTokens: sql<number>`sum(${apiUsage.outputTokens})`,
          calls: sql<number>`count(*)`,
        })
        .from(apiUsage)
        .groupBy(apiUsage.analysisRunId, apiUsage.model);

      const perRun = allPerRun.filter(row =>
        row.analysisRunId === null || runIds.includes(row.analysisRunId)
      );

      // Grand totals
      const [totals] = await db
        .select({
          inputTokens: sql<number>`coalesce(sum(${apiUsage.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${apiUsage.outputTokens}), 0)`,
          calls: sql<number>`count(*)`,
        })
        .from(apiUsage);

      // Get run info for display
      const runs = await db.select().from(analysisRuns).orderBy(desc(analysisRuns.startedAt));
      const runMap = new Map(runs.map(r => [r.id, r]));

      const perRunWithInfo = perRun.map(row => ({
        ...row,
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        calls: Number(row.calls),
        run: row.analysisRunId ? runMap.get(row.analysisRunId) : null,
      }));

      res.json({
        totals: {
          inputTokens: Number(totals.inputTokens),
          outputTokens: Number(totals.outputTokens),
          totalTokens: Number(totals.inputTokens) + Number(totals.outputTokens),
          calls: Number(totals.calls),
        },
        perRun: perRunWithInfo,
      });
    } catch (error) {
      console.error("Error fetching usage:", error);
      res.status(500).json({ error: "Failed to fetch usage data" });
    }
  });

  app.get("/api/settings/brand", async (req, res) => {
    try {
      const brandUrl = await storage.getSetting('brandUrl');
      const brandName = await storage.getSetting('brandName');
      res.json({ brandUrl, brandName });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch brand settings" });
    }
  });

  app.post("/api/settings/brand", requireRole("admin"), async (req, res) => {
    try {
      const { brandUrl, brandName } = req.body;
      if (brandUrl !== undefined) await storage.setSetting('brandUrl', brandUrl);
      if (brandName !== undefined) {
        await storage.setSetting('brandName', brandName);
        currentBrandName = brandName;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save brand settings" });
    }
  });

  // Browser actor status check
  app.get("/api/settings/browser-status", requireRole("admin"), async (req, res) => {
    try {
      const hasApifyToken = !!process.env.APIFY_TOKEN;
      let localUp = false;
      try {
        const url = process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888';
        const res2 = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
        localUp = res2.ok;
      } catch {}
      // User-chosen mode from DB, or auto-detect
      const savedMode = await storage.getSetting('browserMode');
      let mode: string;
      if (savedMode === 'local' || savedMode === 'cloud') {
        mode = savedMode;
      } else {
        mode = hasApifyToken ? 'cloud' : (localUp ? 'local' : 'none');
      }
      res.json({ mode, hasApifyToken, localContainerUp: localUp });
    } catch {
      res.json({ mode: 'none', hasApifyToken: false, localContainerUp: false });
    }
  });

  app.post("/api/settings/browser-mode", requireRole("admin"), async (req, res) => {
    try {
      const { mode } = req.body;
      if (mode !== 'local' && mode !== 'cloud') {
        return res.status(400).json({ error: "Mode must be 'local' or 'cloud'" });
      }
      await storage.setSetting('browserMode', mode);
      res.json({ success: true, mode });
    } catch (error) {
      res.status(500).json({ error: "Failed to save browser mode" });
    }
  });

  // Settings - Providers configuration
  const DEFAULT_PROVIDERS_CONFIG: Record<string, any> = {
    perplexity: { enabled: true, type: 'browser', label: 'Perplexity' },
    chatgpt: { enabled: true, type: 'browser', label: 'ChatGPT' },
    gemini: { enabled: false, type: 'browser', label: 'Google Gemini' },
  };

  app.get("/api/settings/providers", anyUser(), async (req, res) => {
    try {
      const raw = await storage.getSetting('providersConfig');
      const config = raw ? JSON.parse(raw) : DEFAULT_PROVIDERS_CONFIG;
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch providers config" });
    }
  });

  app.post("/api/settings/providers", requireRole("admin"), async (req, res) => {
    try {
      const config = req.body;
      await storage.setSetting('providersConfig', JSON.stringify(config));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save providers config" });
    }
  });

  // Settings - Competitor subdomain prefixes
  app.get("/api/settings/competitor-subdomains", requireRole("admin"), async (req, res) => {
    try {
      const value = await storage.getSetting('competitorSubdomains');
      // Default to "docs" if not set
      const prefixes = value ? value.split(',').map(s => s.trim()).filter(Boolean) : ['docs'];
      res.json({ prefixes });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch subdomain settings" });
    }
  });

  app.post("/api/settings/competitor-subdomains", requireRole("admin"), async (req, res) => {
    try {
      const { prefixes } = req.body;
      if (!Array.isArray(prefixes)) {
        return res.status(400).json({ error: "prefixes must be an array of strings" });
      }
      const cleaned = prefixes.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      await storage.setSetting('competitorSubdomains', cleaned.join(','));
      res.json({ success: true, prefixes: cleaned });
    } catch (error) {
      res.status(500).json({ error: "Failed to save subdomain settings" });
    }
  });

  // Settings - Response method (browser vs API)
  app.get("/api/settings/response-method", requireRole("admin"), async (req, res) => {
    try {
      const { getResponseMethod } = await import('./services/openai');
      const method = getResponseMethod();
      const hasCreds = !!(process.env.CHATGPT_EMAIL && process.env.CHATGPT_PASSWORD);
      res.json({ method, browserAvailable: hasCreds });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch response method" });
    }
  });

  app.post("/api/settings/response-method", requireRole("admin"), async (req, res) => {
    try {
      const { method } = req.body;
      if (method !== 'browser' && method !== 'api') {
        return res.status(400).json({ error: "method must be 'browser' or 'api'" });
      }
      if (method === 'browser' && (!process.env.CHATGPT_EMAIL || !process.env.CHATGPT_PASSWORD)) {
        return res.status(400).json({ error: "CHATGPT_EMAIL and CHATGPT_PASSWORD environment variables are required for browser mode" });
      }
      const { setResponseMethod } = await import('./services/openai');
      setResponseMethod(method);
      await storage.setSetting('responseMethod', method);
      res.json({ success: true, method });
    } catch (error) {
      res.status(500).json({ error: "Failed to set response method" });
    }
  });

  // Settings - Competitor blocklist
  const DEFAULT_BLOCKLIST = ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];

  app.get("/api/settings/competitor-blocklist", requireRole("admin"), async (req, res) => {
    try {
      const value = await storage.getSetting('competitorBlocklist');
      const entries = value ? value.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_BLOCKLIST;
      res.json({ entries });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch blocklist" });
    }
  });

  app.post("/api/settings/competitor-blocklist", requireRole("admin"), async (req, res) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "entries must be an array of strings" });
      }
      const cleaned = entries.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      await storage.setSetting('competitorBlocklist', cleaned.join(','));
      res.json({ success: true, entries: cleaned });
    } catch (error) {
      res.status(500).json({ error: "Failed to save blocklist" });
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

      // Soft-remove: set merged_into to a sentinel value (-1) to hide from queries
      // We reuse the merged_into mechanism — setting it to the competitor's own id marks it as blocked
      const { db } = await import("./db");
      const { competitors, competitorMentions } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");

      // Delete mentions so they don't count in analysis
      await db.delete(competitorMentions).where(eq(competitorMentions.competitorId, competitorId));

      // Also handle anything merged into this competitor
      const mergedInto = allComps.filter(c => c.mergedInto === competitorId);
      for (const m of mergedInto) {
        await db.delete(competitorMentions).where(eq(competitorMentions.competitorId, m.id));
        await db.update(competitors).set({ mergedInto: competitorId }).where(eq(competitors.id, m.id));
      }

      // Mark competitor as blocked by setting merged_into to its own id
      await db.update(competitors).set({ mergedInto: competitorId }).where(eq(competitors.id, competitorId));

      res.json({ success: true, blocked: comp.name });
    } catch (error) {
      console.error("Error blocking competitor:", error);
      res.status(500).json({ error: "Failed to block competitor" });
    }
  });

  // Settings - Save OpenAI API Key
  app.post("/api/settings/openai-key", requireRole("admin"), async (req, res) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
        return res.status(400).json({ error: "Invalid API key format" });
      }

      // Test the API key by making a simple request
      const testResponse = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!testResponse.ok) {
        return res.status(400).json({ error: "Invalid API key or OpenAI service unavailable" });
      }

      // Store in DB and update env
      const { setSetting } = await import('./services/settings');
      await setSetting('openaiApiKey', apiKey);

      res.json({ success: true, message: "API key saved and validated" });
    } catch (error) {
      console.error("Error saving API key:", error);
      res.status(500).json({ error: "Failed to save API key" });
    }
  });

  // Settings - Save Apify Token
  app.post("/api/settings/apify-token", requireRole("admin"), async (req, res) => {
    try {
      const { token } = req.body;

      if (token) {
        // Validate the token by fetching user info
        const testRes = await fetch('https://api.apify.com/v2/users/me', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!testRes.ok) {
          return res.status(400).json({ error: "Invalid Apify token" });
        }
      }

      const { setSetting } = await import('./services/settings');
      await setSetting('apifyToken', token || '');

      res.json({ success: true, message: token ? "Apify token saved and validated" : "Apify token removed" });
    } catch (error) {
      console.error("Error saving Apify token:", error);
      res.status(500).json({ error: "Failed to save Apify token" });
    }
  });

  // Settings - Get Apify Token status
  app.get("/api/settings/apify-token", requireRole("admin"), async (req, res) => {
    try {
      const { getSetting } = await import('./services/settings');
      const token = await getSetting('apifyToken');
      res.json({ hasToken: !!token });
    } catch (error) {
      res.status(500).json({ error: "Failed to check Apify token" });
    }
  });

  // Settings - Get OpenAI key status
  app.get("/api/settings/openai-key", requireRole("admin"), async (req, res) => {
    try {
      const { getSetting } = await import('./services/settings');
      const key = await getSetting('openaiApiKey');
      res.json({ hasKey: !!key });
    } catch (error) {
      res.status(500).json({ error: "Failed to check OpenAI key" });
    }
  });

  // Settings - Save ChatGPT credentials
  app.post("/api/settings/chatgpt-credentials", requireRole("admin"), async (req, res) => {
    try {
      const { email, password, totpSecret } = req.body;
      const { setSetting } = await import('./services/settings');
      if (email !== undefined) await setSetting('chatgptEmail', email || '');
      if (password !== undefined) await setSetting('chatgptPassword', password || '');
      if (totpSecret !== undefined) await setSetting('chatgptTotpSecret', totpSecret || '');
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving ChatGPT credentials:", error);
      res.status(500).json({ error: "Failed to save credentials" });
    }
  });

  app.get("/api/settings/chatgpt-credentials", requireRole("admin"), async (req, res) => {
    try {
      const { getSetting } = await import('./services/settings');
      const email = await getSetting('chatgptEmail');
      const password = await getSetting('chatgptPassword');
      const totpSecret = await getSetting('chatgptTotpSecret');
      res.json({
        hasEmail: !!email,
        hasPassword: !!password,
        hasTotpSecret: !!totpSecret,
        email: email || '',  // email is not secret, can show it
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check credentials" });
    }
  });

  // Settings - Save Analysis Configuration
  app.post("/api/settings/analysis-config", requireRole("admin"), async (req, res) => {
    try {
      const { promptsPerTopic, analysisFrequency } = req.body;
      
      if (!promptsPerTopic || typeof promptsPerTopic !== 'number' || promptsPerTopic < 1 || promptsPerTopic > 20) {
        return res.status(400).json({ error: "Invalid prompts per topic value" });
      }

      if (!analysisFrequency || !['manual', 'daily', 'weekly', 'monthly'].includes(analysisFrequency)) {
        return res.status(400).json({ error: "Invalid analysis frequency value" });
      }

      // Store configuration in environment variables (in production, use secure storage)
      process.env.PROMPTS_PER_TOPIC = promptsPerTopic.toString();
      process.env.ANALYSIS_FREQUENCY = analysisFrequency;
      
      res.json({ success: true, message: "Analysis configuration saved successfully" });
    } catch (error) {
      console.error("Error saving analysis config:", error);
      res.status(500).json({ error: "Failed to save analysis configuration" });
    }
  });

  // Analysis Progress - Get current progress (reads from job_queue table)
  app.get("/api/analysis/progress", requireRole("analyst"), async (req, res) => {
    try {
      const progress = await getAnalysisProgressFromDB();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching analysis progress:", error);
      res.status(500).json({ error: "Failed to fetch analysis progress" });
    }
  });

  // Cancel analysis (DB-based)
  app.post("/api/analysis/cancel", requireRole("analyst"), async (req, res) => {
    try {
      await cancelAnalysisRun();
      res.json({
        success: true,
        message: "Analysis cancelled successfully"
      });
    } catch (error) {
      console.error("Error cancelling analysis:", error);
      res.status(500).json({ error: "Failed to cancel analysis" });
    }
  });

  // Analysis Progress - Start new analysis
  // Export data
  app.get("/api/export", anyUser(), async (req, res) => {
    try {
      const topics = await storage.getTopics();
      const prompts = await storage.getPrompts();
      const responses = await storage.getResponses();
      const competitors = await storage.getCompetitors();
      const sources = await storage.getSources();
      const analytics = await storage.getLatestAnalytics();
      
      const exportData = {
        timestamp: new Date().toISOString(),
        analytics,
        topics,
        prompts,
        responses,
        competitors,
        sources
      };
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="my-brand-analysis-${Date.now()}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error("Error exporting data:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  });

  // Generate prompts for a single custom topic
  app.post('/api/generate-topic-prompts', async (req, res) => {
    try {
      const { topicName, topicDescription, competitors, promptCount } = req.body;
      
      if (!topicName || !topicDescription) {
        return res.status(400).json({ error: 'Topic name and description are required' });
      }

      const competitorNames = competitors?.map((c: any) => c.name) || [];
      const prompts = await generatePromptsForTopic(
        topicName,
        topicDescription,
        promptCount || 5,
        competitorNames
      );

      res.json({ prompts });
    } catch (error) {
      console.error('Error generating topic prompts:', error);
      res.status(500).json({ error: 'Failed to generate topic prompts' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
