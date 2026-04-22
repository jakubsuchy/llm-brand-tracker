/**
 * Generic analysis utilities — no LLM dependency.
 * Everything here works regardless of which AI provider is used.
 */

export interface PromptAnalysisResult {
  response: string;
  brandMentioned: boolean;
  competitors: string[];
  competitorSources: Map<string, 'regex' | 'llm'>;
  sources: string[];
  model: string;
}

/**
 * Check if a brand name appears in text via regex.
 * Strips markdown formatting, then matches with word boundaries
 * and an optional trailing dot+TLD (e.g. "Acme.com", "Acme.io").
 */
export function isBrandMentioned(text: string, brandName: string): boolean {
  const clean = text.replace(/\*{1,2}|`/g, '');
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\b${escaped}(?:\\.[a-z]{2,})?\\b`, 'i');
  return pattern.test(clean);
}

/**
 * Find known competitors mentioned in text using the same regex approach as brand detection.
 * Returns the canonical names of any known competitors found.
 */
export function findKnownCompetitors(text: string, knownCompetitors: string[]): string[] {
  const clean = text.replace(/\*{1,2}|`/g, '');
  const found: string[] = [];
  for (const name of knownCompetitors) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}(?:\\.[a-z]{2,})?\\b`, 'i');
    if (pattern.test(clean)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Extract URLs from markdown-formatted text.
 * Handles [text](url) links and [1]: url footnote-style references.
 */
export function extractUrlsFromMarkdown(text: string): string[] {
  const urls: string[] = [];
  // Inline links: [text](https://...)
  const inlinePattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = inlinePattern.exec(text)) !== null) {
    urls.push(match[2]);
  }
  // Footnote-style: [1]: https://...
  const footnotePattern = /^\[(\d+)\]:\s*(https?:\/\/\S+)/gm;
  while ((match = footnotePattern.exec(text)) !== null) {
    urls.push(match[2]);
  }
  return urls;
}

/**
 * Parse a user-supplied URL and require http(s) scheme with a non-empty host.
 * Returns the parsed URL, or null if invalid. Use this at every ingress point
 * that stores a URL later rendered into an `href` or similar navigation sink —
 * a `javascript:` URL in `href` is a classic stored-XSS vector.
 */
export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a URL for equality comparison. The result is stored in
 * `source_urls.normalized_url` and `watched_urls.normalized_url` and used
 * as the join key for citation lookups.
 *
 * Transformations:
 *  - Scheme coerced to https (treat http/https as equivalent)
 *  - Hostname lowercased; leading `www.` stripped
 *  - Default ports (80/443) dropped; other ports preserved
 *  - Path lowercased (deliberate tradeoff — produces false positives on
 *    case-sensitive servers, but content URLs almost always live under
 *    lowercased paths and missed matches are a bigger problem than overlap)
 *  - Trailing slash stripped (except on root)
 *  - Fragment dropped
 *  - Tracking query params dropped (case-insensitive): `utm_*` plus a curated
 *    list of ad-click and analytics IDs (see TRACKING_PARAMS below). Remaining
 *    params sorted by key (stable — same-key value order preserved)
 *
 * Falls back to `raw.trim().toLowerCase()` if parsing fails so malformed
 * inputs still get a stable (if blunt) key.
 */
// Tracking query params that encode user identity or campaign attribution,
// not content. Stripped during normalization so URLs cited with/without
// tracking query strings collapse to the same canonical form.
const TRACKING_PARAMS = new Set([
  'trackingid',
  // Google
  'gclid', 'gbraid', 'wbraid', 'gad', 'gad_source', 'gclsrc', 'dclid', '_gl',
  // Meta / Facebook
  'fbclid',
  // Microsoft / Bing
  'msclkid',
  // TikTok, Yandex, Pinterest, Instagram, LinkedIn
  'ttclid', 'yclid', 'epik', 'igshid', 'li_fat_id',
  // Mailchimp, Marketo
  'mc_cid', 'mc_eid', 'mkt_tok',
  // HubSpot
  '_hsenc', '_hsmi', '__hstc', '__hssc', '__hsfp',
]);

