"""Integration tests for Phase 1 against a real PostgreSQL.

Run:  DATABASE_URL=postgresql+psycopg://postgres@localhost:55432/recruit pytest -q
(the DB must already be initialised with `python -m app.init_db`)
"""

from __future__ import annotations

import os
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models import (
    Application, CandidateProfile, Job, JobEndClient, JobStatus, Resume, Role, RoleName,
    SalaryType, SocialAccount, SocialProvider, User, FileType,
)
from app.schemas import (
    JobAdmin, JobCreate, JobListItem, JobPublic, UserRegister, localize,
)

engine = create_engine(os.environ["DATABASE_URL"])


@pytest.fixture()
def s():
    """Every test runs in a transaction that is rolled back."""
    conn = engine.connect()
    tx = conn.begin()
    sess = Session(bind=conn, join_transaction_mode="create_savepoint")
    yield sess
    sess.close()
    tx.rollback()
    conn.close()


def mk_user(s: Session, role: RoleName, email: str | None = None) -> User:
    rid = s.scalar(select(Role.id).where(Role.name == role))
    u = User(email=email or f"{uuid.uuid4().hex[:8]}@example.com", role_id=rid)
    s.add(u)
    s.flush()
    return u


def mk_job(s: Session, owner: User, **kw) -> Job:
    base = dict(
        job_code=f"HK-{uuid.uuid4().hex[:10]}",
        title={"ja": "倉庫作業", "en": "Warehouse"},
        description={"ja": "説明"},
        salary_type=SalaryType.HOURLY, salary_min=1200, salary_max=1500,
        prefecture_id=23, status=JobStatus.PUBLISHED, created_by=owner.id,
    )
    base.update(kw)
    j = Job(**base)
    s.add(j)
    s.flush()
    return j


# ------------------------------------------------------------------ seed
def test_seed_counts(s: Session):
    assert s.scalar(text("select count(*) from prefectures")) == 47
    assert s.scalar(text("select count(*) from regions")) == 8
    assert {r for (r,) in s.execute(text("select name from roles"))} == {"super_admin", "candidate", "recruiter", "recruiter_manager", "content_editor"}


# ------------------------------------------------------------------ users / auth
def test_email_unique_case_insensitive(s: Session):
    mk_user(s, RoleName.CANDIDATE, "Foo@Example.com")
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            mk_user(s, RoleName.CANDIDATE, "foo@example.COM")


def test_social_account_unique_per_provider_sub(s: Session):
    a, b = mk_user(s, RoleName.CANDIDATE), mk_user(s, RoleName.CANDIDATE)
    s.add(SocialAccount(user_id=a.id, provider=SocialProvider.GOOGLE, provider_user_id="sub-1"))
    s.flush()
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(SocialAccount(user_id=b.id, provider=SocialProvider.GOOGLE, provider_user_id="sub-1"))
            s.flush()


def test_register_cannot_self_assign_admin():
    with pytest.raises(ValidationError):
        UserRegister(email="a@b.com", password="longenough123", role=RoleName.SUPER_ADMIN)


# ------------------------------------------------------------------ jobs: constraints
def test_job_requires_ja_title(s: Session):
    r = mk_user(s, RoleName.RECRUITER)
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            mk_job(s, r, title={"en": "only english"})


def test_job_salary_range_check(s: Session):
    r = mk_user(s, RoleName.RECRUITER)
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            mk_job(s, r, salary_min=1500, salary_max=1200)


def test_title_ja_generated_column(s: Session):
    r = mk_user(s, RoleName.RECRUITER)
    j = mk_job(s, r)
    s.refresh(j)
    assert j.title_ja == "倉庫作業"


# ------------------------------------------------------------------ jobs: end-client secrecy
def test_end_client_never_leaks_through_public_schemas(s: Session):
    r = mk_user(s, RoleName.RECRUITER)
    j = mk_job(s, r)
    s.add(JobEndClient(job_id=j.id, end_client_name="トヨタ自動車株式会社"))
    s.commit() if False else s.flush()
    s.expire_all()

    job = s.scalar(select(Job).where(Job.id == j.id))
    # 1. ORM guard: touching the relation without loading it raises instead of silently querying
    with pytest.raises(Exception):
        _ = job.end_client

    # 2. Public serialization has no trace of the name
    public = JobPublic.model_validate(job, from_attributes=True).model_dump_json()
    card = JobListItem.model_validate(job, from_attributes=True).model_dump_json()
    for blob in (public, card):
        assert "トヨタ" not in blob and "end_client" not in blob

    # 3. Admin path (explicit eager load) does carry it
    job_admin = s.scalar(select(Job).options(selectinload(Job.end_client)).where(Job.id == j.id))
    assert job_admin.end_client.end_client_name == "トヨタ自動車株式会社"
    assert "end_client_name" in JobAdmin.model_fields
    assert "end_client_name" not in JobPublic.model_fields


