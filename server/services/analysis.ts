/**
 * Generic analysis utilities — no LLM dependency.
 * Everything here works regardless of which AI provider is used.
 */
import { getRegistrableDomain } from './domain';

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
 * Find known competitors mentioned in text via case-insensitive regex.
 * Returns the canonical names of any matches.
 *
 * Two match channels per competitor:
 *
 *   1. Name match — `\b<name>(?:\.[a-z]{2,})?\b` (existing behavior).
 *      Catches "Reprise", "Reprise.com", etc.
 *
 *   2. Domain match — when `domain` is supplied, `<optional subdomain
 *      labels>.<domain>` with negative lookahead/lookbehind so we don't
 *      catch substrings of a larger domain. Catches `reprise.com`,
 *      `docs.reprise.com`, `https://app.walnut.io/...`. Skips suspicious
 *      domains (no label of 4+ chars) so a stray `co.uk` competitor entry
 *      can't false-match every UK domain.
 *
 * `knownCompetitors` accepts plain strings (just name) or
 * `{ name, domain? }` objects. Phase 3 validator still passes
 * single-element string arrays — both forms supported.
 */
type CompetitorMatchInput = string | { name: string; domain?: string | null };

export function findKnownCompetitors(text: string, knownCompetitors: CompetitorMatchInput[]): string[] {
  const clean = text.replace(/\*{1,2}|`/g, '');
  const found: string[] = [];
  for (const item of knownCompetitors) {
    const name = typeof item === 'string' ? item : item.name;
    const domain = typeof item === 'string' ? null : (item.domain || null);

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const namePattern = new RegExp(`\\b${escapedName}(?:\\.[a-z]{2,})?\\b`, 'i');
    if (namePattern.test(clean)) {
      found.push(name);
      continue;
    }

    if (domain) {
      const registrable = getRegistrableDomain(domain);
      if (!registrable) continue;  // public-suffix-only or invalid → skip
      const escapedDomain = registrable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // (?<![a-z0-9.-])  — registrable isn't a substring of a larger name
      // (?:[a-z0-9-]+\.)* — optional subdomain labels (docs., app.foo., …)
      // <escapedDomain>   — the registrable domain itself
      // (?![a-z0-9.-])    — and nothing further extends the domain
      const domainPattern = new RegExp(
        `(?<![a-z0-9.-])(?:[a-z0-9-]+\\.)*${escapedDomain}(?![a-z0-9.-])`,
        'i',
      );
      if (domainPattern.test(clean)) {
        found.push(name);
      }
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
 *  - `stripAllQuery: true` additionally drops ALL remaining params (used for
 *    watchlist entries with `ignore_query_strings` and to populate
 *    `source_urls.normalized_url_stripped`)
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

/**
 * Strip tracking query params from a URL while preserving everything else
 * (original scheme, host casing incl. `www.`, path casing, fragment, and any
 * non-tracking query params). Use this for the *display* URL stored in
 * `responses.sources` and `source_urls.url`. For canonical equality
 * comparison, use `normalizeUrl` instead.
 *
 * Returns the input unchanged on parse failure.
 */
export function stripTrackingParams(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const kept: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      const kl = k.toLowerCase();
      if (kl.startsWith('utm_')) continue;
      if (TRACKING_PARAMS.has(kl)) continue;
      kept.push([k, v]);
    }
    if (kept.length === u.searchParams.size) {
      // No tracking params present — return raw to preserve original encoding.
      return raw;
    }
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    return raw;
  }
}

export function normalizeUrl(raw: string, opts: { stripAllQuery?: boolean } = {}): string {
  try {
    const u = new URL(raw.trim());
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    const defaultPort = u.port === '443' || u.port === '80';
    const port = !u.port || defaultPort ? '' : `:${u.port}`;
    let path = (u.pathname || '/').toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    let query = '';
    if (!opts.stripAllQuery) {
      const params = [...u.searchParams.entries()].filter(([k]) => {
        const kl = k.toLowerCase();
        return !kl.startsWith('utm_') && !TRACKING_PARAMS.has(kl);
      });
      params.sort((a, b) => a[0].localeCompare(b[0]));
      query = params.length ? '?' + new URLSearchParams(params).toString() : '';
    }
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
 * Model keys whose responses come from a direct API call instead of a
 * browser session. Kept in one place so the analyzer, worker pool, and
 * availability gates stay in sync.
 */
export const API_MODELS = new Set<string>(['openai-api', 'anthropic-api']);

export function isApiModel(model: string): boolean {
  return API_MODELS.has(model);
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
  const { askBrowser } = await import('./browser-actor');

  const result = await askBrowser(prompt, model as any, context);

  const urlSources = extractUrlsFromMarkdown(result.answer);
  const sidebarSources = result.sources.map(s => s.href).filter(Boolean);

  return {
    responseText: result.answer,
    sources: [...new Set([...sidebarSources, ...urlSources])],
  };
}

/**
 * Dispatch a prompt to whichever transport the model uses (browser vs API).
 * Extracts markdown URLs on the API side too, since web_search annotations
 * only cover the explicit citations the model emits.
 */
export async function getModelResponse(
  prompt: string,
  model: string,
  context?: { analysisRunId?: number; jobId?: number },
): Promise<{ responseText: string; sources: string[] }> {
  if (isApiModel(model)) {
    const result = model === 'anthropic-api'
      ? await (await import('./anthropic-api')).askAnthropicApi(prompt, context)
      : await (await import('./openai-api')).askOpenAiApi(prompt, context);
    const markdownUrls = extractUrlsFromMarkdown(result.responseText);
    return {
      responseText: result.responseText,
      sources: Array.from(new Set([...result.sources, ...markdownUrls])),
    };
  }
  return getResponseViaBrowser(prompt, model, context);
}

/**
 * Core analysis pipeline: get response, detect brand, extract competitors.
 * The competitor extraction is delegated to a provider-specific function.
 *
 * `mode` = 'static' skips Phase 2 entirely — no LLM call to discover new
 * competitors; only the regex match against the known list runs. Lets a
 * brand owner with a curated competitor list opt out of LLM-discovered
 * additions (which can include irrelevant or hallucinated names).
 */
export async function analyzePromptResponse(
  prompt: string,
  brandName: string | undefined,
  // Strings or {name, domain} objects. Domains, when supplied, get matched
  // alongside names — `docs.reprise.com` in response text resolves to the
  // "Reprise" competitor via its stored domain.
  knownCompetitors: CompetitorMatchInput[] | undefined,
  model: string,
  context: { analysisRunId?: number; jobId?: number } | undefined,
  extractCompetitors: (responseText: string, brandName?: string, knownCompetitors?: string[]) => Promise<string[]>,
  mode: 'static' | 'dynamic' = 'dynamic',
): Promise<PromptAnalysisResult> {
  const startTime = Date.now();

  console.log(`[analyzePromptResponse] Model: ${model} | Mode: ${mode} | Prompt: "${prompt.substring(0, 80)}..."`);

  const { responseText, sources } = await getModelResponse(prompt, model, context);

  console.log(`[analyzePromptResponse] ${model} response: ${responseText.length} chars, ${sources.length} sources in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  const brandMentioned = brandName ? isBrandMentioned(responseText, brandName) : false;

  // Phase 1: regex-match known competitors in the response text (case-
  // insensitive — see findKnownCompetitors). Always runs.
  const regexMatched = findKnownCompetitors(responseText, knownCompetitors || []);

  // The LLM extractor only needs names — strip domain info before passing.
  const knownNames = (knownCompetitors || []).map(c => typeof c === 'string' ? c : c.name);

  // Phase 2: LLM extracts any NEW competitors. Skipped in static mode —
  // the user has opted out of LLM-discovered additions.
  const llmFound = mode === 'static'
    ? []
    : await extractCompetitors(responseText, brandName, knownNames);

  // Phase 3: post-validate every LLM pick by re-running findKnownCompetitors
  // against just that name. Drops anything the LLM produced that doesn't
  // actually appear in the response text — defends against hallucinations
  // even when the prompt context primes the model to over-extract from the
  // known-competitors list. Regex matches skip this — they're proven by
  // construction.
  const llmFoundValidated: string[] = [];
  const llmFoundDropped: string[] = [];
  for (const name of llmFound) {
    if (findKnownCompetitors(responseText, [name]).length > 0) {
      llmFoundValidated.push(name);
    } else {
      llmFoundDropped.push(name);
    }
  }
  if (llmFoundDropped.length > 0) {
    console.log(`[analyzePromptResponse] ${model} dropped ${llmFoundDropped.length} LLM-hallucinated competitor(s) not in text: ${llmFoundDropped.slice(0, 10).join(', ')}${llmFoundDropped.length > 10 ? `, +${llmFoundDropped.length - 10} more` : ''}`);
  }

  // Merge: regex matches + validated LLM finds, deduplicated case-insensitively
  const seen = new Set<string>();
  const competitors: string[] = [];
  const competitorSources = new Map<string, 'regex' | 'llm'>();
  const regexSet = new Set(regexMatched.map(n => n.toLowerCase()));
  for (const name of [...regexMatched, ...llmFoundValidated]) {
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
