# Haken Work — Backend (FastAPI)

## Setup

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
cp .env.example .env                              # then set DATABASE_URL (and JWT_SECRET outside dev)
python -m app.init_db                             # schema (alembic upgrade head) + reference data
python -m app.seed_data                           # optional: 15 sample jobs
python -m app.create_staff admin@example.com super_admin   # first admin account
uvicorn app.main:app --reload --port 8000
```

`DATABASE_URL` is read from the environment, else from `backend/.env` (a real environment variable always wins).
Examples below use `alembic`; on Windows that is `.venv\Scripts\alembic.exe` (or activate the venv first).

## Database schema = Alembic migrations

The schema is owned by the migrations in `alembic/versions/`. Never use `create_all()` on a real database.
`alembic/env.py` imports `Base.metadata` from `app/models.py`, so `--autogenerate` sees every model.

### Changing the schema — 3 steps

1. **Edit `app/models.py`** (add a column, table, index…).
2. **Generate a migration** and *read it before committing*:
   ```bash
   alembic revision --autogenerate -m "add line_id to candidates_profile"
   ```
3. **Apply it**:
   ```bash
   alembic upgrade head
   ```

Commit the model change and the new file in `alembic/versions/` together.
`pytest` (tests/test_migrations.py) fails if `models.py` and the migrations drift apart.

### Things autogenerate does NOT detect — write them by hand in the migration

| Change | What to write |
|---|---|
| New value in a PostgreSQL enum (e.g. a new role) | `op.execute("ALTER TYPE role_name ADD VALUE IF NOT EXISTS 'x'")` |
| Rename a column / table | `op.alter_column(..., new_column_name=...)` (autogenerate sees drop + add = data loss!) |
| Sequences, extensions | `op.execute(...)` (see the initial migration) |
| Data changes (backfills, reference rows) | `op.execute(...)` / `op.bulk_insert(...)` |
| Dropping an enum type in `downgrade()` | `op.execute("DROP TYPE IF EXISTS ...")` |

### Useful commands

```bash
alembic current                 # revision the database is at
alembic history                 # all revisions
alembic check                   # exits non-zero if models.py has changes without a migration
alembic upgrade head --sql      # print the SQL instead of running it (review / hand to a DBA)
alembic downgrade -1            # undo the last migration
alembic -x db_url=postgresql+psycopg://...  upgrade head   # target another database
```

### Databases created before Alembic

A database built earlier with `create_all()` already has the tables, so `upgrade head` would fail on
`CREATE TABLE`. Bring it to the current schema once and record the baseline:

```bash
python -m app.migrate_phase5    # only if it predates Phase 5
alembic stamp head              # "this database is already at head"
```

`python -m app.init_db` refuses to run on such a database until it is stamped.

## Accounts & email

| Flow | Endpoint | Email sent |
|---|---|---|
| Sign up | `POST /api/v1/auth/register` | verify link (24 h), doubles as welcome mail |
| Resend verification | `POST /api/v1/auth/email/resend-verification` | verify link (max 3/h) |
| Open an emailed link | `POST /api/v1/auth/email/confirm {token}` | change-email: notice to the OLD address |
| Forgot password | `POST /api/v1/auth/password/forgot {email}` | reset link (30 min); same answer for unknown emails |
| Reset password | `POST /api/v1/auth/password/reset {token, new_password}` | "password changed"; all sessions revoked |
| Change password | `PUT /api/v1/account/password` | "password changed"; other devices signed out |
| Change email | `POST /api/v1/account/email` | confirm link to the NEW address (24 h) |
| Link Google/Apple | `GET /api/v1/auth/oauth/{p}/login?link=1&next=...` | – |
| Unlink | `DELETE /api/v1/account/social/{p}` | – (refused if it is the last way to log in) |
| Delete account (APPI) | `POST /api/v1/account/delete` | goodbye mail (not logged) |
| Apply to a job | `POST /api/v1/applications` | "application received" |
| Employer contact form | `POST /api/v1/employers/inquiries` | notice to `ADMIN_NOTIFY_EMAIL` + auto-reply (no visitor text) |

News (お知らせ): public `GET /api/v1/news`, `GET /api/v1/news/{slug}`; admin `/api/v1/admin/news` (cms.write).
Employer inquiries: admin `/api/v1/admin/inquiries` (inquiries.manage = recruiter_manager, super_admin).

* Links carry a single-use random token; only its SHA-256 is stored (`user_tokens`). A newer link voids older ones.
* Password change/reset bumps `users.token_version`, so every existing access token dies at once (not after 15 min).
* Sensitive changes ask for the current password (OAuth-only accounts have none: they confirm by typing their email
  to delete, and can *set* a first password).
* Delete removes profile, CVs (DB + S3 objects), applications, sessions, tokens; `email_logs.to_email` is redacted.
* Real sending: `MAIL_BACKEND=smtp` + `SMTP_*` (see `.env.example`, SES or SendGrid). Also set SPF/DKIM/DMARC on
  the sending domain, otherwise the mails land in spam.

## Daily maintenance

```bash
python -m app.maintenance --dry-run   # what would be deleted
python -m app.maintenance             # delete: expired sessions/links, old closed inquiries, old email logs
```
Schedule it once a day (Task Scheduler / cron). Retention: `INQUIRY_RETENTION_DAYS` (365),
`EMAIL_LOG_RETENTION_DAYS` (730). The CV access audit (`resume_access_logs`) and status history are kept.

## Tests

```bash
DATABASE_URL=postgresql+psycopg://postgres@localhost:5432/recruit pytest -q
```
Migration tests create and drop throw-away databases (`mig_test_*`); they are skipped if the DB user
lacks `CREATEDB`.
