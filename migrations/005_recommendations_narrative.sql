-- Switch recommendation body from markdown text to a structured JSONB
-- `narrative` field. The user is expected to clear existing recommendations
-- before/after this migration; old rows have their body lost.
--
-- Schema-only — narrative is populated by detectors on the next run.

ALTER TABLE recommendations DROP COLUMN IF EXISTS body;
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS narrative JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE recommendation_occurrences DROP COLUMN IF EXISTS body;
ALTER TABLE recommendation_occurrences
  ADD COLUMN IF NOT EXISTS narrative JSONB NOT NULL DEFAULT '{}'::jsonb;
