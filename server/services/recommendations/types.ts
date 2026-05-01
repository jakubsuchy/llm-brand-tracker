// Shared types for the recommendation detector pipeline.
// Pure data — no IO, no DB, no fetches.

import type { ResponseWithPrompt, Topic, Competitor, WatchedUrl, RecommendationNarrative } from "@shared/schema";

export type Severity = 'red' | 'yellow' | 'info';

// Re-export for detector files that already import from "../types".
export type { RecommendationNarrative } from "@shared/schema";

// What a detector returns. The orchestrator handles persistence, fingerprint
// versioning, and run-pointer wiring; the detector is a pure function from
// RunContext to an array of these.
export type DetectorOutput = {
  // Stable identity for this recommendation across runs. Built by
  // fingerprint.ts, never by the detector itself.
  fingerprint: string;
  detectorKey: string;
  severity: Severity;
  title: string;
  // Structured narrative — `analysis` prose, optional metrics/groups grids,
  // `suggestedAction` prose. Rendered properly in the UI; consumed as
  // structured data by API clients.
  narrative: RecommendationNarrative;
  // Flat numbers map intended for downstream verifiers (the LLM-brief layer
  // re-extracts numeric tokens from the body and confirms each appears here).
  // Detectors must put every number that ends up in the body into `numbers`.
  evidenceJson: { numbers: Record<string, number | string>;[k: string]: any };
  // FK-style references to existing entities, for deep-linking from the UI.
  // Optional fields — different detectors reference different shapes.
  relatedEntities: {
    topicId?: number;
    competitorId?: number;
    sourceUrlId?: number;
    watchedUrlId?: number;
    model?: string;
    promptId?: number;
    pathPrefix?: string;
  };
  // Used to rank within a severity tier.
  impactScore: number;
};

// Input shared by every detector. Built once per recompute by context.ts —
// detectors must never reach back into `storage` directly.
export type RunContext = {
  // The run that triggered this detector pass (the latest complete run when
  // recomputing). Used for fingerprint anchoring (lastSeenRunId etc.) — does
  // NOT bound the data window the detectors look at.
  runId: number;
  // Responses (joined to prompts + topics) aggregated across the last N
  // complete runs INCLUDING the current one. Snapshot detectors operate on
  // this aggregate to dampen single-run noise. Each response is its own data
  // point — no prompt-level dedup; rate = mentioned / total.
  responsesWindow: ResponseWithPrompt[];
  // Cross-run history broken out per run, limited to RECENT_RUN_LOOKBACK
  // most recent complete runs (for trend detectors). Newest first.
  recentRuns: Array<{
    runId: number;
    responses: ResponseWithPrompt[];
  }>;
  // Reference data
  topics: Topic[];
  competitors: Competitor[];
  watched: WatchedUrl[];
  // Brand
  brandName: string;
  // Helper: classify a domain as 'brand' | 'competitor' | 'neutral'. Same
  // logic as buildSourceClassifier on the API side.
  classifyDomain: (domain: string) => 'brand' | 'competitor' | 'neutral';
  // Helper: returns true if `text` mentions `brandName`.
  isBrandMentioned: (text: string) => boolean;
  // URL Blacklist (from Settings → Sources). Detectors that surface cited
  // domains MUST filter against this — same hide-it-everywhere semantics
  // as the Sources page. Lowercased domains.
  sourceBlacklist: Set<string>;
};

// Detector signature (the function itself).
export type Detector = (ctx: RunContext) => DetectorOutput[];

// Static metadata about a detector — single source of truth for the
// machine key (used in DB / fingerprints) and the human-readable label
// (used in UI dropdowns / tooltips). Co-located with the detector function
// so renames stay consistent.
export type DetectorMeta = {
  key: string;          // canonical machine identifier, stable across renames
  label: string;        // human-readable name shown in UI
  description?: string; // one-line tooltip explaining the threshold
};

// A detector packaged with its metadata. Registered in registry.ts.
export type DetectorDefinition = {
  meta: DetectorMeta;
  detect: Detector;
};
