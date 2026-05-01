// Phantom strength — prompt-level rate ≥ 90% but response-level rate < 50%.
// One or two models riding small samples make the headline look good.

import type { DetectorDefinition, RecommendationNarrative } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate, pct } from "../templates/shared";
import { getModelLabel } from "@shared/models";

const PROMPT_RATE_HI = 90;
const RESPONSE_RATE_LO = 50;

const meta = {
  key: 'phantom_strength',
  label: 'Phantom strength',
  description: `Prompt-dedupe rate ≥${PROMPT_RATE_HI}% but response-level rate <${RESPONSE_RATE_LO}% — one model is propping the headline up.`,
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

    // Prompt-level rate: a prompt counts as "mentioned" if ANY model
    // mentioned the brand on it.
    const promptMentioned = new Map<string, boolean>();
    for (const r of topicResponses) {
      const k = r.prompt?.text?.toLowerCase().trim();
      if (!k) continue;
      if (!promptMentioned.has(k)) promptMentioned.set(k, false);
      if (r.brandMentioned) promptMentioned.set(k, true);
    }
    if (promptMentioned.size === 0) continue;
    const promptRate = (Array.from(promptMentioned.values()).filter(Boolean).length / promptMentioned.size) * 100;
    if (promptRate < PROMPT_RATE_HI) continue;

    // Response-level rate.
    const totalResponses = topicResponses.length;
    const responseMentions = topicResponses.filter(r => r.brandMentioned).length;
    const responseRate = totalResponses > 0 ? (responseMentions / totalResponses) * 100 : 0;
    if (responseRate >= RESPONSE_RATE_LO) continue;

    const byModel = groupBy(topicResponses, r => r.model || 'unknown');
    const perModel = byModel.map(([model, rs]) => ({
      model,
      rate: modelMentionRate(rs),
      n: rs.length,
    }));

    // Identify the small-sample model that's riding high.
    const counts = perModel.map(p => p.n).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)] || 0;
    const smallSampleModels = perModel.filter(p => p.n < median * 0.5 && p.rate > 80);

    const numbers: Record<string, number | string> = {
      promptRate: Math.round(promptRate),
      responseRate: Math.round(responseRate),
    };
    for (const p of perModel) {
      numbers[`${p.model}Rate`] = Math.round(p.rate);
      numbers[`${p.model}Sample`] = p.n;
    }

    const phantomNote = smallSampleModels.length > 0
      ? ` ${smallSampleModels.map(s => `${getModelLabel(s.model)} sits at ${pct(s.rate)} on a small ${s.n}-response sample (median ${median}).`).join(' ')}`
      : '';

    const narrative: RecommendationNarrative = {
      analysis:
        `${topic.name} looks covered: ${pct(promptRate)} of unique prompts mention ${ctx.brandName || 'the brand'} across any model, ` +
        `but the real response-level rate is only ${pct(responseRate)}.${phantomNote}`,
      metrics: [
        { label: 'Prompt-dedupe rate', value: pct(promptRate) },
        { label: 'Response-level rate', value: pct(responseRate) },
      ],
      groups: [{
        label: 'Per-model rate (sample size)',
        items: perModel
          .sort((a, b) => a.model.localeCompare(b.model))
          .map(p => ({ label: getModelLabel(p.model), value: `${pct(p.rate)} (n=${p.n})` })),
      }],
      suggestedAction: `Don't trust the headline — address the per-model gaps explicitly.`,
    };

    out.push({
      fingerprint: fingerprint(meta.key, `topic:${slug(topic.name)}`),
      detectorKey: meta.key,
      severity: 'yellow' as const,
      title: `Phantom strength — ${topic.name}`,
      narrative,
      evidenceJson: { numbers, perModel, smallSampleModels },
      relatedEntities: { topicId },
      impactScore: Math.min(70, (promptRate - responseRate) * 1.0),
    });
  }
  return out;
};

export const phantomStrengthDetector: DetectorDefinition = { meta, detect };
