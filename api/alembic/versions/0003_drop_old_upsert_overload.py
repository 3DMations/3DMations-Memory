"""drop the legacy 22-arg upsert_entry overload left behind after Batch C.

Two `upsert_entry(...)` function overloads coexisted after Batch C because
CREATE OR REPLACE only matches on signature. The 22-arg version is unreachable
from the API (named binds always resolve to the 23-arg version with
p_client_type DEFAULT), but keeping the dead overload is a footgun for any
future positional-arg caller. Explicit user approval obtained before running
this destructive DROP.
"""
from alembic import op


revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DROP FUNCTION IF EXISTS upsert_entry(
            text, text, text, text, text, text, text, integer, integer,
            numeric, text[], text, text, text, text, text, text, text[],
            text[], text, date, date
        );
        """
    )


def downgrade() -> None:
    # Reintroducing the dead 22-arg overload would bring back the original
    # footgun. Intentional no-op.
    pass
