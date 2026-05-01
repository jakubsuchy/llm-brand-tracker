-- Anchors the "is there NEW evidence since the user's decision?" check that
-- drives the UI hint. NULL means the state was never user-changed
-- (system-default 'open') — `first_seen_run_id` is the implicit anchor in
-- that case.

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS state_changed_at_run_id INTEGER REFERENCES analysis_runs(id);
