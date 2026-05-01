// Recommendation pipeline orchestrator.
//
// Public entry point: runDetectors(runId).
// 1. Build RunContext once.
// 2. Run every registered detector, collect outputs.
// 3. Upsert into `recommendations` (latest snapshot) and
//    `recommendation_occurrences` (per-run history).
// 4. Idempotent — calling twice for the same run upserts cleanly.
//
// State transitions are user-only. The orchestrator never touches `state`.

import { storage } from "../../storage";
import { buildRunContext } from "./context";
import { FINGERPRINT_VERSION } from "./fingerprint";
import { DETECTOR_REGISTRY } from "./registry";
import type { DetectorOutput } from "./types";

export async function runDetectors(runId: number): Promise<{ count: number }> {
  const t0 = Date.now();
  const ctx = await buildRunContext(runId);

  const all: DetectorOutput[] = [];
  for (const def of DETECTOR_REGISTRY) {
    try {
      const outs = def.detect(ctx);
      all.push(...outs);
    } catch (err) {
      console.error(`[recommendations] detector ${def.meta.key} failed:`, err);
      // Keep going — one bad detector shouldn't kill the rest.
    }
  }

  // Persist. UPSERT semantics handle duplicate fingerprints (same detector
  // emitting the same identity twice in one run, e.g. competitor case
  // collisions) — the second wins.
  for (const out of all) {
    const { id } = await storage.upsertRecommendation(
      {
        fingerprint: out.fingerprint,
        fingerprintVersion: FINGERPRINT_VERSION,
        detectorKey: out.detectorKey,
        severity: out.severity,
        title: out.title,
        narrative: out.narrative,
        evidenceJson: out.evidenceJson,
        relatedEntities: out.relatedEntities,
        impactScore: out.impactScore,
      },
      runId,
    );
    await storage.upsertRecommendationOccurrence({
      recommendationId: id,
      analysisRunId: runId,
      severity: out.severity,
      narrative: out.narrative,
      evidenceJson: out.evidenceJson,
      impactScore: out.impactScore,
    });
  }

  const elapsed = Date.now() - t0;
  console.log(`[recommendations] computed ${all.length} recommendations for run #${runId} in ${elapsed}ms`);
  return { count: all.length };
}
