// Loads everything a detector might need into one in-memory snapshot.
// Built once per `runDetectors` invocation and passed by reference to every
// detector — no detector should hit `storage` directly.

import { storage } from "../../storage";
import { buildSourceClassifier } from "../../routes/sources";
import { isBrandMentioned } from "../analysis";
import { getCurrentBrandName, getSourceBlacklist } from "../../routes/helpers";
import type { RunContext } from "./types";

// How many recent complete runs (including the current one) to feed snapshot
// detectors. Single-run data is too thin to be statistically defensible —
// 4 runs of weekly analyses is roughly a month, enough sample to dampen
// noise without making "resolved" take a quarter.
const SNAPSHOT_WINDOW_SIZE = 4;

// How many runs to load for trend detectors (slope regression). Larger
// because slope estimation needs more data points.
const RECENT_RUN_LOOKBACK = 8;

export async function buildRunContext(runId: number): Promise<RunContext> {
  const brandName = (getCurrentBrandName() || (await storage.getSetting('brandName')) || '').toLowerCase();
  const { classifyDomain } = await buildSourceClassifier();
  const sourceBlacklist = await getSourceBlacklist();

  const [topics, competitors, watched, allRuns] = await Promise.all([
    storage.getTopics(),
    storage.getCompetitors(),
    storage.getWatchedUrls(),
    storage.getAnalysisRuns(),
  ]);

  // Keep only complete runs at or before the current run, newest first.
  // Take the larger lookback (trend) so we only load each run once.
  const completeRuns = allRuns
    .filter(r => r.status === 'complete' && r.id <= runId)
    .sort((a, b) => b.id - a.id)
    .slice(0, RECENT_RUN_LOOKBACK);

  // Pull responses for every run in the lookback window in parallel.
  const runResponses = await Promise.all(
    completeRuns.map(async (r) => ({
      runId: r.id,
      responses: await storage.getResponsesWithPrompts(r.id),
    })),
  );

  // recentRuns: full lookback, per-run breakdown (trend detectors iterate it).
  const recentRuns = runResponses;

  // responsesWindow: aggregate of the most recent SNAPSHOT_WINDOW_SIZE runs,
  // flattened. Snapshot detectors operate on this so a single noisy run
  // can't trip a threshold by itself. On the very first analyses we just
  // use whatever's available — don't gate detector signal on having ≥N runs.
  const responsesWindow = runResponses
    .slice(0, SNAPSHOT_WINDOW_SIZE)
    .flatMap(r => r.responses);

  return {
    runId,
    responsesWindow,
    recentRuns,
    topics,
    competitors,
    watched,
    brandName,
    classifyDomain,
    isBrandMentioned: (text: string) => brandName ? isBrandMentioned(text, brandName) : false,
    sourceBlacklist,
  };
}
