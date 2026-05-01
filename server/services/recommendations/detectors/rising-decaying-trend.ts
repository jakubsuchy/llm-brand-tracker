// Topic trend — per-topic mention rate over the last N runs has a
// linear-regression slope above (rising) or below (decaying) a threshold.
// Exposed as TWO registered detectors so the dropdown can filter rising vs
// decaying separately, sharing one internal pass. The trend computation is
// cheap so running it twice (once per registered detector) doesn't matter.

import type { DetectorDefinition, DetectorOutput, RecommendationNarrative, RunContext } from "../types";
import { fingerprint, slug } from "../fingerprint";
import { groupBy, modelMentionRate } from "../templates/shared";

const MIN_RUNS_FOR_TREND = 4;
const SLOPE_THRESHOLD_PER_RUN = 0.02;   // rate is 0..1; 0.02/run = 2pp/run

const risingMeta = {
  key: 'rising_topic',
  label: 'Rising trend',
  description: `Topic rate trending up across ≥${MIN_RUNS_FOR_TREND} runs (slope > +${SLOPE_THRESHOLD_PER_RUN}/run).`,
};
const decayingMeta = {
  key: 'decaying_topic',
  label: 'Decaying trend',
  description: `Topic rate trending down across ≥${MIN_RUNS_FOR_TREND} runs (slope < −${SLOPE_THRESHOLD_PER_RUN}/run).`,
};

// Simple ordinary-least-squares slope. xs/ys must be the same length.
function slopeOLS(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    denom += (xs[i] - meanX) ** 2;
  }
  return denom === 0 ? 0 : num / denom;
}

function computeTrendOutputs(ctx: RunContext): DetectorOutput[] {
  if (ctx.recentRuns.length < MIN_RUNS_FOR_TREND) return [];

  // For every topic, compute the per-run rate across the lookback window.
  // recentRuns is newest-first; reverse so x=0..N-1 runs chronologically.
  const window = [...ctx.recentRuns].reverse();

  // topicId -> per-run rate series
  const topicSeries = new Map<number, number[]>();
  for (const run of window) {
    const byTopic = groupBy(
      run.responses.filter(r => r.prompt?.topicId != null),
      r => r.prompt!.topicId!,
    );
    for (const [topicId, rs] of byTopic) {
      const rate = modelMentionRate(rs) / 100;  // 0..1 for slope-units consistency
      const arr = topicSeries.get(topicId) ?? [];
      arr.push(rate);
      topicSeries.set(topicId, arr);
    }
  }

  const out: DetectorOutput[] = [];
  for (const [topicId, series] of Array.from(topicSeries.entries())) {
    // Need a data point per window run. If a topic was missing in earlier
    // runs (no responses) we can't draw a trend.
    if (series.length < MIN_RUNS_FOR_TREND) continue;
    const xs = series.map((_, i) => i);
    const slope = slopeOLS(xs, series);
    if (Math.abs(slope) < SLOPE_THRESHOLD_PER_RUN) continue;

    const topic = ctx.topics.find(t => t.id === topicId);
    if (!topic) continue;

    const isRising = slope > 0;
    const oldRate = series[0] * 100;
    const newRate = series[series.length - 1] * 100;
    const numbers: Record<string, number | string> = {
      slopePerRun: Number(slope.toFixed(3)),
      oldRate: Math.round(oldRate),
      newRate: Math.round(newRate),
      runs: series.length,
    };

    const sharedMetrics = [
      { label: 'Earliest run rate', value: `${oldRate.toFixed(0)}%` },
      { label: 'Latest run rate', value: `${newRate.toFixed(0)}%` },
      { label: 'Runs analyzed', value: String(series.length) },
      { label: 'Slope (per run)', value: `${slope >= 0 ? '+' : ''}${slope.toFixed(3)}` },
    ];

    if (isRising) {
      const narrative: RecommendationNarrative = {
        analysis: `${topic.name} mention rate is trending up — ${oldRate.toFixed(0)}% → ${newRate.toFixed(0)}% across ${series.length} runs.`,
        metrics: sharedMetrics,
        suggestedAction: `Maintain content cadence on this topic — what you're doing is working.`,
      };
      out.push({
        fingerprint: fingerprint(risingMeta.key, `topic:${slug(topic.name)}`),
        detectorKey: risingMeta.key,
        severity: 'info' as const,
        title: `Rising trend — ${topic.name}`,
        narrative,
        evidenceJson: { numbers, series },
        relatedEntities: { topicId },
        impactScore: Math.min(20, slope * 200),
      });
    } else {
      const narrative: RecommendationNarrative = {
        analysis: `${topic.name} mention rate is trending down — ${oldRate.toFixed(0)}% → ${newRate.toFixed(0)}% across ${series.length} runs.`,
        metrics: sharedMetrics,
        suggestedAction: `Investigate the gap prompts in the most recent runs — likely a category shift.`,
      };
      out.push({
        fingerprint: fingerprint(decayingMeta.key, `topic:${slug(topic.name)}`),
        detectorKey: decayingMeta.key,
        severity: 'red' as const,
        title: `Decaying trend — ${topic.name}`,
        narrative,
        evidenceJson: { numbers, series },
        relatedEntities: { topicId },
        impactScore: Math.min(70, Math.abs(slope) * 400),
      });
    }
  }
  return out;
}

export const risingTopicDetector: DetectorDefinition = {
  meta: risingMeta,
  detect: (ctx) => computeTrendOutputs(ctx).filter(o => o.detectorKey === risingMeta.key),
};

export const decayingTopicDetector: DetectorDefinition = {
  meta: decayingMeta,
  detect: (ctx) => computeTrendOutputs(ctx).filter(o => o.detectorKey === decayingMeta.key),
};
