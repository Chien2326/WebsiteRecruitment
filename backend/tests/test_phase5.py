"""Phase 5: admin RBAC, approval flow, end-client protection, applications + email, places, i18n, CMS, users."""

from __future__ import annotations

import re
from contextlib import nullcontext
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app import mailer
from app.models import EmailLog, Job, RoleName
from app.routers.admin_jobs import JST
from tests.test_phase4 import (  # noqa: F401 - fixtures are registered by import
    csrf, db, new_client, pdf_bytes, register, s3, staff, upload,
)

JOB = {
    "title": {"ja": "倉庫内ピッキング", "en": "Warehouse picking"},
    "description": {"ja": "簡単な作業です"},
    "salary_type": "hourly", "salary_min": 1200, "salary_max": 1500,
    "prefecture_id": 23, "visa_type_ids": [1, 4], "features": ["dormitory"],
    "end_client_name": "トヨタ自動車株式会社",
    "client_display_name": {"ja": "大手自動車メーカー", "en": "Major automaker"},
}


@pytest.fixture()
def mail(db, monkeypatch):
    sent: list[mailer.Mail] = []
    monkeypatch.setattr(mailer, "send", sent.append)
    monkeypatch.setattr(mailer, "open_session", lambda: nullcontext(db))
    return sent


def create_job(c, **over):
    r = c.post("/api/v1/admin/jobs", json={**JOB, **over}, headers=csrf(c))
    assert r.status_code == 201, r.text
    return r.json()


def move(c, job_id, to, note=None):
    return c.post(f"/api/v1/admin/jobs/{job_id}/transition", json={"to": to, "note": note}, headers=csrf(c))


# ====================================================================== RBAC matrix
@pytest.mark.parametrize("path,allowed", [
    ("/api/v1/admin/jobs", {RoleName.SUPER_ADMIN, RoleName.RECRUITER_MANAGER, RoleName.RECRUITER}),
    ("/api/v1/admin/applications", {RoleName.SUPER_ADMIN, RoleName.RECRUITER_MANAGER, RoleName.RECRUITER}),
    ("/api/v1/admin/places", {RoleName.SUPER_ADMIN, RoleName.CONTENT_EDITOR}),
    ("/api/v1/admin/translations", {RoleName.SUPER_ADMIN, RoleName.CONTENT_EDITOR}),
    ("/api/v1/admin/cms", {RoleName.SUPER_ADMIN, RoleName.CONTENT_EDITOR}),
    ("/api/v1/admin/users", {RoleName.SUPER_ADMIN}),
    ("/api/v1/admin/stats", {RoleName.SUPER_ADMIN, RoleName.RECRUITER_MANAGER, RoleName.RECRUITER, RoleName.CONTENT_EDITOR}),
])
def test_rbac_matrix(db, path, allowed):
    assert new_client().get(path).status_code == 401
    cand = new_client()
    register(cand)
    assert cand.get(path).status_code == 403
    for role in (RoleName.SUPER_ADMIN, RoleName.RECRUITER_MANAGER, RoleName.RECRUITER, RoleName.CONTENT_EDITOR):
        _, c = staff(db, role)
        assert c.get(path).status_code == (200 if role in allowed else 403), (role, path)


def test_me_exposes_permissions(db):
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    perms = set(editor.get("/api/v1/auth/me").json()["permissions"])
    assert {"cms.write", "places.write"} <= perms
    assert not perms & {"jobs.view_end_client", "resumes.read", "jobs.read"}


