// Owned source underweight — the brand's own domain ranks below #5 in the
// cited-source list. Suggests an earned-media play on the top neutral
// domains rather than another piece of authored content on the brand site.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint } from "../fingerprint";
import { rootDomainOf } from "../templates/shared";

const RANK_FLOOR = 5;

const meta = {
  key: 'owned_source_underweight',
  label: 'Owned source underweight',
  description: `Brand domain ranks below #${RANK_FLOOR} in cited sources — earned media beats more authored content.`,
};

const detect: DetectorDefinition['detect'] = (ctx) => {
  const counts = new Map<string, number>();
  for (const r of ctx.responsesWindow) {
    const seen = new Set<string>();
    for (const url of (r.sources || [])) {
      const domain = rootDomainOf(url);
      if (!domain) continue;
      // Apply the same URL Blacklist that the Sources page uses, so domains
      // the user has hidden globally don't show up in recommendations
      // either (e.g., myactivity.google.com was leaking through).
      if (ctx.sourceBlacklist.has(domain)) continue;
      if (seen.has(domain)) continue;  // dedupe within one response
      seen.add(domain);
      counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  }
  if (counts.size === 0) return [];

  const ranked = Array.from(counts.entries())
    .map(([domain, n]) => ({ domain, n, type: ctx.classifyDomain(domain) }))
    .sort((a, b) => b.n - a.n);

  // Find the brand's rank.
  const brandIdx = ranked.findIndex(r => r.type === 'brand');
  if (brandIdx === -1) return [];
  const brandRank = brandIdx + 1;
  if (brandRank <= RANK_FLOOR) return [];

  const brandRow = ranked[brandIdx];
  // Top neutral domains above the brand — those are the earned-media targets.
  const neutralAhead = ranked
    .slice(0, brandIdx)
    .filter(r => r.type === 'neutral')
    .slice(0, 3);

  if (neutralAhead.length === 0) return [];

  const numbers: Record<string, number | string> = {
    brandRank,
    brandCitations: brandRow.n,
    topNeutralCitations: neutralAhead[0].n,
  };
  for (let i = 0; i < neutralAhead.length; i++) {
    numbers[`neutral${i}Citations`] = neutralAhead[i].n;
  }

  const narrative: RecommendationNarrative = {
    analysis: `Your domain ${brandRow.domain} ranks #${brandRank} in cited sources, behind several neutral domains.`,
    metrics: [
      { label: 'Brand rank', value: `#${brandRank}` },
      { label: 'Brand citations', value: String(brandRow.n) },
      { label: 'Top neutral domain', value: `${neutralAhead[0].domain} (${neutralAhead[0].n})` },
    ],
    groups: [{
      label: 'Top neutral domains ranked above your site',
      items: neutralAhead.map(n => ({ label: n.domain, value: `${n.n} citations` })),
    }],
    suggestedAction: `Earned-media campaign — place authored posts on these top neutral domains rather than adding another page on your site.`,
  };

  return [{
    fingerprint: fingerprint(meta.key, `brand`),
    detectorKey: meta.key,
    severity: 'yellow' as const,
    title: `Owned source underweight — ${brandRow.domain}`,
    narrative,
    evidenceJson: {
      numbers,
      brandRow,
      neutralAhead,
      topRanked: ranked.slice(0, 10),
    },
    relatedEntities: {},
    impactScore: Math.min(50, brandRank * 5),
  }];
};

export const ownedSourceUnderweightDetector: DetectorDefinition = { meta, detect };
