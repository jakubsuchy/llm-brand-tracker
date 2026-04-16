import { storage } from "../storage";
import { BrandAnalyzer } from "../services/analyzer";

// Role-based route middleware. Admin always passes.
export function requireRole(...requiredRoles: string[]) {
  return (req: any, res: any, next: any) => {
    const userRoles: string[] = req.user?.roles || [];
    if (userRoles.includes('admin')) return next();
    if (!userRoles.some((r: string) => requiredRoles.includes(r))) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

// Parse optional from/to date range from query params
export function parseDateRange(req: any): { from?: Date; to?: Date } {
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;
  return {
    from: from && !isNaN(from.getTime()) ? from : undefined,
    to: to && !isNaN(to.getTime()) ? to : undefined,
  };
}

// Dynamic LLM module resolver
export async function getLlmModule() {
  const { getSetting } = await import('../services/settings');
  const provider = await getSetting('analysisLlm') || 'openai';
  return provider === 'anthropic'
    ? await import('../services/anthropic')
    : await import('../services/openai');
}

// Brand name for filtering — loaded from DB on startup, persisted on change
let currentBrandName: string = '';

export function getCurrentBrandName() { return currentBrandName; }

export async function loadBrandName() {
  try {
    const saved = await storage.getSetting('brandName');
    if (saved) currentBrandName = saved;
    console.log(`[DEBUG] Loaded brandName from DB: "${currentBrandName}"`);
  } catch {}
}

export async function saveBrandName(name: string) {
  currentBrandName = name;
  await storage.setSetting('brandName', name);
}

// Shared analysis launcher — single source of truth
export async function launchAnalysis(brandUrl?: string, savedPrompts?: any[]) {
  if (brandUrl) {
    const { extractDomainFromUrl } = await import("../services/scraper");
    const domain = extractDomainFromUrl(brandUrl);
    await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
    await storage.setSetting('brandUrl', brandUrl);
  }
  if (!currentBrandName) {
    const savedUrl = await storage.getSetting('brandUrl');
    if (savedUrl) {
      const { extractDomainFromUrl } = await import("../services/scraper");
      const domain = extractDomainFromUrl(savedUrl);
      await saveBrandName(domain.split('.')[0].replace(/[^a-zA-Z]/g, ''));
    }
  }
  const brandName = currentBrandName;
  console.log(`[DEBUG] launchAnalysis: brandName="${brandName}", savedPrompts=${savedPrompts?.length ?? 'none'}`);

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

// Helper: compute per-model mention rates for a set of responses, return average
export function computeVisibilityScore(responses: { model?: string | null; prompt?: { text?: string | null } | null; brandMentioned?: boolean | null }[]) {
  const modelMap = new Map<string, Map<string, boolean>>();
  const allModels = new Set<string>();
  for (const r of responses) {
    const mdl = r.model || 'unknown';
    allModels.add(mdl);
    if (!modelMap.has(mdl)) modelMap.set(mdl, new Map());
    const promptMap = modelMap.get(mdl)!;
    const key = r.prompt?.text?.toLowerCase().trim() || '';
    if (!promptMap.has(key)) promptMap.set(key, false);
    if (r.brandMentioned) promptMap.set(key, true);
  }
  const rates = [...modelMap.values()].map(pm => {
    const total = pm.size;
    const mentioned = [...pm.values()].filter(Boolean).length;
    return total > 0 ? (mentioned / total) * 100 : 0;
  });
  const score = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  return { score, modelCount: allModels.size, modelMap };
}

export const DEFAULT_MODELS_CONFIG: Record<string, any> = {
  perplexity: { enabled: true, type: 'browser', label: 'Perplexity' },
  chatgpt: { enabled: true, type: 'browser', label: 'ChatGPT' },
  gemini: { enabled: true, type: 'browser', label: 'Google Gemini' },
  'google-aimode': { enabled: true, type: 'browser', label: 'Google AI Mode' },
};

export const DEFAULT_BLOCKLIST = ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];
