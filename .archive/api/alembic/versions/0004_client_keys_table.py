"""client_keys table: per-machine API keys with hashed storage.

AUDIT-016: replaces shared env API_KEY with per-client attribution, enables
targeted revocation, and logs failed-auth attempts by CN.
"""
from alembic import op


revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS client_keys (
            id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            key_hash     TEXT         NOT NULL UNIQUE,
            client_cn    TEXT         NOT NULL,
            description  TEXT,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
            revoked_at   TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ
        );
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_client_keys_hash ON client_keys(key_hash) "
        "WHERE revoked_at IS NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_client_keys_cn ON client_keys(client_cn);"
    )

    op.execute("""
        CREATE TABLE IF NOT EXISTS auth_failures (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            attempted_cn TEXT,
            reason      TEXT        NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_failures_cn ON auth_failures(attempted_cn);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_auth_failures_occurred ON auth_failures(occurred_at DESC);"
    )


def downgrade() -> None:
    # Dropping the tables would delete client-key attribution and audit history.
    # Intentional no-op per the destructive_action_guard.
    pass
