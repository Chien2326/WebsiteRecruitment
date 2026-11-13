"""Job view counter + admin analytics page."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models import Job, JobStatus, JobViewDaily, RoleName
from app.ratelimit import limiter
from tests.test_account import post, signup
from tests.test_phase4 import csrf, db, new_client, staff  # noqa: F401 - fixtures are registered by import
from tests.test_search import job


def test_view_counter_dedups_and_hides_nothing_personal(db):
    owner, _ = staff(db, RoleName.RECRUITER)
    j = job(db, owner, "vw")
    hidden = job(db, owner, "vw", status=JobStatus.ARCHIVED)
    limiter.reset()
    c = new_client()
    # no CSRF header needed (anonymous counter), and a reload within 30 min counts once
    assert c.post(f"/api/v1/jobs/{j.id}/views").status_code == 204
    assert c.post(f"/api/v1/jobs/{j.id}/views").status_code == 204
    db.refresh(j)
    assert j.view_count == 1
    rows = db.scalars(select(JobViewDaily).where(JobViewDaily.job_id == j.id)).all()
    assert len(rows) == 1 and rows[0].views == 1
    assert set(JobViewDaily.__table__.columns.keys()) == {"job_id", "day", "views"}  # counters only, no visitor data
    # another visitor -> second view (same day row)
    limiter.reset()
    assert new_client().post(f"/api/v1/jobs/{j.id}/views").status_code == 204
    db.refresh(rows[0])
    assert rows[0].views == 2
    # hidden / unknown jobs are not counted
    assert new_client().post(f"/api/v1/jobs/{hidden.id}/views").status_code == 404
    assert new_client().post(f"/api/v1/jobs/{uuid.uuid4()}/views").status_code == 404
    assert new_client().post("/api/v1/jobs/not-a-uuid/views").status_code == 422
    # CSRF exemption is only for this counter
    assert new_client().post("/api/v1/me/saved-jobs/x").status_code in (403, 405)
    limiter.reset()


def test_analytics_scope_and_shape(db):
    manager, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    rec_user, rec = staff(db, RoleName.RECRUITER)
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    mine = job(db, rec_user, "an", prefecture_id=27)
    other = job(db, manager, "an")
    limiter.reset()
    for _ in range(3):
        limiter.reset()
        new_client().post(f"/api/v1/jobs/{mine.id}/views")
    cand, _ = signup()
    cand.put("/api/v1/me/profile", json={"first_name": "Taro", "last_name": "Yamada"}, headers=csrf(cand))
    assert post(cand, "/api/v1/applications", {"job_id": str(mine.id)}).status_code == 201
    limiter.reset()

    r = mgr.get("/api/v1/admin/analytics")
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["weeks"]) == 12 and d["weeks"][-1]["applications"] >= 1 and d["weeks"][-1]["views"] >= 3
    assert d["totals"]["signups_30d"] >= 1 and d["weeks"][-1]["signups"] >= 1
    assert d["status"]["applied"] >= 1 and set(d["status"]) == {"applied", "reviewing", "interview", "accepted", "rejected"}
    assert any(t["job_code"] == mine.job_code and t["views_30d"] == 3 and t["applications_30d"] == 1 for t in d["top_jobs"])
    assert any(p["id"] == 27 for p in d["prefectures"])
    assert not any("end_client" in k for t in d["top_jobs"] for k in t)

    # client recruiter: own jobs only, no company-wide sign-up numbers
    d2 = rec.get("/api/v1/admin/analytics", params={"weeks": 4}).json()
    assert len(d2["weeks"]) == 4 and d2["totals"]["signups_30d"] is None and d2["weeks"][0]["signups"] is None
    codes = {t["job_code"] for t in d2["top_jobs"]}
    assert mine.job_code in codes and other.job_code not in codes
    assert d2["totals"]["views_30d"] == 3 and d2["totals"]["applications_30d"] == 1

    assert editor.get("/api/v1/admin/analytics").status_code == 403
    assert new_client().get("/api/v1/admin/analytics").status_code == 401
    assert mgr.get("/api/v1/admin/analytics", params={"weeks": 99}).status_code == 422
    # admin job list carries the view count
    items = rec.get("/api/v1/admin/jobs", params={"q": mine.job_code}).json()["items"]
    assert items[0]["view_count"] == 3
