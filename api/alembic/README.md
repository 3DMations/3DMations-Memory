# Alembic migrations — 3DMations Memory Hub

This directory contains the schema migration history for the Memory Hub
Postgres database (AUDIT-006). Migrations run automatically at API
container start via the `alembic upgrade head` prefix in `api/Dockerfile`.

## Relationship to `db/init.sql`

`db/init.sql` remains the reference schema and the bootstrap used by
Postgres on first container boot. Alembic migrations recreate the same
schema state, using `IF NOT EXISTS` / `CREATE OR REPLACE` so they are
idempotent against an already-initialized database.

Going forward, schema changes are added as new Alembic migrations only.
`db/init.sql` may be updated in lockstep so a brand-new hub still bootstraps
correctly, but the migration chain is the source of truth.

## Revision chain

- `0001_baseline_schema.py` — baseline matching `db/init.sql.bak`
  (pre-Batch-C form: no `client_type` column).
- `0002_add_client_type.py` — adds `client_type` column, index, and
  redefines `upsert_entry()`. Mirrors `db/migrations/001-add-client-type.sql`.

## Running against an existing, live database

The production Memory Hub DB was provisioned from `db/init.sql` before
Alembic existed and already has all Batch C changes applied. To adopt
Alembic without re-running DDL, mark baseline as applied first:

```bash
docker compose build api
docker compose run --rm api alembic stamp 0001
docker compose run --rm api alembic upgrade head
```

The second command applies `0002`. It is idempotent (`IF NOT EXISTS` /
`CREATE OR REPLACE`), so it is safe to run on a DB that already has the
column.

## Writing new migrations

1. Create a new file `api/alembic/versions/NNNN_short_slug.py`.
2. Set `revision = 'NNNN'` and `down_revision = '<previous>'`.
3. Use `op.execute("...")` for raw SQL — the hub does not use SQLAlchemy
   ORM models, so `target_metadata` is `None` and autogenerate is unused.
4. Prefer idempotent DDL (`IF NOT EXISTS`, `CREATE OR REPLACE`) when
   feasible so the migration can be re-applied safely.
5. Keep `downgrade()` a no-op when the rollback would destroy data —
   see `CLAUDE.md` destructive action guard.

## Connection URL handling

`env.py` reads `DATABASE_URL` from the environment (the same variable
`main.py` uses) and strips the `+asyncpg` driver suffix so Alembic's
synchronous engine can connect. No separate Alembic-only env var is
required.
