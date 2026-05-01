// Anchor URL — a single owned URL provides ≥ 80% of citations from one
// prompt. Strong signal but isolated; expand the page and add internal
// links to spread authority.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint } from "../fingerprint";
import { rootDomainOf } from "../templates/shared";

const ANCHOR_THRESHOLD_PCT = 80;
const MIN_CITATIONS = 4;

const meta = {
  key: 'anchor_url',
  label: 'Anchor URL',
  description: `Single owned URL with ≥${MIN_CITATIONS} citations and ≥${ANCHOR_THRESHOLD_PCT}% from one prompt — strong but isolated.`,
};

const detect: DetectorDefinition['detect'] = (ctx) => {
  // Per (url, prompt-text) → citation count, plus per-url total.
  const urlPromptCounts = new Map<string, Map<string, number>>();  // url -> promptKey -> n
  const urlTotals = new Map<string, number>();
  const promptTexts = new Map<string, string>();                   // promptKey -> first seen prompt text

  for (const r of ctx.responsesWindow) {
    const k = r.prompt?.text?.toLowerCase().trim();
    if (!k) continue;
    if (!promptTexts.has(k)) promptTexts.set(k, r.prompt!.text!);
    for (const url of (r.sources || [])) {
      // Only consider brand-owned URLs.
      const domain = rootDomainOf(url);
      if (!domain || ctx.classifyDomain(domain) !== 'brand') continue;
      if (!urlPromptCounts.has(url)) urlPromptCounts.set(url, new Map());
      const inner = urlPromptCounts.get(url)!;
      inner.set(k, (inner.get(k) || 0) + 1);
      urlTotals.set(url, (urlTotals.get(url) || 0) + 1);
    }
  }

  const out = [];
  for (const [url, total] of Array.from(urlTotals.entries())) {
    if (total < MIN_CITATIONS) continue;
    const inner = urlPromptCounts.get(url)!;
    // Find the dominant prompt for this URL.
    let topPromptKey = '';
    let topN = 0;
    for (const [k, n] of Array.from(inner.entries())) {
      if (n > topN) { topN = n; topPromptKey = k; }
    }
    const dominancePct = (topN / total) * 100;
    if (dominancePct < ANCHOR_THRESHOLD_PCT) continue;

    const path = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    const promptText = promptTexts.get(topPromptKey) || topPromptKey;

    const narrative: RecommendationNarrative = {
      analysis: `${path} owns a single prompt — most of its citations come from one query, so the rest of your site isn't getting that authority.`,
      metrics: [
        { label: 'Total citations', value: String(total) },
        { label: 'From dominant prompt', value: `${topN} (${dominancePct.toFixed(0)}%)` },
      ],
      groups: [{
        label: 'Dominant prompt',
        items: [{ label: 'Query', value: promptText }],
      }],
      suggestedAction: `Expand this page; add internal links from related content to spread authority.`,
    };

    out.push({
      fingerprint: fingerprint(meta.key, `url:${url}`),
      detectorKey: meta.key,
      severity: 'info' as const,
      title: `Anchor URL — ${path}`,
      narrative,
      evidenceJson: {
        numbers: {
          totalCitations: total,
          dominantPromptCitations: topN,
          dominancePct: Number(dominancePct.toFixed(0)),
        },
        url,
        path,
        dominantPromptText: promptText,
      },
      relatedEntities: {},
      impactScore: Math.min(30, total * 1.5),
    });
  }
  return out;
};

export const anchorUrlDetector: DetectorDefinition = { meta, detect };
