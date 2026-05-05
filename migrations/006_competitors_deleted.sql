-- Soft-delete flag for competitors. Set by the prompt-generator "remove
-- competitor" action and the analyzer's filter-out-already-removed check
-- when running in dynamic mode. Historical competitor_mentions stay intact.

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE;
