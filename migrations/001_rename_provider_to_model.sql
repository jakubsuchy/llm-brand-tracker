-- Rename provider column to model across all tables
ALTER TABLE responses RENAME COLUMN provider TO model;
ALTER TABLE source_urls RENAME COLUMN provider TO model;
ALTER TABLE job_queue RENAME COLUMN provider TO model;
ALTER TABLE apify_usage RENAME COLUMN provider TO model;
