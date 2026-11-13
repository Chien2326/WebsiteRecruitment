"""Application status history, CV access audit log, 5 MB CV limit in the DB, periodic maintenance."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import maintenance
from app.models import (
    EmailLog, EmployerInquiry, FileType, RefreshToken, Resume, ResumeAccessLog, RoleName,
    UserToken,
)
from tests.test_phase4 import csrf, db, s3, staff  # noqa: F401 - fixtures are registered by import
from tests.test_phase5 import _applied, mail  # noqa: F401


def test_status_history_is_recorded(db, s3, mail):
    rec, mgr, cand, job, rid, app_id = _applied(db, s3)
    for st in ("reviewing", "reviewing", "interview"):  # repeating a status adds nothing
        mgr.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": st, "notify": False}, headers=csrf(mgr))
    hist = mgr.get(f"/api/v1/admin/applications/{app_id}").json()["history"]
    assert [(h["from_status"], h["to_status"]) for h in hist] == [
        (None, "applied"), ("applied", "reviewing"), ("reviewing", "interview")]
    assert hist[0]["changed_by"].endswith("@example.com")  # the candidate
    assert hist[1]["changed_by"].startswith("recruiter_manager-")


def test_cv_access_is_audited_and_shown_to_managers_only(db, s3, mail):
    rec, mgr, cand, job, rid, app_id = _applied(db, s3)
    cand.get(f"/api/v1/resumes/{rid}/download-url")  # the owner: not logged
    rec.get(f"/api/v1/resumes/{rid}/download-url")
    mgr.get(f"/api/v1/resumes/{rid}/download-url", params={"inline": "true"})
    rows = db.scalars(select(ResumeAccessLog).where(ResumeAccessLog.resume_id == rid)).all()
    assert sorted((r.accessed_by_role, r.inline) for r in rows) == [("recruiter", False), ("recruiter_manager", True)]
    assert all(r.ip and r.candidate_id for r in rows)

    seen = mgr.get(f"/api/v1/admin/applications/{app_id}").json()["resume_access"]
    assert {(a["role"], a["inline"]) for a in seen} == {("recruiter", False), ("recruiter_manager", True)}
    assert rec.get(f"/api/v1/admin/applications/{app_id}").json()["resume_access"] is None  # client recruiter


def test_db_rejects_cv_over_5mb(db):
    owner, _ = staff(db, RoleName.SUPER_ADMIN)
    db.add(Resume(candidate_id=owner.id, s3_key=f"x/{uuid.uuid4()}.pdf", original_filename="big.pdf",
                  file_type=FileType.PDF, file_size_bytes=5 * 1024 * 1024 + 1))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_maintenance_cleans_only_what_is_old(db):
    user, _ = staff(db, RoleName.RECRUITER)
    now = datetime.now(timezone.utc)
    long_ago, recent = now - timedelta(days=30), now - timedelta(days=1)
    fam = uuid.uuid4()
    rt_old = RefreshToken(user_id=user.id, family_id=fam, token_hash=uuid.uuid4().hex * 2, expires_at=long_ago)
    rt_live = RefreshToken(user_id=user.id, family_id=fam, token_hash=uuid.uuid4().hex * 2, expires_at=now + timedelta(days=5))
    ut_recent = UserToken(user_id=user.id, purpose="reset_password", token_hash=uuid.uuid4().hex * 2, email=user.email,
                          expires_at=recent)  # expired yesterday: kept for the 7-day grace period
    ut_old = UserToken(user_id=user.id, purpose="verify_email", token_hash=uuid.uuid4().hex * 2, email=user.email,
                       expires_at=long_ago)
    db.add_all([rt_old, rt_live, ut_recent, ut_old])
    gone = EmployerInquiry(kind="general", contact_name="Old", email="old-lead@example.com", message="m", status="closed")
    kept = EmployerInquiry(kind="general", contact_name="Open", email="open-lead@example.com", message="m", status="new")
    db.add_all([gone, kept, EmailLog(to_email="old-lead@example.com", template="employer_inquiry_reply", locale="ja",
                                     subject="s")])
    db.flush()
    gone.updated_at = kept.updated_at = now - timedelta(days=400)
    db.flush()

    dry = maintenance.run(db, dry_run=True, now=now)
    assert dry["refresh_tokens"] >= 1 and dry["user_tokens"] >= 1 and dry["inquiries_closed"] >= 1
    assert db.get(EmployerInquiry, gone.id) is not None  # dry run deletes nothing

    ids = (rt_old.id, rt_live.id, ut_recent.id, ut_old.id)
    maintenance.run(db, now=now)
    db.expire_all()
    assert db.get(RefreshToken, ids[0]) is None and db.get(RefreshToken, ids[1]) is not None
    assert db.get(UserToken, ids[2]) is not None and db.get(UserToken, ids[3]) is None
    assert db.get(EmployerInquiry, gone.id) is None and db.get(EmployerInquiry, kept.id) is not None
    assert db.scalar(select(func.count()).select_from(EmailLog).where(EmailLog.to_email == "old-lead@example.com")) == 0
