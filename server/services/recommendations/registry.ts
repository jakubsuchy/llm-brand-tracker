// Single source of truth for which detectors run, in what order, and how
// each one labels itself in the UI. Both the orchestrator and the
// `/api/recommendations/detectors` endpoint read from here so the dropdown
// is always complete (independent of which recs are currently rendered) and
// adding a new detector is one import + one entry here.

import type { DetectorDefinition } from "./types";
import { deadTopicDetector } from "./detectors/dead-topic";
import { yellowTopicDetector } from "./detectors/yellow-topic";
import { phantomStrengthDetector } from "./detectors/phantom-strength";
import { singleModelSaveDetector } from "./detectors/single-model-save";
import { modelSpecificGapDetector } from "./detectors/model-specific-gap";
import { ownedSourceUnderweightDetector } from "./detectors/owned-source-underweight";
import { anchorUrlDetector } from "./detectors/anchor-url";
import { risingTopicDetector, decayingTopicDetector } from "./detectors/rising-decaying-trend";

// Killed detectors (kept here as comments so future-you doesn't accidentally
// reintroduce them):
//   watchlist_wasteland — auto-imported sitemap URLs make the threshold
//     meaningless; was firing on normal site behavior.
//   competitor_solo_dominance — per-competitor fan-out flooded the page;
//     the "solo" framing was betrayed by firing for every competitor with
//     ≥3 gap prompts. Either tighten ("top 2× runner-up") or aggregate
//     into one "competitor gaps" rec — neither built yet.

export const DETECTOR_REGISTRY: DetectorDefinition[] = [
  deadTopicDetector,
  yellowTopicDetector,
  phantomStrengthDetector,
  singleModelSaveDetector,
  modelSpecificGapDetector,
  ownedSourceUnderweightDetector,
  anchorUrlDetector,
  decayingTopicDetector,
  risingTopicDetector,
];
