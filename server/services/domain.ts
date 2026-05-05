// Centralized domain utilities. Built on `tldts` (Public Suffix List) so
// subdomain detection and registrable-domain extraction use the actual
// list of effective TLDs rather than label-counting heuristics.
//
// Use these helpers anywhere we *match* one domain against another:
// - source classification (brand / competitor / neutral)
// - competitor regex matching against response text
// - any "is this URL part of brand X" check
//
// For pure display/storage of the hostname as-typed, plain
// `extractDomainFromUrl` from scraper.ts is still fine.

import { parse as parseTld } from 'tldts';

/**
 * Lowercased hostname with `www.` stripped. URL or bare-domain input both
 * accepted. Returns null when the input can't be parsed as either.
 */
export function getHostname(input: string): string | null {
  if (!input) return null;
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Registrable domain (eTLD+1) per the Public Suffix List. e.g.
 *   `https://docs.reprise.com/foo` → `reprise.com`
 *   `something.co.uk`              → `something.co.uk`
 *   `co.uk`                        → null (it's a public suffix, not registrable)
 *   `1.2.3.4`                      → null (IP)
 *   `localhost`                    → null
 *   `garbage`                      → null
 */
export function getRegistrableDomain(input: string): string | null {
  if (!input) return null;
  const parsed = parseTld(input);
  if (!parsed.domain) return null;
  if (parsed.isIp) return null;
  return parsed.domain.toLowerCase();
}

/**
 * True iff `host` is the same registrable domain as `target`, OR a
 * subdomain of it. e.g. `docs.reprise.com` matches target `reprise.com`,
 * but `myreprise.com` does not. Both sides are normalized via
 * `getRegistrableDomain`, so storage form (hostname vs registrable)
 * doesn't matter on either side.
 *
 * Returns false when either side has no registrable form (e.g. a
 * bare public-suffix string like `co.uk`).
 */
export function isSameOrSubdomainOf(host: string, target: string): boolean {
  const a = getRegistrableDomain(host);
  const b = getRegistrableDomain(target);
  if (!a || !b) return false;
  return a === b;
}