# ====================================================================== approval flow
def test_approval_flow(db):
    rec_user, rec = staff(db, RoleName.RECRUITER)
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    job = create_job(rec)
    assert job["status"] == "draft" and re.fullmatch(r"HK-\d{4}-\d{6}", job["job_code"])
    assert job["end_client_name"] == "トヨタ自動車株式会社"
    assert new_client().get(f"/api/v1/jobs/{job['job_code']}").status_code == 404  # not public yet

    r = move(rec, job["id"], "published")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "approval_required"
    assert move(rec, job["id"], "pending").json()["status"] == "pending"
    assert move(mgr, job["id"], "draft").status_code == 422  # rejection needs a reason
    r = move(mgr, job["id"], "draft", "給与の記載を修正してください")
    assert r.json()["status"] == "draft" and r.json()["review_note"].startswith("給与")
    move(rec, job["id"], "pending")
    r = move(mgr, job["id"], "published")
    assert r.json()["status"] == "published" and r.json()["published_at"] and r.json()["review_note"] is None
    assert move(mgr, job["id"], "pending").status_code == 409  # published -> pending is not a transition

    pub = new_client().get(f"/api/v1/jobs/{job['job_code']}").json()
    assert pub["client_display_name"]["ja"] == "大手自動車メーカー"
    assert "トヨタ" not in str(pub) and "end_client" not in str(pub)

    # a recruiter editing a live job sends it back to review; a manager's edit does not
    body = {**JOB, "salary_min": 1300}
    assert rec.put(f"/api/v1/admin/jobs/{job['id']}", json=body, headers=csrf(rec)).json()["status"] == "pending"
    move(mgr, job["id"], "published")
    assert mgr.put(f"/api/v1/admin/jobs/{job['id']}", json=body, headers=csrf(mgr)).json()["status"] == "published"
    assert move(rec, job["id"], "archived").json()["status"] == "archived"  # owner may hide their job
    assert move(rec, job["id"], "published").status_code == 403


@pytest.mark.parametrize("client_name,display", [
    ("トヨタ自動車株式会社", {"ja": "トヨタ自動車の工場"}),
    ("Toyota Motor Corporation", {"en": "TOYOTA MOTOR plant in Aichi"}),
    ("株式会社アイチ物流", {"ja": "アイチ 物流（愛知）"}),           # spacing tricks
    ("ＡＢＣ食品株式会社", {"vi": "Nhà máy abc食品"}),               # full-width vs half-width
])
def test_display_name_cannot_reveal_end_client(db, client_name, display):
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    r = mgr.post("/api/v1/admin/jobs", json={**JOB, "end_client_name": client_name, "client_display_name": display},
                 headers=csrf(mgr))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "display_name_reveals_client"


def test_row_scope_and_end_client_visibility(db):
    _, rec_a = staff(db, RoleName.RECRUITER)
    _, rec_b = staff(db, RoleName.RECRUITER)
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    job = create_job(rec_a)
    assert rec_b.get(f"/api/v1/admin/jobs/{job['id']}").status_code == 404
    assert job["id"] not in [j["id"] for j in rec_b.get("/api/v1/admin/jobs").json()["items"]]
    assert mgr.get(f"/api/v1/admin/jobs/{job['id']}").json()["end_client_name"] == "トヨタ自動車株式会社"
    assert editor.get(f"/api/v1/admin/jobs/{job['id']}").status_code == 403
    assert rec_b.put(f"/api/v1/admin/jobs/{job['id']}", json=JOB, headers=csrf(rec_b)).status_code == 404


def test_list_filters_and_pagination(db):
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    ids = [create_job(mgr, prefecture_id=13 if i % 2 else 27)["id"] for i in range(5)]
    move(mgr, ids[0], "published")
    db.execute(Job.__table__.update().where(Job.id == ids[1]).values(created_at=Job.created_at - timedelta(days=30)))

    def get(**q):
        return mgr.get("/api/v1/admin/jobs", params=q).json()
    page1 = get(page_size=2, q="倉庫内")
    assert page1["page_size"] == 2 and len(page1["items"]) == 2 and page1["total"] >= 5
    assert {j["id"] for j in get(page_size=100, status="published", q="倉庫内")["items"]} >= {ids[0]}
    assert all(j["prefecture_id"] == 13 for j in get(prefecture_id=13)["items"])
    today = datetime.now(JST).date().isoformat()  # filters use Japan calendar days
    recent = {j["id"] for j in get(page_size=100, created_from=today, created_to=today)["items"]}
    assert ids[2] in recent and ids[1] not in recent
    assert mgr.get("/api/v1/admin/jobs", params={"page_size": 1000}).status_code == 422


