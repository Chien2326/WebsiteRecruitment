"""News (お知らせ) and the employer contact form (企業の方へ)."""

from __future__ import annotations

from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app import mailer
from app.config import settings
from app.ratelimit import limiter
from app.routers import content
from app.models import EmailLog, EmployerInquiry, News, RoleName
from tests.test_phase4 import csrf, db, new_client, staff  # noqa: F401 - fixtures are registered by import


@pytest.fixture()
def mail(db, monkeypatch):
    sent: list[mailer.Mail] = []
    monkeypatch.setattr(mailer, "send", sent.append)
    monkeypatch.setattr(mailer, "open_session", lambda: nullcontext(db))
    return sent


def news_body(slug: str, **over):
    return {"slug": slug, "title": {"ja": "お知らせ", "vi": "Thông báo"}, "summary": {"ja": "概要"},
            "body": {"ja": "本文です。", "vi": "Nội dung."}, "status": "published", **over}


def inquiry(**over):
    return {"company_name": "株式会社テスト", "contact_name": "山田 太郎", "email": "hr@example.co.jp",
            "phone": "03-1234-5678", "prefecture_id": 13, "headcount": 5, "message": "倉庫スタッフを5名募集したい",
            "locale": "ja", "agree": True, **over}


# ====================================================================== news
def test_news_crud_and_public_visibility(db):
    _, ed = staff(db, RoleName.CONTENT_EDITOR)
    r = ed.post("/api/v1/admin/news", json=news_body("open-2026"), headers=csrf(ed))
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["published_at"] is not None  # publishing without a date = now

    draft = ed.post("/api/v1/admin/news", json=news_body("draft-post", status="draft"), headers=csrf(ed)).json()
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    ed.post("/api/v1/admin/news", json=news_body("scheduled", published_at=future), headers=csrf(ed))

    pub = new_client()
    listing = pub.get("/api/v1/news").json()
    slugs = [n["slug"] for n in listing["items"]]
    assert "open-2026" in slugs and "draft-post" not in slugs and "scheduled" not in slugs
    assert "body" not in listing["items"][0]  # list is light
    assert pub.get("/api/v1/news/open-2026").json()["body"]["vi"] == "Nội dung."
    assert pub.get("/api/v1/news/draft-post").status_code == 404
    assert pub.get("/api/v1/news/scheduled").status_code == 404

    # duplicate slug -> 409; update keeps the original publish time
    dup = ed.post("/api/v1/admin/news", json=news_body("open-2026"), headers=csrf(ed))
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "slug_taken"
    upd = ed.put(f"/api/v1/admin/news/{created['id']}", json=news_body("open-2026", title={"ja": "更新"}), headers=csrf(ed))
    assert upd.status_code == 200 and upd.json()["published_at"] == created["published_at"]
    assert upd.json()["title"] == {"ja": "更新"}

    # empty translations are dropped, Japanese is mandatory
    r = ed.put(f"/api/v1/admin/news/{draft['id']}", json=news_body("draft-post", summary={"ja": "", "en": "  "}),
               headers=csrf(ed))
    assert r.json()["summary"] is None
    bad = ed.post("/api/v1/admin/news", json=news_body("no-ja", title={"en": "x"}), headers=csrf(ed))
    assert bad.status_code == 422

    assert ed.delete(f"/api/v1/admin/news/{draft['id']}", headers=csrf(ed)).status_code == 204
    assert db.get(News, draft["id"]) is None


@pytest.mark.parametrize("role", [RoleName.RECRUITER, RoleName.RECRUITER_MANAGER])
def test_news_admin_needs_cms_permission(db, role):
    _, c = staff(db, role)
    assert c.get("/api/v1/admin/news").status_code == 403
    assert c.post("/api/v1/admin/news", json=news_body("nope"), headers=csrf(c)).status_code == 403


def test_news_slug_is_validated(db):
    _, ed = staff(db, RoleName.CONTENT_EDITOR)
    assert ed.post("/api/v1/admin/news", json=news_body("Bad Slug!"), headers=csrf(ed)).status_code == 422
    assert new_client().get("/api/v1/news/Bad_Slug").status_code in (404, 422)


# ====================================================================== employer inquiries
def test_inquiry_is_stored_notifies_admin_and_replies(db, mail, monkeypatch):
    monkeypatch.setattr(content, "settings", replace(settings, admin_notify_emails=("sales@haken.example",)))
    c = new_client()
    r = c.post("/api/v1/employers/inquiries", json=inquiry(), headers=csrf(c))
    assert r.status_code == 202, r.text
    row = db.scalar(select(EmployerInquiry).where(EmployerInquiry.email == "hr@example.co.jp"))
    assert row.company_name == "株式会社テスト" and row.status == "new" and row.prefecture_id == 13

    notice, reply = sorted(mail, key=lambda m: m.to == "hr@example.co.jp")
    assert notice.to == "sales@haken.example" and "株式会社テスト" in notice.subject
    assert "倉庫スタッフを5名募集したい" in notice.body and "東京都" in notice.body
    assert reply.to == "hr@example.co.jp" and reply.subject == "【ハケンワーク】お問い合わせを受け付けました"
    # the auto-reply never repeats what the visitor typed (no spam relay)
    assert "株式会社テスト" not in reply.body and "倉庫" not in reply.body and "山田" not in reply.body
    assert {l.status.value for l in db.scalars(select(EmailLog).where(EmailLog.template.like("employer_inquiry%")))} == {"sent"}


