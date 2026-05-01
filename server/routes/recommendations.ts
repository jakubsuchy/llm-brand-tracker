import type { Express } from "express";
import { storage } from "../storage";
import { requireRole } from "./helpers";
import type { Recommendation, RecommendationHint, RecommendationState } from "@shared/schema";

const VALID_STATES: RecommendationState[] = ['open', 'dismissed', 'actioned', 'resolved'];
const VALID_SEVERITIES = ['red', 'yellow', 'info'] as const;

// Compute the UI hint. The temporal anchor for "is there new evidence?" is
// the most recent decision point — either the user's last state change
// (`stateChangedAtRunId`) or the rec's first detection (`firstSeenRunId`)
// when state was never user-changed. A hint should NEVER fire purely as a
// consequence of the user's own click; it requires a run that completed
// AFTER that anchor.
function computeHint(rec: Recommendation, latestRunId: number | null): RecommendationHint {
  if (latestRunId == null) return null;
  if (rec.state === 'dismissed') return null;  // user opted out
  const anchor = rec.stateChangedAtRunId ?? rec.firstSeenRunId;
  // No new run since the anchor → no hint, regardless of state.
  if (latestRunId <= anchor) return null;
  const firingInLatest = rec.lastSeenRunId === latestRunId;
  if (rec.state === 'resolved') {
    // "Back" only when something has fired the rec AFTER the user resolved.
    return rec.lastSeenRunId > anchor ? 'back' : null;
  }
  // open / actioned: hint when the latest run failed to fire it.
  return firingInLatest ? null : 'resolved';
}

// Newest run with status 'complete'. `getLatestAnalysisRun` returns the
// newest by id regardless of status, which would let an in-progress run
// become the user's anchor — never what we want for hint computation.
async function getLatestCompleteRunId(): Promise<number | null> {
  const runs = await storage.getAnalysisRuns();
  const latest = runs
    .filter(r => r.status === 'complete')
    .sort((a, b) => b.id - a.id)[0];
  return latest?.id ?? null;
}

function decorate(rec: Recommendation, latestRunId: number | null) {
  return {
    ...rec,
    firingInLatest: latestRunId != null && rec.lastSeenRunId === latestRunId,
    hint: computeHint(rec, latestRunId),
  };
}

