// Dead topic — every model mentions the brand on under DEAD_THRESHOLD of
// responses. Suggests a hub page targeting the topic.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate, pct, joinNames, topN, topNeutralCitations } from "../templates/shared";
import { getModelLabel } from "@shared/models";

const DEAD_THRESHOLD_PCT = 10;

const meta = {
  key: 'dead_topic',
  label: 'Dead topic',
  description: `Every model mentions the brand on under ${DEAD_THRESHOLD_PCT}% of responses for a topic.`,
};

const detect: DetectorDefinition['detect'] = (ctx) => {
  const out = [];
  // Group this run's responses by (topicId).
  const byTopic = groupBy(
    ctx.responsesWindow.filter(r => r.prompt?.topicId != null),
    r => r.prompt!.topicId!,
  );

  for (const [topicId, topicResponses] of byTopic) {
    const topic = ctx.topics.find(t => t.id === topicId);
    if (!topic) continue;

    // Per-model mention rate.
    const byModel = groupBy(topicResponses, r => r.model || 'unknown');
    const perModel: Array<{ model: string; rate: number }> = [];
    for (const [model, modelResponses] of byModel) {
      perModel.push({ model, rate: modelMentionRate(modelResponses) });
    }
    if (perModel.length === 0) continue;

    // Every model below threshold? (Conjunction across models is what makes
    // this "dead" rather than "weak in one model".)
    const allDead = perModel.every(p => p.rate < DEAD_THRESHOLD_PCT);
    if (!allDead) continue;

    // Count unique prompts in this topic and brand-mention totals.
    const uniquePrompts = new Set<string>();
    let brandMentions = 0;
    for (const r of topicResponses) {
      const k = r.prompt?.text?.toLowerCase().trim();
      if (k) uniquePrompts.add(k);
      if (r.brandMentioned) brandMentions++;
    }

    // Top competitors winning the slot (those most-mentioned across this
    // topic's responses where the brand wasn't mentioned).
    const compCount = new Map<string, number>();
    for (const r of topicResponses) {
      if (r.brandMentioned) continue;
      for (const c of (r.competitorsMentioned || [])) {
        compCount.set(c, (compCount.get(c) || 0) + 1);
      }
    }
    const topCompetitors = topN(
      Array.from(compCount.entries()),
      4,
      ([, n]) => n,
      ([name]) => name,
    );

    const numbers: Record<string, number | string> = {
      promptCount: uniquePrompts.size,
      brandMentions,
    };
    for (const p of perModel) numbers[`${p.model}Rate`] = Math.round(p.rate);
    for (let i = 0; i < topCompetitors.length; i++) {
      numbers[`competitor${i}Prompts`] = topCompetitors[i][1];
    }

    const competitorNames = topCompetitors.slice(0, 3).map(([n]) => n);

    // Citation surface targets — the top neutral third-party domains LLMs
    // cite on this topic when the brand isn't mentioned. These are where
    // placement (authored posts, listings, comparison content) actually
    // moves the needle.
    const topSurfaces = topNeutralCitations(
      topicResponses,
      ctx.classifyDomain,
      ctx.sourceBlacklist,
      { limit: 5, mode: 'gaps' },
    );

    // A single hub page rarely moves a dead topic on its own — earned media
    // placement, comparison co-occurrence, and category listings compound.
    // Surface the full play as numbered steps so the user sees the breadth.
    const headline = `A dead topic needs a multi-channel campaign — content, earned media, and category visibility compound.`;
    const steps: string[] = [];
    // Step 1: hub page is brand-positive, NOT a competitor showcase.
    // Naming competitors on the hub legitimizes them on your own turf;
    // keep the hub focused on the brand's category authority and link out
    // to dedicated comparison pages instead.
    steps.push(
      `Build a hub page at /solutions/${slug(topic.name)} that establishes your authority in this category — match the prompt phrasing in titles, headers, and JSON-LD. Keep it brand-positive; don't name competitors here.`,
    );
    // Step 2: comparison pages are where competitors get named. For dead
    // topics every winning competitor is "bigger" than the brand by
    // definition, so this is automatically a punch-up; we still spell out
    // the principle so the user carries it to other topics.
    if (competitorNames.length > 0) {
      steps.push(
        `Build dedicated comparison pages: /comparisons/${slug(ctx.brandName || 'brand')}-vs-${slug(competitorNames[0])} (and one per top competitor — ${joinNames(competitorNames)}). Link to them from the hub. Punch up, not down — only name competitors with equal or higher visibility on this topic.`,
      );
    }
    if (topSurfaces.length > 0) {
      const top3 = topSurfaces.slice(0, 3).map(s => s.domain);
      steps.push(
        `Place authored content on the neutral domains LLMs already cite here — ${joinNames(top3)} — rather than adding more pages on your own site.`,
      );
    }
    steps.push(
      `Apply for inclusion in category aggregators (G2 / Capterra / Gartner Peer Insights / awesome-* GitHub lists) — these are heavily weighted by every model.`,
    );
    steps.push(
      `Seed organic community presence on Reddit, HN, and Stack Overflow threads about this topic — one upvoted comment outweighs ten pillar pages.`,
    );

    const narrative: RecommendationNarrative = {
      analysis: `${ctx.brandName || 'The brand'} is invisible on the ${topic.name} topic — all ${perModel.length} models mention it on under ${DEAD_THRESHOLD_PCT}% of responses.`,
      metrics: [
        { label: 'Prompts', value: String(uniquePrompts.size) },
        { label: 'Brand mentions', value: String(brandMentions) },
      ],
      groups: [
        {
          label: 'Per-model mention rate',
          items: perModel
            .sort((a, b) => a.model.localeCompare(b.model))
            .map(p => ({ label: getModelLabel(p.model), value: pct(p.rate) })),
        },
        ...(topCompetitors.length > 0 ? [{
          label: 'Top competitors winning these slots',
          items: topCompetitors.map(([name, n]) => ({ label: name, value: `${n} prompts` })),
        }] : []),
        ...(topSurfaces.length > 0 ? [{
          label: 'Citation surface targets (neutral domains LLMs cite here)',
          items: topSurfaces.map(s => ({ label: s.domain, value: `${s.n} citations` })),
        }] : []),
      ],
      suggestedAction: headline,
      suggestedSteps: steps,
    };

    out.push({
      fingerprint: fingerprint(meta.key, `topic:${slug(topic.name)}`),
      detectorKey: meta.key,
      severity: 'red' as const,
      title: `Dead topic — ${topic.name}`,
      narrative,
      evidenceJson: {
        numbers,
        perModel,
        topCompetitors: topCompetitors.map(([name, n]) => ({ name, n })),
      },
      relatedEntities: { topicId },
      // High prompt count → bigger lift potential. Cap so a single huge topic
      // doesn't drown out everything else.
      impactScore: Math.min(100, uniquePrompts.size * 2),
    });
  }
  return out;
};

export const deadTopicDetector: DetectorDefinition = { meta, detect };