def test_inquiry_reply_language_falls_back_to_english(db, mail):
    c = new_client()
    assert c.post("/api/v1/employers/inquiries", json=inquiry(locale="ne", email="a@example.com"), headers=csrf(c)).status_code == 202
    assert mail[-1].subject == "[Haken Work] We received your inquiry"


def test_inquiry_honeypot_and_validation(db, mail):
    c = new_client()
    before = db.scalar(select(func.count()).select_from(EmployerInquiry))
    bot = c.post("/api/v1/employers/inquiries", json=inquiry(website="http://spam"), headers=csrf(c))
    assert bot.status_code == 202 and mail == []
    assert db.scalar(select(func.count()).select_from(EmployerInquiry)) == before
    for bad in ({"agree": False}, {"email": "nope"}, {"message": ""}, {"phone": "<script>"}, {"headcount": 0},
                {"prefecture_id": 48}, {"company_name": "x" * 201}):
        limiter.reset()  # every attempt counts toward the IP limit; this test is about validation
        assert c.post("/api/v1/employers/inquiries", json=inquiry(**bad), headers=csrf(c)).status_code == 422, bad
    assert c.post("/api/v1/employers/inquiries", json=inquiry()).status_code == 403  # CSRF


def test_inquiry_rate_limits(db, mail):
    c = new_client()
    codes = [c.post("/api/v1/employers/inquiries", json=inquiry(email=f"x{i}@example.com"), headers=csrf(c)).status_code
             for i in range(6)]
    assert codes == [202] * 5 + [429]  # per IP


def test_inquiry_rate_limit_per_address(db, mail, monkeypatch):
    codes = []
    for _ in range(4):
        limiter._hits = {k: v for k, v in limiter._hits.items() if not k.startswith("employer_inquiry:")}  # new IP
        c = new_client()
        codes.append(c.post("/api/v1/employers/inquiries", json=inquiry(), headers=csrf(c)).status_code)
    assert codes == [202, 202, 202, 429]


def test_inquiry_admin_permissions_update_and_delete(db, mail):
    c = new_client()
    c.post("/api/v1/employers/inquiries", json=inquiry(email="del@example.com"), headers=csrf(c))
    row = db.scalar(select(EmployerInquiry).where(EmployerInquiry.email == "del@example.com"))

    for role in (RoleName.RECRUITER, RoleName.CONTENT_EDITOR):
        _, other = staff(db, role)
        assert other.get("/api/v1/admin/inquiries").status_code == 403
    assert new_client().get("/api/v1/admin/inquiries").status_code == 401

    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    page = mgr.get("/api/v1/admin/inquiries?status=new&q=del@").json()
    assert [i["id"] for i in page["items"]] == [str(row.id)]
    assert mgr.get("/api/v1/admin/stats").json()["inquiries_new"] >= 1

    r = mgr.patch(f"/api/v1/admin/inquiries/{row.id}", json={"status": "contacted", "admin_note": "電話済み"},
                  headers=csrf(mgr))
    assert r.status_code == 200 and r.json()["status"] == "contacted" and r.json()["admin_note"] == "電話済み"
    assert mgr.patch(f"/api/v1/admin/inquiries/{row.id}", json={"status": "spam"}, headers=csrf(mgr)).status_code == 422

    assert mgr.delete(f"/api/v1/admin/inquiries/{row.id}", headers=csrf(mgr)).status_code == 204
    assert db.get(EmployerInquiry, row.id) is None
    # APPI: the address is gone from the email log too
    assert db.scalar(select(func.count()).select_from(EmailLog).where(EmailLog.to_email == "del@example.com")) == 0


def test_general_contact_form(db, mail, monkeypatch):
    monkeypatch.setattr(content, "settings", replace(settings, admin_notify_emails=("sales@haken.example",)))
    c = new_client()
    body = {"name": "Nguyen Van A", "email": "nva@example.com", "message": "Câu hỏi về visa", "locale": "vi", "agree": True}
    assert c.post("/api/v1/contact", json=body, headers=csrf(c)).status_code == 202
    row = db.scalar(select(EmployerInquiry).where(EmployerInquiry.email == "nva@example.com"))
    assert row.kind == "general" and row.company_name is None and row.contact_name == "Nguyen Van A"
    notice, reply = sorted(mail, key=lambda m: m.to == "nva@example.com")
    assert "お問い合わせ: Nguyen Van A" in notice.subject and "/contact" in notice.body
    assert reply.subject == "[Haken Work] Chúng tôi đã nhận được yêu cầu liên hệ" and reply.body.endswith("/vi/contact")
    assert "visa" not in reply.body
    assert c.post("/api/v1/contact", json={**body, "agree": False}, headers=csrf(c)).status_code == 422

    _, mgr = staff(db, RoleName.RECRUITER_MANAGER)
    ids = {i["id"] for i in mgr.get("/api/v1/admin/inquiries?kind=general").json()["items"]}
    assert str(row.id) in ids
    assert str(row.id) not in {i["id"] for i in mgr.get("/api/v1/admin/inquiries?kind=employer").json()["items"]}
