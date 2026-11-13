"""Job search (filters + pagination), job expiry, saved jobs (お気に入り)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import (
    EmploymentType, JapaneseLevel, Job, JobStatus, RoleName, SalaryType, SavedJob, VisaType,
)
from tests.test_account import post, signup
from tests.test_phase4 import csrf, db, new_client, staff  # noqa: F401 - fixtures are registered by import


def job(db, owner, tag: str, **over) -> Job:
    """A published job whose title contains `tag` (so each test searches only its own rows)."""
    fields = dict(job_code=f"T-{uuid.uuid4().hex[:10]}", title={"ja": f"{tag} 倉庫", "en": f"{tag} warehouse"},
                  description={"ja": "d"}, salary_type=SalaryType.HOURLY, salary_min=1200, prefecture_id=13,
                  status=JobStatus.PUBLISHED, published_at=datetime.now(timezone.utc), created_by=owner.id)
    fields.update(over)
    j = Job(**fields)
    db.add(j)
    db.flush()
    return j


def search(**params):
    r = new_client().get("/api/v1/jobs/search", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def codes(page) -> set[str]:
    return {i["job_code"] for i in page["items"]}


def test_filters(db):
    owner, _ = staff(db, RoleName.RECRUITER)
    tag = f"zz{uuid.uuid4().hex[:6]}"
    n5 = job(db, owner, tag, japanese_level_required=JapaneseLevel.N5, features=["dormitory", "no_experience"])
    n2 = job(db, owner, tag, japanese_level_required=JapaneseLevel.N2, salary_min=1500, salary_max=1800,
             employment_type=EmploymentType.PART_TIME, prefecture_id=27)
    monthly = job(db, owner, tag, salary_type=SalaryType.MONTHLY, salary_min=250000, features=["dormitory"])
    visa = db.scalar(select(VisaType).where(VisaType.code == "student"))
    n2.visa_types = [visa]
    db.flush()

    assert codes(search(q=tag)) == {n5.job_code, n2.job_code, monthly.job_code}
    # "I have N4": jobs needing none/N5/N4 only
    assert codes(search(q=tag, level="n4")) == {n5.job_code, monthly.job_code}
    assert codes(search(q=tag, level="n1")) == {n5.job_code, n2.job_code, monthly.job_code}
    assert codes(search(q=tag, visa="student")) == {n2.job_code}
    # hourly >= 1,600 uses the top of the range; monthly jobs never match an hourly filter
    assert codes(search(q=tag, min_hourly=1600)) == {n2.job_code}
    assert codes(search(q=tag, employment="part_time")) == {n2.job_code}
    assert codes(search(q=tag, features=["dormitory", "no_experience"])) == {n5.job_code}
    assert codes(search(q=tag, features=["unknown_tag"])) == {n5.job_code, n2.job_code, monthly.job_code}
    assert codes(search(q=tag, prefecture_id=27)) == {n2.job_code}
    assert codes(search(q=tag, region="kansai")) == {n2.job_code}
    assert search(q=tag, sort="salary")["items"][0]["job_code"] == monthly.job_code  # highest number first


def test_pagination_is_stable(db):
    owner, _ = staff(db, RoleName.RECRUITER)
    tag = f"pg{uuid.uuid4().hex[:6]}"
    made = {job(db, owner, tag).job_code for _ in range(5)}
    p1, p2, p3 = (search(q=tag, page_size=2, page=n) for n in (1, 2, 3))
    assert p1["total"] == 5 and len(p1["items"]) == 2 and len(p3["items"]) == 1
    assert codes(p1) | codes(p2) | codes(p3) == made  # no duplicates, nothing missing
    for bad in ({"page": 0}, {"page_size": 51}, {"level": "n9"}, {"visa": "x;drop"}, {"sort": "random"}):
        assert new_client().get("/api/v1/jobs/search", params=bad).status_code == 422, bad


def test_expired_job_is_hidden_and_cannot_be_applied_to(db):
    owner, _ = staff(db, RoleName.RECRUITER)
    tag = f"ex{uuid.uuid4().hex[:6]}"
    past = job(db, owner, tag, expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
    future = job(db, owner, tag, expires_at=datetime.now(timezone.utc) + timedelta(days=3))
    assert codes(search(q=tag)) == {future.job_code}
    c = new_client()
    assert c.get(f"/api/v1/jobs/{past.job_code}").status_code == 404
    assert past.job_code not in {j["job_code"] for j in c.get("/api/v1/jobs", params={"q": tag}).json()}

    cand, _ = signup()
    cand.put("/api/v1/me/profile", json={"first_name": "Taro", "last_name": "Yamada"}, headers=csrf(cand))
    r = post(cand, "/api/v1/applications", {"job_id": str(past.id)})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "job_not_found"


def test_saved_jobs(db):
    owner, staff_client = staff(db, RoleName.RECRUITER)
    a, b = job(db, owner, "sv"), job(db, owner, "sv")
    c, _ = signup()
    h = csrf(c)
    assert c.put(f"/api/v1/me/saved-jobs/{a.id}", headers=h).status_code == 204
    assert c.put(f"/api/v1/me/saved-jobs/{a.id}", headers=h).status_code == 204  # idempotent
    assert c.put(f"/api/v1/me/saved-jobs/{b.id}", headers=h).status_code == 204
    assert c.put(f"/api/v1/me/saved-jobs/{uuid.uuid4()}", headers=h).status_code == 404
    # (order is newest first; inside one test transaction both rows share now(), so compare as a set)
    assert {j["id"] for j in c.get("/api/v1/me/saved-jobs").json()} == {str(a.id), str(b.id)}
    assert set(c.get("/api/v1/me/saved-jobs/ids").json()) == {str(a.id), str(b.id)}

    b.status = JobStatus.ARCHIVED  # unpublished jobs disappear from the list
    db.flush()
    assert [j["id"] for j in c.get("/api/v1/me/saved-jobs").json()] == [str(a.id)]

    assert c.delete(f"/api/v1/me/saved-jobs/{a.id}", headers=h).status_code == 204
    assert c.get("/api/v1/me/saved-jobs").json() == []
    assert c.put(f"/api/v1/me/saved-jobs/{a.id}").status_code == 403  # CSRF
    assert new_client().get("/api/v1/me/saved-jobs").status_code == 401
    assert staff_client.get("/api/v1/me/saved-jobs").status_code == 403  # candidates only

    # nobody sees anyone else's bookmarks; they go away with the account
    other, _ = signup()
    assert other.get("/api/v1/me/saved-jobs/ids").json() == []
    assert db.scalar(select(SavedJob).where(SavedJob.job_id == b.id)) is not None


def test_similar_jobs(db):
    owner, _ = staff(db, RoleName.RECRUITER)
    base = job(db, owner, "sim", prefecture_id=32)            # Shimane (chugoku)
    same = job(db, owner, "sim", prefecture_id=32)
    region = job(db, owner, "sim", prefecture_id=34)          # Hiroshima, same region
    far = job(db, owner, "sim", prefecture_id=1)              # Hokkaido
    hidden = job(db, owner, "sim", prefecture_id=32, status=JobStatus.ARCHIVED)
    got = [j["job_code"] for j in new_client().get(f"/api/v1/jobs/{base.job_code}/similar", params={"limit": 12}).json()]
    assert base.job_code not in got and far.job_code not in got and hidden.job_code not in got
    assert same.job_code in got and region.job_code in got
    assert got.index(same.job_code) < got.index(region.job_code)  # same prefecture first
    # also by UUID; unknown/hidden job -> empty list, not an error
    assert new_client().get(f"/api/v1/jobs/{base.id}/similar").status_code == 200
    assert new_client().get(f"/api/v1/jobs/{hidden.job_code}/similar").json() == []
    assert new_client().get("/api/v1/jobs/NOPE/similar").json() == []
    assert new_client().get(f"/api/v1/jobs/{base.job_code}/similar", params={"limit": 99}).status_code == 422
    # the card has the extra public details, and never the end-client
    detail = new_client().get(f"/api/v1/jobs/{base.job_code}").json()
    assert {"nearest_station", "work_hours_per_week", "expires_at"} <= detail.keys()
    assert not any("end_client" in k for k in detail)


def test_recommended_jobs(db):
    owner, staff_client = staff(db, RoleName.RECRUITER)
    student = db.scalar(select(VisaType).where(VisaType.code == "student"))
    other_visa = db.scalar(select(VisaType).where(VisaType.code != "student"))
    want = job(db, owner, "rec", prefecture_id=32, japanese_level_required=JapaneseLevel.N4)
    applied = job(db, owner, "rec", prefecture_id=32)
    too_hard = job(db, owner, "rec", prefecture_id=32, japanese_level_required=JapaneseLevel.N2)
    wrong_visa = job(db, owner, "rec", prefecture_id=32)
    for j in (want, applied, too_hard):
        j.visa_types = [student]
    wrong_visa.visa_types = [other_visa]
    db.flush()

    c, _ = signup()
    h = csrf(c)
    assert c.get("/api/v1/me/recommended-jobs").status_code == 200  # no profile yet -> newest jobs
    r = c.put("/api/v1/me/profile", headers=h, json={
        "first_name": "Taro", "last_name": "Yamada", "japanese_level": "n3",
        "visa_type_id": student.id, "desired_prefecture_ids": [32]})
    assert r.status_code == 200, r.text
    assert post(c, "/api/v1/applications", {"job_id": str(applied.id)}).status_code == 201

    got = [j["job_code"] for j in c.get("/api/v1/me/recommended-jobs", params={"limit": 12}).json()]
    assert want.job_code in got
    assert not {applied.job_code, too_hard.job_code, wrong_visa.job_code} & set(got)
    assert new_client().get("/api/v1/me/recommended-jobs").status_code == 401
    assert staff_client.get("/api/v1/me/recommended-jobs").status_code == 403