export function registerRecommendationRoutes(app: Express) {
  // List recommendations with optional filters. Reads are open to any
  // authenticated user.
  app.get("/api/recommendations", async (req, res) => {
    // #swagger.tags = ['Recommendations']
    // #swagger.parameters['state'] = { in: 'query', type: 'string', description: 'open | dismissed | actioned | resolved' }
    // #swagger.parameters['severity'] = { in: 'query', type: 'string', description: 'red | yellow | info' }
    // #swagger.parameters['detectorKey'] = { in: 'query', type: 'string' }
    // #swagger.parameters['hint'] = { in: 'query', type: 'string', description: 'Filter to those with a UI hint: resolved | back' }
    try {
      const stateParam = req.query.state as string | undefined;
      const severityParam = req.query.severity as string | undefined;
      const detectorKey = req.query.detectorKey as string | undefined;
      const hintParam = req.query.hint as string | undefined;

      const state = stateParam && (VALID_STATES as string[]).includes(stateParam)
        ? stateParam as RecommendationState : undefined;
      const severity = severityParam && (VALID_SEVERITIES as readonly string[]).includes(severityParam)
        ? severityParam as 'red' | 'yellow' | 'info' : undefined;

      const recs = await storage.getRecommendations({ state, severity, detectorKey });
      const latestRunId = await getLatestCompleteRunId();

      let decorated = recs.map(r => decorate(r, latestRunId));
      if (hintParam === 'resolved' || hintParam === 'back') {
        decorated = decorated.filter(r => r.hint === hintParam);
      }
      res.json(decorated);
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // Counts of recommendations grouped by detector_key, respecting the same
  // filters as /api/recommendations EXCEPT detectorKey itself. Used to
  // render counts next to each option in the detector dropdown — so the
  // user knows e.g. "Dead topic (5)" matches the current state/severity/
  // hint context, not the overall total.
  app.get("/api/recommendations/by-detector", async (req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const stateParam = req.query.state as string | undefined;
      const severityParam = req.query.severity as string | undefined;
      const hintParam = req.query.hint as string | undefined;

      const state = stateParam && (VALID_STATES as string[]).includes(stateParam)
        ? stateParam as RecommendationState : undefined;
      const severity = severityParam && (VALID_SEVERITIES as readonly string[]).includes(severityParam)
        ? severityParam as 'red' | 'yellow' | 'info' : undefined;

      const recs = await storage.getRecommendations({ state, severity });
      const latestRunId = await getLatestCompleteRunId();
      let decorated = recs.map(r => decorate(r, latestRunId));
      // Dismissed never count in the detector dropdown — the (X) is the
      // "actionable queue" indicator. Even on the Dismissed tab itself the
      // count would be uninformative, so just keep dismissed out everywhere.
      decorated = decorated.filter(r => r.state !== 'dismissed');
      if (hintParam === 'resolved' || hintParam === 'back') {
        decorated = decorated.filter(r => r.hint === hintParam);
      }
      const counts: Record<string, number> = {};
      for (const r of decorated) {
        counts[r.detectorKey] = (counts[r.detectorKey] || 0) + 1;
      }
      res.json(counts);
    } catch (error: any) {
      console.error("Error fetching detector counts:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch detector counts" });
    }
  });

  // Static list of registered detectors. Used by the UI to populate the
  // detector filter dropdown so it shows ALL detectors, not just the ones
  // that happen to appear in the currently-filtered result set.
  app.get("/api/recommendations/detectors", async (_req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const { DETECTOR_REGISTRY } = await import('../services/recommendations/registry');
      res.json(DETECTOR_REGISTRY.map(d => d.meta));
    } catch (error: any) {
      console.error("Error fetching detector registry:", error);
      res.status(500).json({ error: error?.message || "Failed to fetch detectors" });
    }
  });

  // Counts grouped by state — used for nav badge / page header chips.
  app.get("/api/recommendations/counts", async (_req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const counts = await storage.getRecommendationCounts();
      // Also surface hint counts. Cheap because the dataset is small (≤ a few
      // hundred recs) — pull the open+resolved sets and count.
      const [open, resolved, latestRunId] = await Promise.all([
        storage.getRecommendations({ state: 'open' }),
        storage.getRecommendations({ state: 'resolved' }),
        getLatestCompleteRunId(),
      ]);
      const actioned = await storage.getRecommendations({ state: 'actioned' });
      const hintResolved = open.concat(actioned).filter(r => computeHint(r, latestRunId) === 'resolved').length;
      const hintBack = resolved.filter(r => computeHint(r, latestRunId) === 'back').length;
      res.json({ ...counts, hintResolved, hintBack });
    } catch (error) {
      console.error("Error fetching recommendation counts:", error);
      res.status(500).json({ error: "Failed to fetch counts" });
    }
  });

  // Single recommendation including occurrences history.
  app.get("/api/recommendations/:id", async (req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be an integer" });
      const rec = await storage.getRecommendationById(id);
      if (!rec) return res.status(404).json({ error: "Not found" });
      const occurrences = await storage.getRecommendationOccurrences(id);
      const latestRunId = await getLatestCompleteRunId();
      res.json({ ...decorate(rec, latestRunId), occurrences });
    } catch (error) {
      console.error("Error fetching recommendation:", error);
      res.status(500).json({ error: "Failed to fetch recommendation" });
    }
  });

  // Wipe every recommendation + occurrence. Admin only — destructive,
  // typically used after killing a detector or for a fresh-state demo.
  // The next run-completion (or a manual recompute) will repopulate.
  app.delete("/api/recommendations", requireRole('admin'), async (_req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const result = await storage.clearAllRecommendations();
      res.json(result);
    } catch (error: any) {
      console.error("Error clearing recommendations:", error);
      res.status(500).json({ error: error?.message || "Failed to clear" });
    }
  });

  // Recompute recommendations against the latest complete run. Used to
  // backfill historic runs that completed before the detector pipeline
  // shipped, and as a manual "refresh" button on the page. Idempotent —
  // re-running over an already-processed run upserts cleanly.
  app.post("/api/recommendations/recompute", requireRole('analyst'), async (_req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const latestRunId = await getLatestCompleteRunId();
      if (latestRunId == null) {
        return res.status(409).json({ error: 'No completed analysis run yet — start one first.' });
      }
      const { runDetectors } = await import('../services/recommendations');
      const result = await runDetectors(latestRunId);
      res.json({ runId: latestRunId, count: result.count });
    } catch (error: any) {
      console.error("Error recomputing recommendations:", error);
      res.status(500).json({ error: error?.message || "Failed to recompute" });
    }
  });

  // Update state. Only an analyst+ can flip state — reads are open, writes
  // are gated. Body: { state }.
  app.put("/api/recommendations/:id/state", requireRole('analyst'), async (req, res) => {
    // #swagger.tags = ['Recommendations']
    try {
      const id = parseInt(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be an integer" });
      const next = req.body?.state as string | undefined;
      if (!next || !(VALID_STATES as string[]).includes(next)) {
        return res.status(400).json({ error: `state must be one of: ${VALID_STATES.join(', ')}` });
      }
      const userId = (req.user as any)?.id;
      if (!Number.isFinite(userId)) {
        return res.status(401).json({ error: "Authenticated user not resolved" });
      }
      const existing = await storage.getRecommendationById(id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      // Snapshot the latest *complete* run as the anchor for hint logic.
      // getLatestAnalysisRun returns the newest by id regardless of status;
      // we want the newest completed one so an in-progress run doesn't
      // become the user's anchor.
      const runs = await storage.getAnalysisRuns();
      const latestComplete = runs
        .filter(r => r.status === 'complete')
        .sort((a, b) => b.id - a.id)[0];
      const latestRunId = latestComplete?.id ?? null;
      await storage.updateRecommendationState(id, next as RecommendationState, userId, latestRunId);
      const updated = await storage.getRecommendationById(id);
      res.json(updated ? decorate(updated, latestRunId) : null);
    } catch (error) {
      console.error("Error updating recommendation state:", error);
      res.status(500).json({ error: "Failed to update state" });
    }
  });
}
