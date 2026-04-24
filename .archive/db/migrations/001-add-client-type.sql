-- Migration 001: add client_type column for model-agnostic clients
-- Run manually against existing containers: docker exec -i memory-db psql -U claude -d claude_memory < db/migrations/001-add-client-type.sql
ALTER TABLE entries ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'claude-code';
CREATE INDEX IF NOT EXISTS idx_entries_client_type ON entries(client_type);
-- Note: upsert_entry() function must be redefined from init.sql after this migration to accept the new parameter.
-- The function body in init.sql is idempotent (CREATE OR REPLACE) — re-running it is safe.
