"""LEGACY: only for a database created *before Alembic* that also predates Phase 5.

Run it once, then baseline that database with `alembic stamp head`. New databases never need this:
`alembic upgrade head` (or `python -m app.init_db`) builds the whole schema.
"""

from __future__ import annotations

import os

from sqlalchemy import create_engine, text

from app.models import Base

STEPS = [
    # role enum: admin -> super_admin, + 2 internal roles (ALTER TYPE ... ADD VALUE needs autocommit)
    """DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                    WHERE t.typname = 'role_name' AND e.enumlabel = 'admin') THEN
           ALTER TYPE role_name RENAME VALUE 'admin' TO 'super_admin';
         END IF;
       END $$""",
    "ALTER TYPE role_name ADD VALUE IF NOT EXISTS 'recruiter_manager'",
    "ALTER TYPE role_name ADD VALUE IF NOT EXISTS 'content_editor'",
    """INSERT INTO roles (id, name, description) VALUES
         (4, 'recruiter_manager', 'Internal recruiter manager (all jobs, approvals, applications)'),
         (5, 'content_editor', 'Content editor (places, CMS, translations)')
       ON CONFLICT DO NOTHING""",
    "UPDATE roles SET description = 'Super administrator (everything, incl. user roles)' WHERE name = 'super_admin'",
    # places visibility, public display name, review note
    "ALTER TABLE regions ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true",
    "ALTER TABLE prefectures ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_display_name jsonb",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_note text",
    # Phase 3 index that create_all never added to existing tables
    "CREATE INDEX IF NOT EXISTS ix_jobs_title_all_trgm ON jobs USING gin ((title::text) gin_trgm_ops)",
]


def migrate(url: str | None = None) -> None:
    engine = create_engine(url or os.environ["DATABASE_URL"], isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        for sql in STEPS:
            conn.execute(text(sql))
    # new tables / enum types / sequence: translation_overrides, email_logs, email_status, job_code_seq
    Base.metadata.create_all(create_engine(url or os.environ["DATABASE_URL"]))
    print("Phase 5 migration done.")


if __name__ == "__main__":
    migrate()
