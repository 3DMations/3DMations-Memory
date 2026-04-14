"""Alembic environment — synchronous psycopg driver.

Reads DATABASE_URL from the environment (same var used by main.py) and
strips the +asyncpg suffix so Alembic can run with a sync driver.
"""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Alembic Config object — gives access to values in alembic.ini
config = context.config

# Configure Python logging via alembic.ini if present
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No SQLAlchemy ORM metadata — this project uses raw SQL via text() queries.
# Autogenerate is not used; migrations are written by hand with op.execute().
target_metadata = None


def _resolve_database_url() -> str:
    """Return a sync-driver DSN derived from DATABASE_URL."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set — Alembic "
            "cannot determine where to connect."
        )
    # Convert asyncpg URL → psycopg v3 sync URL.
    # e.g. postgresql+asyncpg://u:p@h/db → postgresql+psycopg://u:p@h/db
    # Using the +psycopg prefix forces SQLAlchemy to the modern psycopg3 driver
    # (installed as psycopg[binary] in requirements.txt) rather than legacy psycopg2.
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql+psycopg://" + url[len("postgresql+asyncpg://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emit SQL to stdout, no DB."""
    url = _resolve_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    ini_section = config.get_section(config.config_ini_section) or {}
    ini_section["sqlalchemy.url"] = _resolve_database_url()

    connectable = engine_from_config(
        ini_section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