# ====================================================================== applications + email
def _applied(db, s3, locale="vi"):
    rec_user, rec = staff(db, RoleName.RECRUITER)
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    job = create_job(rec)
    move(mgr, job["id"], "published")
    cand = new_client()
    register(cand, preferred_locale=locale)
    rid = upload(cand, pdf_bytes(), "cv.pdf").json()["id"]
    app_id = cand.post("/api/v1/applications", json={"job_id": job["id"], "resume_id": rid}, headers=csrf(cand)).json()["id"]
    return rec, mgr, cand, job, rid, app_id


def test_status_change_sends_localized_email(db, s3, mail):
    rec, mgr, cand, job, rid, app_id = _applied(db, s3, locale="vi")
    # sign-up -> verification email; apply -> "we received your application" (both in Vietnamese)
    assert [m.subject for m in mail] == ["[Haken Work] Xác nhận địa chỉ email",
                                         "[Haken Work] Đã nhận hồ sơ ứng tuyển của bạn"]
    mail.clear()
    items = mgr.get("/api/v1/admin/applications", params={"status": "applied"}).json()["items"]
    assert app_id in [i["id"] for i in items]
    detail = mgr.get(f"/api/v1/admin/applications/{app_id}").json()
    assert detail["profile"]["last_name"] == "Nguyen" and detail["resume"]["id"] == rid

    r = mgr.patch(f"/api/v1/admin/applications/{app_id}/status",
                  json={"status": "interview", "recruiter_note": "TOP SECRET note"}, headers=csrf(mgr))
    assert r.status_code == 200 and r.json()["status"] == "interview"
    assert len(mail) == 1
    m = mail[0]
    assert m.subject == "[Haken Work] Thư mời phỏng vấn"            # candidate's language
    assert "Warehouse" not in m.body and "倉庫内ピッキング" in m.body  # vi title missing -> ja fallback
    assert "TOP SECRET" not in m.body and "トヨタ" not in m.body       # no internal data in mail
    assert "/vi/mypage" in m.body
    logrows = db.scalars(select(EmailLog).where(EmailLog.application_id == app_id)).all()
    assert sorted((r.template, r.status.value) for r in logrows) == [
        ("application_applied", "sent"), ("application_interview", "sent")]
    # (one outer test transaction -> identical now() timestamps, so compare as a set)
    assert {e["template"] for e in r.json()["emails"]} == {"application_applied", "application_interview"}

    # same status again -> no mail; notify=false -> no mail
    mgr.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "interview"}, headers=csrf(mgr))
    mgr.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "accepted", "notify": False}, headers=csrf(mgr))
    assert len(mail) == 1
    assert cand.get("/api/v1/applications/my-applications").json()[0]["status"] == "accepted"


def test_mail_failure_is_logged_not_raised(db, s3, monkeypatch):
    def boom(_m):
        raise ConnectionRefusedError("smtp down")
    monkeypatch.setattr(mailer, "send", boom)
    monkeypatch.setattr(mailer, "open_session", lambda: nullcontext(db))
    _, mgr, _, _, _, app_id = _applied(db, s3)
    r = mgr.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "reviewing"}, headers=csrf(mgr))
    assert r.status_code == 200
    row = db.scalar(select(EmailLog).where(EmailLog.application_id == app_id))
    assert row.status.value == "failed" and "smtp down" in row.error


def test_application_scope_and_cv_preview(db, s3, mail):
    rec, mgr, cand, job, rid, app_id = _applied(db, s3)
    _, other_rec = staff(db, RoleName.RECRUITER)
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    assert other_rec.get(f"/api/v1/admin/applications/{app_id}").status_code == 404
    assert other_rec.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "rejected"},
                           headers=csrf(other_rec)).status_code == 404
    assert rec.get(f"/api/v1/admin/applications/{app_id}").status_code == 200  # owner of the job

    url = mgr.get(f"/api/v1/resumes/{rid}/download-url", params={"inline": "true"}).json()["url"]
    q = parse_qs(urlparse(url).query)
    assert q["response-content-disposition"][0].startswith("inline") and q["X-Amz-Expires"] == ["900"]
    assert cand.get(f"/api/v1/resumes/{rid}/download-url", params={"inline": "true"}).status_code == 422
    assert editor.get(f"/api/v1/resumes/{rid}/download-url").status_code == 404
    assert other_rec.get(f"/api/v1/resumes/{rid}/download-url").status_code == 404


