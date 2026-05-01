-- Persistent recommendations + per-run occurrence history.
-- See shared/schema.ts for column-level commentary.

CREATE TABLE IF NOT EXISTS recommendations (
  id                   SERIAL PRIMARY KEY,
  fingerprint          TEXT NOT NULL UNIQUE,
  fingerprint_version  INTEGER NOT NULL DEFAULT 1,
  detector_key         TEXT NOT NULL,
  severity             TEXT NOT NULL,
  title                TEXT NOT NULL,
  body                 TEXT NOT NULL,
  evidence_json        JSONB NOT NULL,
  related_entities     JSONB NOT NULL,
  impact_score         REAL NOT NULL,
  state                TEXT NOT NULL DEFAULT 'open',
  state_changed_by     INTEGER REFERENCES users(id),
  state_changed_at     TIMESTAMP,
  state_changed_at_run_id INTEGER REFERENCES analysis_runs(id),
  first_seen_run_id    INTEGER NOT NULL REFERENCES analysis_runs(id),
  last_seen_run_id     INTEGER NOT NULL REFERENCES analysis_runs(id),
  total_occurrences    INTEGER NOT NULL DEFAULT 1,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recommendations_state_last_seen_idx
  ON recommendations (state, last_seen_run_id);
CREATE INDEX IF NOT EXISTS recommendations_severity_impact_idx
  ON recommendations (severity, impact_score);
CREATE INDEX IF NOT EXISTS recommendations_detector_key_idx
  ON recommendations (detector_key);

CREATE TABLE IF NOT EXISTS recommendation_occurrences (
  id                  SERIAL PRIMARY KEY,
  recommendation_id   INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
  analysis_run_id     INTEGER NOT NULL REFERENCES analysis_runs(id),
  severity            TEXT NOT NULL,
  evidence_json       JSONB NOT NULL,
  body                TEXT NOT NULL,
  impact_score        REAL NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (recommendation_id, analysis_run_id)
);

CREATE INDEX IF NOT EXISTS recommendation_occurrences_run_idx
  ON recommendation_occurrences (analysis_run_id);
