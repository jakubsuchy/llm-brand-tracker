/**
 * Defense-in-depth helper for any `<a href={...}>` that renders an LLM- or
 * scrape-derived URL. Returns the original string only when it parses as
 * http(s); returns null otherwise so the caller can render the URL as inert
 * text (still visible, not clickable). Server-side `parseHttpUrl`
 * (server/services/analysis.ts) is the primary filter — this guards the
 * render path in case a junk URL slipped through before the filter existed.
 */
export function safeHttpHref(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  return /^https?:\/\/[^\s<>"]+$/i.test(url) ? url : null;
}
