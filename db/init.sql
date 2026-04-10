-- Claude Memory Hub — initial schema
-- PostgreSQL 16
-- gen_random_uuid() is built-in since PostgreSQL 13; pgcrypto retained for gen_salt() etc.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS entries (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id              TEXT         NOT NULL,
    local_entry_id          TEXT         NOT NULL,
    title                   TEXT         NOT NULL,
    category                TEXT         NOT NULL,
    subcategory             TEXT,
    type                    TEXT         NOT NULL DEFAULT 'learning',
    severity                TEXT         NOT NULL DEFAULT 'minor',
    recurrence_count        INTEGER      NOT NULL DEFAULT 1,
    successful_applications INTEGER      NOT NULL DEFAULT 0,
    confidence_score        NUMERIC(4,3) NOT NULL DEFAULT 0.1
                                         CHECK (confidence_score BETWEEN 0 AND 1),
    tags                    TEXT[]       NOT NULL DEFAULT '{}',
    trigger_context         TEXT,
    root_cause              TEXT,
    what_happened           TEXT,
    correct_solution        TEXT,
    prevention_rule         TEXT,
    context_notes           TEXT,
    related_files           TEXT[]       NOT NULL DEFAULT '{}',
    related_entries         TEXT[]       NOT NULL DEFAULT '{}',
    content_hash            TEXT,
    first_seen              DATE         NOT NULL DEFAULT CURRENT_DATE,
    last_seen               DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    status                  TEXT         NOT NULL DEFAULT 'active'
                                         CHECK (status IN ('active', 'archived')),
    UNIQUE (machine_id, local_entry_id)
);

-- AUDIT-003: UPSERT function uses now() for updated_at, never EXCLUDED.updated_at.
-- This ensures server-side determinism under concurrent inserts — whichever packet
-- arrives first does NOT set the canonical timestamp; the DB clock does.
CREATE OR REPLACE FUNCTION upsert_entry(
    p_machine_id              TEXT,
    p_local_entry_id          TEXT,
    p_title                   TEXT,
    p_category                TEXT,
    p_subcategory             TEXT,
    p_type                    TEXT,
    p_severity                TEXT,
    p_recurrence_count        INTEGER,
    p_successful_applications INTEGER,
    p_confidence_score        NUMERIC,
    p_tags                    TEXT[],
    p_trigger_context         TEXT,
    p_root_cause              TEXT,
    p_what_happened           TEXT,
    p_correct_solution        TEXT,
    p_prevention_rule         TEXT,
    p_context_notes           TEXT,
    p_related_files           TEXT[],
    p_related_entries         TEXT[],
    p_content_hash            TEXT,
    p_first_seen              DATE,
    p_last_seen               DATE
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO entries (
        machine_id, local_entry_id, title, category, subcategory,
        type, severity, recurrence_count, successful_applications, confidence_score,
        tags, trigger_context, root_cause, what_happened, correct_solution,
        prevention_rule, context_notes, related_files, related_entries,
        content_hash, first_seen, last_seen
    ) VALUES (
        p_machine_id, p_local_entry_id, p_title, p_category, p_subcategory,
        p_type, p_severity, p_recurrence_count, p_successful_applications, p_confidence_score,
        p_tags, p_trigger_context, p_root_cause, p_what_happened, p_correct_solution,
        p_prevention_rule, p_context_notes, p_related_files, p_related_entries,
        p_content_hash, p_first_seen, p_last_seen
    )
    ON CONFLICT (machine_id, local_entry_id) DO UPDATE SET
        -- AUDIT-003: always use server time for updated_at
        updated_at              = now(),
        last_seen               = GREATEST(entries.last_seen, EXCLUDED.last_seen),
        recurrence_count        = GREATEST(entries.recurrence_count, EXCLUDED.recurrence_count),
        successful_applications = GREATEST(entries.successful_applications, EXCLUDED.successful_applications),
        confidence_score        = GREATEST(entries.confidence_score, EXCLUDED.confidence_score),
        what_happened           = EXCLUDED.what_happened,
        correct_solution        = EXCLUDED.correct_solution,
        prevention_rule         = EXCLUDED.prevention_rule,
        context_notes           = EXCLUDED.context_notes,
        content_hash            = EXCLUDED.content_hash
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entries_machine    ON entries(machine_id);
CREATE INDEX IF NOT EXISTS idx_entries_category   ON entries(category);
CREATE INDEX IF NOT EXISTS idx_entries_tags       ON entries USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_entries_status     ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_recurrence ON entries(recurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_entries_confidence ON entries(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_entries_last_seen  ON entries(last_seen DESC);

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_entries_fts ON entries USING gin(
    to_tsvector('english',
        coalesce(title, '') || ' ' ||
        coalesce(trigger_context, '') || ' ' ||
        coalesce(what_happened, '') || ' ' ||
        coalesce(prevention_rule, '')
    )
);
