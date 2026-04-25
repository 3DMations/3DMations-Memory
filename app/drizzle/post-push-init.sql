-- Run AFTER `drizzle-kit push` creates sessions/memories tables.
-- Adds extensions and GIN indexes that drizzle-kit push does not synthesize.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_title_trgm
  ON memories USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_memories_content_trgm
  ON memories USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_memories_tags
  ON memories USING gin (tags);

INSERT INTO schema_version (version, description)
VALUES (1, 'initial schema — PG18 with uuidv7')
ON CONFLICT (version) DO NOTHING;
