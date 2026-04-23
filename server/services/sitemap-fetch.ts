/**
 * Sitemap fetcher — wraps `sitemapper` with hard limits.
 *
 * Why a wrapper: sitemapper will happily recurse through a `<sitemapindex>`
 * tree with no visited-set or depth limit, buffer unbounded responses, and
 * inflate gzip without a size cap. This keeps that blast radius small:
 *  - `timeoutMs`: bounds a single HTTP request (sitemapper does the cancel)
 *  - `maxUrls`: stops collecting once we've reached the cap, avoiding
 *    runaway memory on malicious or misconfigured sitemaps
 *
 * The input URL is expected to be admin-controlled (brand URL). Still, we
 * don't trust what that sitemap points to — any URLs extracted must be
 * revalidated with `parseHttpUrl` before they hit persistence or an href.
 */

import Sitemapper from 'sitemapper';

export interface SitemapResult {
  url: string;
  sites: string[];
  errors: { type?: string; message?: string; url?: string }[];
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_URLS = 50_000;
const DEFAULT_CONCURRENCY = 5;

export async function fetchSitemap(
  url: string,
  opts: { timeoutMs?: number; maxUrls?: number } = {},
): Promise<SitemapResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxUrls = opts.maxUrls ?? DEFAULT_MAX_URLS;

  const sitemapper = new (Sitemapper as any)({
    url,
    timeout: timeoutMs,
    concurrency: DEFAULT_CONCURRENCY,
    requestHeaders: { 'User-Agent': 'TraceAIO-Sitemap/1.0' },
  });

  const raw = await sitemapper.fetch();
  const sites: string[] = Array.isArray(raw?.sites) ? raw.sites : [];
  const errors = Array.isArray(raw?.errors) ? raw.errors : [];
  const truncated = sites.length > maxUrls;
  return {
    url,
    sites: truncated ? sites.slice(0, maxUrls) : sites,
    errors,
    truncated,
  };
}

/**
 * Derive a likely sitemap URL from a bare brand URL. If the caller already
 * passed a path (e.g. `/sitemap_index.xml`), keep it; otherwise append
 * `/sitemap.xml`. Returns null if parsing fails.
 */
export function deriveSitemapUrl(brandUrl: string): string | null {
  try {
    const u = new URL(brandUrl.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.pathname === '/' || u.pathname === '') {
      u.pathname = '/sitemap.xml';
    }
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