export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    const defaultPort = u.port === '443' || u.port === '80';
    const port = !u.port || defaultPort ? '' : `:${u.port}`;
    let path = (u.pathname || '/').toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const params = [...u.searchParams.entries()].filter(([k]) => {
      const kl = k.toLowerCase();
      return !kl.startsWith('utm_') && !TRACKING_PARAMS.has(kl);
    });
    params.sort((a, b) => a[0].localeCompare(b[0]));
    const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    return `https://${host}${port}${path}${query}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Calculate string similarity between two competitor names.
 * Used for deduplication — returns 0-100.
 */
export function calculateCompetitorSimilarity(competitor1: string, competitor2: string): number {
  const text1 = competitor1.toLowerCase();
  const text2 = competitor2.toLowerCase();
  if (text1 === text2) return 100;
  if (text1.includes(text2) || text2.includes(text1)) return 90;
  const words1 = text1.split(/\s+/).filter(word => word.length > 2);
  const words2 = text2.split(/\s+/).filter(word => word.length > 2);
  const intersection = words1.filter(word => words2.includes(word));
  const union = new Set([...words1, ...words2]);
  return union.size > 0 ? (intersection.length / union.size) * 100 : 0;
}

/**
 * Deduplicate a list of competitor names by similarity threshold.
 */
export function deduplicateCompetitors(competitors: string[], maxResults: number = 10, threshold: number = 70): string[] {
  const result: string[] = [];
  for (const competitor of competitors) {
    if (result.length >= maxResults) break;
    const isDiverse = result.every(existing =>
      calculateCompetitorSimilarity(competitor, existing) < threshold
    );
    if (isDiverse) result.push(competitor);
  }
  return result;
}

/**
 * Get a response from the browser actor and extract sources.
 * This is the transport layer — works with any browser-based model.
 */
export async function getResponseViaBrowser(
  prompt: string,
  model: string,
  context?: { analysisRunId?: number; jobId?: number },
): Promise<{ responseText: string; sources: string[] }> {
  const { askBrowser } = await import('./chatgpt-browser');

  const result = await askBrowser(prompt, model as any, context);

  const urlSources = extractUrlsFromMarkdown(result.answer);
  const sidebarSources = result.sources.map(s => s.href).filter(Boolean);

  return {
    responseText: result.answer,
    sources: [...new Set([...sidebarSources, ...urlSources])],
  };
}

/**
 * Core analysis pipeline: get response, detect brand, extract competitors.
 * The competitor extraction is delegated to a provider-specific function.
 */
export async function analyzePromptResponse(
  prompt: string,
  brandName: string | undefined,
  knownCompetitors: string[] | undefined,
  model: string,
  context: { analysisRunId?: number; jobId?: number } | undefined,
  extractCompetitors: (responseText: string, brandName?: string, knownCompetitors?: string[]) => Promise<string[]>,
): Promise<PromptAnalysisResult> {
  const startTime = Date.now();

  console.log(`[analyzePromptResponse] Model: ${model} | Prompt: "${prompt.substring(0, 80)}..."`);

  const { responseText, sources } = await getResponseViaBrowser(prompt, model, context);

  console.log(`[analyzePromptResponse] ${model} response: ${responseText.length} chars, ${sources.length} sources in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const brandMentioned = brandName ? isBrandMentioned(responseText, brandName) : false;

  // Phase 1: regex-match known competitors in the response text
  const regexMatched = findKnownCompetitors(responseText, knownCompetitors || []);

  // Phase 2: LLM extracts any NEW competitors (still receives known list for naming consistency)
  const llmFound = await extractCompetitors(responseText, brandName, knownCompetitors);

  // Merge: regex matches + LLM finds, deduplicated case-insensitively
  const seen = new Set<string>();
  const competitors: string[] = [];
  const competitorSources = new Map<string, 'regex' | 'llm'>();
  const regexSet = new Set(regexMatched.map(n => n.toLowerCase()));
  for (const name of [...regexMatched, ...llmFound]) {
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      competitors.push(name);
      competitorSources.set(key, regexSet.has(key) ? 'regex' : 'llm');
    }
  }

  return {
    response: responseText,
    brandMentioned,
    competitors,
    competitorSources,
    sources,
    model,
  };
}
