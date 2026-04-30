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

// Domains that are always hidden from Sources/Pages views regardless of
// classification. Used for citation-noise like myactivity.google.com that
// LLMs occasionally surface as "sources" even though they aren't real
// references. Editable from Settings → Sources → URL Blacklist.
export const DEFAULT_SOURCE_BLACKLIST = ['myactivity.google.com'];

// Returns the blacklist as a Set of lowercased domains. Falls back to the
// default when the setting is unset (fresh install).
export async function getSourceBlacklist(): Promise<Set<string>> {
  const raw = await storage.getSetting('sourceBlacklist');
  const list = raw === null
    ? DEFAULT_SOURCE_BLACKLIST
    : raw.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
  return new Set(list);
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

  // Auto-discover brand URLs via sitemap.xml (checked by default in Settings →
  // Brand). Inserts as source='sitemap', ignore_query_strings=true so any
  // cited variant (?utm=..., ?page=2, ...) matches. ON CONFLICT DO NOTHING
  // preserves any manual entries already on the list. Failures are logged
  // and swallowed — they must not block the analysis from starting.
  await ingestBrandSitemap().catch((err) => {
    console.warn('[sitemap-ingest] failed but continuing:', err?.message || err);
  });

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
    const { fireWebhook } = await import('../services/webhook');
    fireWebhook(analysisRun.id, 'complete');
  }).catch(async (error) => {
    await storage.completeAnalysisRun(analysisRun.id, 'error');
    console.error("Analysis failed:", error);
    const { fireWebhook } = await import('../services/webhook');
    fireWebhook(analysisRun.id, 'error');
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
  'openai-api': { enabled: false, type: 'api', label: 'OpenAI API - GPT-5' },
  'anthropic-api': { enabled: false, type: 'api', label: 'Anthropic API - Claude Sonnet 4.6' },
};

export const DEFAULT_BLOCKLIST = ['g2.com', 'reddit.com', 'facebook.com', 'gartner.com', 'idc.com'];

/**
 * Fetch the brand sitemap (if the auto-watch setting is enabled) and bulk-
 * insert every URL into watched_urls with source='sitemap' and
 * ignore_query_strings=true. No-ops silently if:
 *  - autoWatchBrandUrls is 'false'
 *  - neither brandSitemapUrl nor brandUrl is configured
 *  - the sitemap URL can't be derived or the fetch fails
 *
 * The ingestion is best-effort — never throws up to the caller.
 */
export async function ingestBrandSitemap(): Promise<{ discovered: number; inserted: number } | null> {
  const autoWatchRaw = await storage.getSetting('autoWatchBrandUrls');
  const enabled = autoWatchRaw === null ? true : autoWatchRaw !== 'false';
  if (!enabled) return null;

  const { parseHttpUrl, normalizeUrl } = await import('../services/analysis');
  const { fetchSitemap, deriveSitemapUrl } = await import('../services/sitemap-fetch');

  const explicit = await storage.getSetting('brandSitemapUrl');
  const brandUrl = await storage.getSetting('brandUrl');
  const sitemapUrl = (explicit && explicit.trim()) || (brandUrl ? deriveSitemapUrl(brandUrl) : null);
  if (!sitemapUrl) return null;

  console.log(`[sitemap-ingest] fetching ${sitemapUrl}`);
  const result = await fetchSitemap(sitemapUrl);
  if (!result.sites.length) {
    console.log(`[sitemap-ingest] no URLs discovered (errors: ${result.errors.length})`);
    return { discovered: 0, inserted: 0 };
  }

  const seen = new Set<string>();
  const rows: { url: string; normalizedUrl: string; ignoreQueryStrings: boolean; source: 'sitemap' }[] = [];
  for (const raw of result.sites) {
    if (typeof raw !== 'string') continue;
    if (!parseHttpUrl(raw)) continue;
    const normalizedUrl = normalizeUrl(raw, { stripAllQuery: true });
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    rows.push({ url: raw.trim(), normalizedUrl, ignoreQueryStrings: true, source: 'sitemap' });
  }

  const inserted = await storage.bulkInsertWatchedUrls(rows);
  console.log(`[sitemap-ingest] discovered=${rows.length} inserted=${inserted} truncated=${result.truncated}`);
  return { discovered: rows.length, inserted };
}
