import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { loadBrandName, launchAnalysis } from "./routes/helpers";
import { registerAuthRoutes, registerAuthGuard, registerAuthProviderRoutes } from "./routes/auth";
import { registerUserRoutes } from "./routes/users";
import { registerMetricsRoutes } from "./routes/metrics";
import { registerTopicRoutes } from "./routes/topics";
import { registerCompetitorRoutes } from "./routes/competitors";
import { registerSourceRoutes } from "./routes/sources";
import { registerResponseRoutes } from "./routes/responses";
import { registerAnalysisRoutes } from "./routes/analysis";
import { registerSettingsRoutes } from "./routes/settings";

// Re-export for scheduler
export { launchAnalysis } from "./routes/helpers";

export async function registerRoutes(app: Express): Promise<Server> {
  // Load persisted brand name from DB
  await loadBrandName();

  // Load DB settings into env
  try {
    const { loadSettingsIntoEnv } = await import('./services/settings');
    await loadSettingsIntoEnv();
  } catch (error) {
    console.error('[STARTUP] Failed to load settings from DB:', error);
  }

  // --- Public routes (before auth guard) ---
  registerAuthRoutes(app);

  // --- Auth guard (protects all subsequent /api/* routes) ---
  await registerAuthGuard(app);

  // --- Protected routes ---
  registerUserRoutes(app);
  registerAuthProviderRoutes(app);
  registerMetricsRoutes(app);
  registerTopicRoutes(app);
  registerCompetitorRoutes(app);
  registerSourceRoutes(app);
  registerResponseRoutes(app);
  registerAnalysisRoutes(app);
  registerSettingsRoutes(app);

  // --- Startup: crash recovery + scheduler ---
  try {
    const { isAnalysisRunningInDB } = await import('./services/analyzer');
    const isRunning = await isAnalysisRunningInDB();
    if (isRunning) {
      console.log('[STARTUP] Found a stalled analysis run — recovering...');
      const latestRun = await storage.getLatestAnalysisRun();
      if (latestRun && latestRun.status === 'running') {
        const { BrandAnalyzer } = await import('./services/analyzer');
        const worker = new BrandAnalyzer();
        const brandName = latestRun.brandName || '';
        worker.setBrandName(brandName);
        worker.setAnalysisRunId(latestRun.id);
        if (latestRun.brandUrl) worker.setBrandUrl(latestRun.brandUrl);
        worker.runFullAnalysis(true).then(async () => {
          await storage.completeAnalysisRun(latestRun.id, 'complete');
          console.log(`[STARTUP] Recovered analysis run #${latestRun.id} completed`);
        }).catch(async (error) => {
          await storage.completeAnalysisRun(latestRun.id, 'error');
          console.error('[STARTUP] Recovered analysis run failed:', error);
        });
      }
    }
  } catch (error) {
    console.error('[STARTUP] Crash recovery failed:', error);
  }

  // Initialize scheduler
  try {
    const { initScheduler, setLauncher } = await import('./services/scheduler');
    setLauncher(launchAnalysis);
    await initScheduler();
  } catch (error) {
    console.error('[STARTUP] Scheduler init failed:', error);
  }

  // Check browser availability
  try {
    const browserUrl = process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888';
    const res = await fetch(`${browserUrl}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (res?.ok) {
      console.log(`[STARTUP] Browser actor available at ${browserUrl}`);
    } else {
      console.log(`[STARTUP] Browser actor not available at ${browserUrl} — using Apify Cloud if configured`);
    }
  } catch {}

  const httpServer = createServer(app);
  return httpServer;
}
