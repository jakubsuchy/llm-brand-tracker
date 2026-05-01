// Yellow topic — overall response-level rate is in the 20–50% band AND at
// least one model is below 30%. Distinct from "dead" (every model under 10%)
// and "phantom" (looks great on prompt-dedupe, weak on response-rate).

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate, pct, topNeutralCitations } from "../templates/shared";
import { getModelLabel } from "@shared/models";

const YELLOW_LO = 20;
const YELLOW_HI = 50;
const WEAK_MODEL_THRESHOLD = 30;
const DEAD_THRESHOLD_PCT = 10;

const meta = {
  key: 'yellow_topic',
  label: 'Yellow topic',
  description: `Overall response rate ${YELLOW_LO}–${YELLOW_HI}% with at least one model below ${WEAK_MODEL_THRESHOLD}%.`,
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

    const overall = modelMentionRate(topicResponses);
    if (overall < YELLOW_LO || overall > YELLOW_HI) continue;

    // Skip if every model is dead — that's the dead-topic detector's job.
    const byModel = groupBy(topicResponses, r => r.model || 'unknown');
    const perModel = byModel.map(([model, rs]) => ({ model, rate: modelMentionRate(rs) }));
    if (perModel.length === 0) continue;
    if (perModel.every(p => p.rate < DEAD_THRESHOLD_PCT)) continue;

    // Need at least one model below WEAK_MODEL_THRESHOLD to count as yellow.
    const weakModels = perModel.filter(p => p.rate < WEAK_MODEL_THRESHOLD);
    if (weakModels.length === 0) continue;

    const numbers: Record<string, number | string> = {
      overallRate: Math.round(overall),
    };
    for (const p of perModel) numbers[`${p.model}Rate`] = Math.round(p.rate);

    const weakNames = weakModels.map(p => getModelLabel(p.model)).join(', ');

    const topSurfaces = topNeutralCitations(
      topicResponses,
      ctx.classifyDomain,
      ctx.sourceBlacklist,
      { limit: 5, mode: 'gaps' },
    );

    const narrative: RecommendationNarrative = {
      analysis: `${topic.name} is at ${pct(overall)} overall, dragged down by ${weakNames}.`,
      metrics: [
        { label: 'Overall rate', value: pct(overall) },
      ],
      groups: [
        {
          label: 'Per-model mention rate',
          items: perModel
            .sort((a, b) => a.model.localeCompare(b.model))
            .map(p => ({ label: getModelLabel(p.model), value: pct(p.rate) })),
        },
        ...(topSurfaces.length > 0 ? [{
          label: 'Citation surface targets (neutral domains LLMs cite here)',
          items: topSurfaces.map(s => ({ label: s.domain, value: `${s.n} citations` })),
        }] : []),
      ],
      suggestedAction: 'Patch the weak model(s) — write content in the format they prefer for this topic.',
    };

    out.push({
      fingerprint: fingerprint(meta.key, `topic:${slug(topic.name)}`),
      detectorKey: meta.key,
      severity: 'yellow' as const,
      title: `Yellow topic — ${topic.name}`,
      narrative,
      evidenceJson: { numbers, perModel, weakModels },
      relatedEntities: { topicId },
      impactScore: Math.min(80, (50 - overall) * 1.5 + weakModels.length * 5),
    });
  }
  return out;
};

export const yellowTopicDetector: DetectorDefinition = { meta, detect };
