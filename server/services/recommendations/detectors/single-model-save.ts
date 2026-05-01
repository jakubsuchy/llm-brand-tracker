// Single-model save — exactly one model is at ≥ 50% on a topic, every other
// model is below 30%. Fragile: that one model's behavior props up the whole
// topic.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate, pct, topNeutralCitations } from "../templates/shared";
import { getModelLabel } from "@shared/models";

const STRONG_THRESHOLD = 50;
const WEAK_THRESHOLD = 30;

const meta = {
  key: 'single_model_save',
  label: 'Single-model save',
  description: `Only one model carries the topic (≥${STRONG_THRESHOLD}%) while the others are below ${WEAK_THRESHOLD}%.`,
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
    if (perModel.length < 2) continue;

    const strong = perModel.filter(p => p.rate >= STRONG_THRESHOLD);
    if (strong.length !== 1) continue;
    const weak = perModel.filter(p => p !== strong[0]);
    if (!weak.every(p => p.rate < WEAK_THRESHOLD)) continue;

    const numbers: Record<string, number | string> = {};
    for (const p of perModel) numbers[`${p.model}Rate`] = Math.round(p.rate);

    // One placement-target group per weak model — each one needs different
    // content because models cite different neutral domains, so showing only
    // the worst lagger's targets hides the levers for the others.
    const weakSurfaceGroups = weak.map(w => {
      const weakResponses = topicResponses.filter(r => r.model === w.model);
      const surfaces = topNeutralCitations(
        weakResponses,
        ctx.classifyDomain,
        ctx.sourceBlacklist,
        { limit: 5, mode: 'gaps' },
      );
      return { model: w.model, surfaces };
    }).filter(g => g.surfaces.length > 0);

    const weakModelNames = weak.map(w => getModelLabel(w.model)).join(', ');

    const narrative: RecommendationNarrative = {
      analysis: `${topic.name} is held up only by ${getModelLabel(strong[0].model)}. Fragile — if its training updates, this topic goes red.`,
      groups: [
        {
          label: 'Per-model mention rate',
          items: perModel
            .sort((a, b) => a.model.localeCompare(b.model))
            .map(p => ({ label: getModelLabel(p.model), value: pct(p.rate) })),
        },
        ...weakSurfaceGroups.map(g => ({
          label: `Top neutral sources ${getModelLabel(g.model)} cites here (placement targets)`,
          items: g.surfaces.map(s => ({ label: s.domain, value: `${s.n} citations` })),
        })),
      ],
      suggestedAction: weakSurfaceGroups.length > 0
        ? `Place authored content on the sources cited by the laggers (${weakModelNames}) — each model needs its own placement.`
        : `Write content in the format the weakest models prefer to spread the risk.`,
    };

    out.push({
      fingerprint: fingerprint(meta.key, `topic:${slug(topic.name)}`),
      detectorKey: meta.key,
      severity: 'yellow' as const,
      title: `Single-model save — ${topic.name}`,
      narrative,
      evidenceJson: { numbers, perModel, strongModel: strong[0].model },
      relatedEntities: { topicId, model: strong[0].model },
      impactScore: Math.min(60, (STRONG_THRESHOLD - Math.max(...weak.map(w => w.rate))) * 1.5),
    });
  }
  return out;
};

export const singleModelSaveDetector: DetectorDefinition = { meta, detect };
