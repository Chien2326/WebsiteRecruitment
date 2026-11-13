"""Alembic environment for the Haken Work backend.

* Database URL: `DATABASE_URL` from the process environment, else from `backend/.env`
  (an already-set environment variable always wins). Override per command with `-x db_url=...`.
* `target_metadata = Base.metadata` from app.models, so `alembic revision --autogenerate` sees every model.
* Deliberately does NOT import app.config: migrations must not need JWT/S3/OAuth secrets.
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool

from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)  # keep the app's loggers alive

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

target_metadata = Base.metadata


def _database_url() -> str:
    url = context.get_x_argument(as_dictionary=True).get("db_url") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Put it in backend/.env or export it, e.g.\n"
            "  DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/recruit"
        )
    return url


def include_object(obj, name, type_, reflected, compare_to):
    # Alembic's own bookkeeping table is not part of the app schema.
    return not (type_ == "table" and name == "alembic_version")


COMMON = dict(
    target_metadata=target_metadata,
    compare_type=True,  # detect column type changes (e.g. String(100) -> String(200))
    include_object=include_object,
)


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql`: emit SQL to stdout for review / DBA hand-off, without connecting."""
    context.configure(url=_database_url(), literal_binds=True, dialect_opts={"paramstyle": "named"}, **COMMON)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Tests (and init_db) may hand us an open connection: config.attributes["connection"].
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(connection=connection, **COMMON)
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, **COMMON)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
