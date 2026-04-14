"""add client_type column and redefine upsert_entry — mirrors db/migrations/001-add-client-type.sql.

Model-agnostic client identification (Batch C).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE entries ADD COLUMN IF NOT EXISTS client_type "
        "TEXT NOT NULL DEFAULT 'claude-code';"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_entries_client_type ON entries(client_type);"
    )

    # Redefine upsert_entry to accept the new p_client_type parameter.
    # CREATE OR REPLACE is idempotent; safe to re-run on live DB.
    op.execute(
        """
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
            p_last_seen               DATE,
            p_client_type             TEXT DEFAULT 'claude-code'
        ) RETURNS UUID AS $$
        DECLARE
            v_id UUID;
        BEGIN
            INSERT INTO entries (
                machine_id, local_entry_id, title, category, subcategory,
                type, severity, recurrence_count, successful_applications, confidence_score,
                tags, trigger_context, root_cause, what_happened, correct_solution,
                prevention_rule, context_notes, related_files, related_entries,
                content_hash, first_seen, last_seen, client_type
            ) VALUES (
                p_machine_id, p_local_entry_id, p_title, p_category, p_subcategory,
                p_type, p_severity, p_recurrence_count, p_successful_applications, p_confidence_score,
                p_tags, p_trigger_context, p_root_cause, p_what_happened, p_correct_solution,
                p_prevention_rule, p_context_notes, p_related_files, p_related_entries,
                p_content_hash, p_first_seen, p_last_seen, p_client_type
            )
            ON CONFLICT (machine_id, local_entry_id) DO UPDATE SET
                updated_at              = now(),
                last_seen               = GREATEST(entries.last_seen, EXCLUDED.last_seen),
                recurrence_count        = GREATEST(entries.recurrence_count, EXCLUDED.recurrence_count),
                successful_applications = GREATEST(entries.successful_applications, EXCLUDED.successful_applications),
                confidence_score        = GREATEST(entries.confidence_score, EXCLUDED.confidence_score),
                what_happened           = EXCLUDED.what_happened,
                correct_solution        = EXCLUDED.correct_solution,
                prevention_rule         = EXCLUDED.prevention_rule,
                context_notes           = EXCLUDED.context_notes,
                content_hash            = EXCLUDED.content_hash,
                client_type             = EXCLUDED.client_type
            RETURNING id INTO v_id;

            RETURN v_id;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    # Reverting client_type would drop data (the column value) from every row.
    # Intentional no-op per CLAUDE.md destructive_action_guard.
    pass
