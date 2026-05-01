// Tiny templating helpers shared across detectors. Keep this thin —
// detector-specific phrasing lives in the detector file itself.

export function pct(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(decimals)}%`;
}

// Format a list of items as "a, b, c, and d" (no Oxford comma when only 2).
export function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// Top-N items by some score, with ties broken by name for determinism.
export function topN<T>(items: T[], n: number, score: (t: T) => number, name: (t: T) => string): T[] {
  return [...items]
    .sort((a, b) => {
      const s = score(b) - score(a);
      return s !== 0 ? s : name(a).localeCompare(name(b));
    })
    .slice(0, n);
}

// Group an array by a key function. Returns an Array of [key, items] tuples
// (not a Map) so callers can `for (const [k, v] of result)` without tripping
// the codebase's strict-iteration TS settings.
export function groupBy<T, K extends string | number>(items: T[], keyFn: (t: T) => K): Array<[K, T[]]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = m.get(key);
    if (arr) arr.push(item);
    else m.set(key, [item]);
  }
  return Array.from(m.entries());
}

// Per-(model, prompt-text) deduplication: returns Map<model, Map<promptKey, brandMentioned>>.
// Used by every "rate" calculation in the topic-coverage detectors.
// promptKey is lowercased+trimmed prompt text — consistent with the
// dashboard's unique-prompt accounting.
export function buildModelPromptMap(
  responses: Array<{ model?: string | null; prompt?: { text?: string | null } | null; brandMentioned?: boolean | null }>,
): Map<string, Map<string, boolean>> {
  const m = new Map<string, Map<string, boolean>>();
  for (const r of responses) {
    const model = r.model || 'unknown';
    const key = (r.prompt?.text || '').toLowerCase().trim();
    if (!key) continue;
    let inner = m.get(model);
    if (!inner) { inner = new Map(); m.set(model, inner); }
    if (!inner.has(key)) inner.set(key, false);
    if (r.brandMentioned) inner.set(key, true);
  }
  return m;
}

// Rate at which a model mentioned the brand on this set of responses, as a
// percentage (0–100). Each response is its own data point — no prompt-level
// deduplication. Across the multi-run window this gives the honest answer
// (k of N runs mentioned brand on this prompt → k/N rate); within a single
// run each prompt has one response per model anyway, so the result matches
// the previous deduped calculation in that degenerate case.
export function modelMentionRate(
  responses: Array<{ brandMentioned?: boolean | null }>,
): number {
  if (responses.length === 0) return 0;
  const mentioned = responses.filter(r => r.brandMentioned).length;
  return (mentioned / responses.length) * 100;
}

// Hostname → root domain (strip leading www., lowercase). Returns null when
// the URL can't be parsed.
export function rootDomainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// Count citations to neutral (non-brand, non-competitor, non-blacklisted)
// domains across a set of responses. Used by the citation-surface
// enrichments — these domains are the placement targets the user can
// pursue to lift visibility on a topic or for a specific model.
//
// `mode = 'gaps'` only counts responses where the brand wasn't mentioned
// (the "missed" citations); `mode = 'all'` counts every response.
export function topNeutralCitations(
  responses: Array<{ brandMentioned?: boolean | null; sources?: string[] | null }>,
  classifyDomain: (d: string) => 'brand' | 'competitor' | 'neutral',
  blacklist: Set<string>,
  opts: { limit?: number; mode?: 'gaps' | 'all' } = {},
): Array<{ domain: string; n: number }> {
  const limit = opts.limit ?? 5;
  const onlyGaps = opts.mode !== 'all';
  const counts = new Map<string, number>();
  for (const r of responses) {
    if (onlyGaps && r.brandMentioned) continue;
    const seen = new Set<string>();
    for (const url of (r.sources || [])) {
      const domain = rootDomainOf(url);
      if (!domain) continue;
      if (blacklist.has(domain)) continue;
      if (classifyDomain(domain) !== 'neutral') continue;
      if (seen.has(domain)) continue;  // dedupe within one response
      seen.add(domain);
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([domain, n]) => ({ domain, n }))
    .sort((a, b) => b.n - a.n || a.domain.localeCompare(b.domain))
    .slice(0, limit);
}