# ====================================================================== places, translations, CMS
def test_places_visibility_and_names(db):
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    r = editor.patch("/api/v1/admin/prefectures/13",
                     json={"is_active": False, "name": {"ja": "東京都", "en": "Tokyo", "my": "တိုကျို"}}, headers=csrf(editor))
    assert r.status_code == 200
    editor.patch("/api/v1/admin/regions/8", json={"is_active": False}, headers=csrf(editor))
    pub = new_client().get("/api/v1/places").json()
    tokyo = next(p for p in pub["prefectures"] if p["id"] == 13)
    assert tokyo["is_active"] is False and tokyo["name"]["my"] == "တိုကျို"
    assert next(x for x in pub["regions"] if x["code"] == "kyushu")["is_active"] is False
    bad = editor.patch("/api/v1/admin/prefectures/13", json={"name": {"en": "Tokyo"}}, headers=csrf(editor))
    assert bad.status_code == 422  # Japanese name must stay


def test_translation_overrides(db):
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    r = editor.put("/api/v1/admin/translations", json={"key": "nav.jobs", "locale": "vi", "value": "Việc làm"}, headers=csrf(editor))
    assert r.status_code == 200
    assert new_client().get("/api/v1/i18n/vi").json()["nav.jobs"] == "Việc làm"
    for bad in ({"key": "../etc", "locale": "vi", "value": "x"}, {"key": "nav.jobs", "locale": "xx", "value": "x"},
                {"key": "nav.jobs", "locale": "vi", "value": ""}, {"key": "nav", "locale": "vi", "value": "x"}):
        assert editor.put("/api/v1/admin/translations", json=bad, headers=csrf(editor)).status_code == 422
    assert editor.delete("/api/v1/admin/translations", params={"key": "nav.jobs", "locale": "vi"}, headers=csrf(editor)).status_code == 204
    assert "nav.jobs" not in new_client().get("/api/v1/i18n/vi").json()


def test_cms_blocks(db):
    _, editor = staff(db, RoleName.CONTENT_EDITOR)
    body = {"content": {"ja": "年末年始のお知らせ", "en": "Holiday notice"}, "is_published": False}
    assert editor.put("/api/v1/admin/cms/home.notice", json=body, headers=csrf(editor)).status_code == 200
    assert new_client().get("/api/v1/cms/home.notice").status_code == 404  # unpublished
    editor.put("/api/v1/admin/cms/home.notice", json={**body, "is_published": True}, headers=csrf(editor))
    assert new_client().get("/api/v1/cms/home.notice").json()["content"]["en"] == "Holiday notice"
    assert editor.put("/api/v1/admin/cms/home.notice", json={"content": {"en": "x"}}, headers=csrf(editor)).status_code == 422
    assert editor.put("/api/v1/admin/cms/BAD KEY", json=body, headers=csrf(editor)).status_code in (404, 422)


# ====================================================================== users & roles
def test_role_change_takes_effect_and_revokes_sessions(db):
    sa_user, sa = staff(db, RoleName.SUPER_ADMIN)
    target_user, target = staff(db, RoleName.RECRUITER)
    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    assert target.get("/api/v1/admin/places").status_code == 403

    r = sa.patch(f"/api/v1/admin/users/{target_user.id}", json={"role": "content_editor"}, headers=csrf(sa))
    assert r.status_code == 200 and r.json()["role"] == "content_editor"
    assert target.get("/api/v1/admin/places").status_code == 200  # immediate: role is read per request
    assert target.post("/api/v1/auth/refresh", headers=csrf(target)).status_code == 401  # sessions revoked

    assert sa.patch(f"/api/v1/admin/users/{sa_user.id}", json={"role": "candidate"}, headers=csrf(sa)).status_code == 409
    assert mgr.patch(f"/api/v1/admin/users/{target_user.id}", json={"role": "super_admin"}, headers=csrf(mgr)).status_code == 403
    sa.patch(f"/api/v1/admin/users/{target_user.id}", json={"is_active": False}, headers=csrf(sa))
    assert target.get("/api/v1/auth/me").status_code == 401  # deactivated -> locked out at once
