// Model-specific gap — one model is far behind on a topic the others handle.
// Threshold: target model is below 30%, AND the gap to the median of the
// other models is ≥ 25 percentage points. Distinct from single-model-save:
// here MULTIPLE models are doing fine and ONE lags.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate, pct, topNeutralCitations } from "../templates/shared";
import { getModelLabel } from "@shared/models";

const LOW_THRESHOLD = 30;
const GAP_PCT = 25;

const meta = {
  key: 'model_specific_gap',
  label: 'Model-specific gap',
  description: `One model under ${LOW_THRESHOLD}% on a topic where peers' median is ≥${GAP_PCT}pp higher.`,
};

const detect: DetectorDefinition['detect'] = (ctx) => {
  const out = [];
  const byTopic = groupBy(
    ctx.responsesWindow.filter(r => r.prompt?.topicId != null),
    r => r.prompt!.topicId!,
  );

  for (const [topicId, topicResponses] of byTopic) {
    const topic = ctx.topics.find(t => t.id === topicId);
    if (!topic) continue;

    const byModel = groupBy(topicResponses, r => r.model || 'unknown');
    const perModel = byModel.map(([model, rs]) => ({ model, rate: modelMentionRate(rs) }));
    if (perModel.length < 3) continue;  // need ≥ 3 models for "the others handle it"

    for (const target of perModel) {
      if (target.rate >= LOW_THRESHOLD) continue;
      const others = perModel.filter(p => p.model !== target.model);
      const sorted = others.map(o => o.rate).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0;
      if (median - target.rate < GAP_PCT) continue;

      const numbers: Record<string, number | string> = {
        targetRate: Math.round(target.rate),
        otherMedian: Math.round(median),
        gapPct: Math.round(median - target.rate),
      };
      for (const p of perModel) numbers[`${p.model}Rate`] = Math.round(p.rate);

      const targetLabel = getModelLabel(target.model);

      // What does the lagging model preferentially cite on this topic when
      // it doesn't pick up the brand? Those domains are the model-specific
      // placement targets — content there is what'll lift this particular
      // model's mention rate.
      const targetModelGapResponses = topicResponses.filter(r => r.model === target.model);
      const topSurfaces = topNeutralCitations(
        targetModelGapResponses,
        ctx.classifyDomain,
        ctx.sourceBlacklist,
        { limit: 5, mode: 'gaps' },
      );

      const narrative: RecommendationNarrative = {
        analysis: `${targetLabel}'s mention rate on ${topic.name} is far behind its peers (gap of ${pct(median - target.rate)} below the others' median).`,
        metrics: [
          { label: targetLabel, value: pct(target.rate) },
          { label: 'Other models median', value: pct(median) },
          { label: 'Gap', value: pct(median - target.rate) },
        ],
        groups: [
          {
            label: 'Per-model mention rate',
            items: perModel
              .sort((a, b) => a.model.localeCompare(b.model))
              .map(p => ({ label: getModelLabel(p.model), value: pct(p.rate) })),
          },
          ...(topSurfaces.length > 0 ? [{
            label: `Top neutral sources ${targetLabel} cites here (placement targets)`,
            items: topSurfaces.map(s => ({ label: s.domain, value: `${s.n} citations` })),
          }] : []),
        ],
        suggestedAction: topSurfaces.length > 0
          ? `Place authored content on the top sources ${targetLabel} cites — that's the lever for this specific model.`
          : `Match ${targetLabel}'s preferred content format for this topic.`,
      };

      out.push({
        fingerprint: fingerprint(meta.key, `model:${slug(target.model)}|topic:${slug(topic.name)}`),
        detectorKey: meta.key,
        severity: 'yellow' as const,
        title: `Model-specific gap — ${targetLabel} on ${topic.name}`,
        narrative,
        evidenceJson: { numbers, perModel },
        relatedEntities: { topicId, model: target.model },
        impactScore: Math.min(50, (median - target.rate)),
      });
    }
  }
  return out;
};

export const modelSpecificGapDetector: DetectorDefinition = { meta, detect };