# ------------------------------------------------------------------ candidates / resumes / applications
def test_application_flow_and_constraints(s: Session):
    rec, cand = mk_user(s, RoleName.RECRUITER), mk_user(s, RoleName.CANDIDATE)
    s.add(CandidateProfile(user_id=cand.id, first_name="An", last_name="Nguyen"))
    j = mk_job(s, rec)
    s.flush()

    r1 = Resume(candidate_id=cand.id, s3_key=f"resumes/{cand.id}/a.pdf", original_filename="a.pdf",
                file_type=FileType.PDF, file_size_bytes=1000, is_default=True)
    s.add(r1)
    s.flush()

    # only one default resume
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(Resume(candidate_id=cand.id, s3_key=f"resumes/{cand.id}/b.pdf", original_filename="b.pdf",
                         file_type=FileType.PDF, file_size_bytes=10, is_default=True))
            s.flush()
    # 10MB cap
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(Resume(candidate_id=cand.id, s3_key=f"resumes/{cand.id}/c.pdf", original_filename="c.pdf",
                         file_type=FileType.PDF, file_size_bytes=11 * 1024 * 1024))
            s.flush()

    s.add(Application(job_id=j.id, candidate_id=cand.id, resume_id=r1.id))
    s.flush()
    # no double-apply
    with pytest.raises(IntegrityError):
        with s.begin_nested():
            s.add(Application(job_id=j.id, candidate_id=cand.id))
            s.flush()


# ------------------------------------------------------------------ schemas
def test_jobcreate_validation():
    ok = dict(
        title={"ja": "x", "en": "y"}, description={"ja": "d"}, salary_type="hourly",
        salary_min=1200, salary_max=1500, prefecture_id=13, end_client_name="ACME",
    )
    JobCreate(**ok)
    with pytest.raises(ValidationError):
        JobCreate(**{**ok, "title": {"en": "no ja"}})
    with pytest.raises(ValidationError):
        JobCreate(**{**ok, "title": {"ja": "x", "fr": "unsupported"}})
    with pytest.raises(ValidationError):
        JobCreate(**{**ok, "salary_max": 1000})
    with pytest.raises(ValidationError):
        JobCreate(**{**ok, "prefecture_id": 48})


def test_localize_fallback():
    v = {"ja": "日本語", "en": "English"}
    assert localize(v, "vi") == "日本語"
    assert localize(v, "en") == "English"


# ------------------------------------------------------------------ indexing
def test_prefecture_search_uses_partial_indexes(s: Session):
    """Skewed data (like real life: Tokyo common, Okinawa rare). The planner must never seq-scan or sort."""
    rec = mk_user(s, RoleName.RECRUITER)
    s.execute(text("""
        INSERT INTO jobs (id, job_code, title, description, salary_type, salary_min, salary_max,
                          prefecture_id, status, published_at, created_by)
        SELECT gen_random_uuid(), 'T-' || g, '{"ja":"求人"}', '{"ja":"d"}', 'hourly', 1000 + g % 800, 2000,
               CASE WHEN g % 100 = 0 THEN 47 WHEN g % 10 < 3 THEN 13 ELSE 1 + g % 46 END,
               'published'::job_status, now() - (g || ' seconds')::interval, :uid
        FROM generate_series(1, 100000) g
    """), {"uid": rec.id})
    s.execute(text("ANALYZE jobs"))

    def plan(pref: int) -> str:
        return "\n".join(r[0] for r in s.execute(text(
            "EXPLAIN SELECT id FROM jobs WHERE status='published' AND prefecture_id = :p "
            "ORDER BY published_at DESC LIMIT 20"), {"p": pref}))

    common, rare = plan(13), plan(47)
    for p in (common, rare):
        assert "Seq Scan" not in p and "Sort" not in p, p
    # common prefecture: newest-first index + filter is cheapest; rare: dedicated per-prefecture index
    assert "ix_jobs_pub_recent" in common or "ix_jobs_pub_pref_recent" in common, common
    assert "ix_jobs_pub_pref_recent" in rare, rare
