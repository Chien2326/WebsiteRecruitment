"""ps.txt part 1 A: email verification, forgot/reset password, notifications, account linking,
change password / email, delete account (APPI)."""

from __future__ import annotations

import re
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import func, select

from app import mailer
from app.models import Application, EmailLog, Resume, RoleName, SocialAccount, User, UserToken
from tests.test_phase4 import (  # noqa: F401 - fixtures are registered by import
    PW, KEY, csrf, db, google, id_claims, make_job, new_client, pdf_bytes, register, s3, staff, upload,
)

NEW_PW = "another-long-passphrase"


@pytest.fixture()
def mail(db, monkeypatch):
    sent: list[mailer.Mail] = []
    monkeypatch.setattr(mailer, "send", sent.append)
    monkeypatch.setattr(mailer, "open_session", lambda: nullcontext(db))
    return sent


def token_in(m: mailer.Mail) -> str:
    return re.search(r"token=([A-Za-z0-9_-]+)", m.body).group(1)


def signup(email: str | None = None, **extra):
    c = new_client()
    r = register(c, email=email, **extra)
    assert r.status_code == 201, r.text
    return c, r.json()


def login(email: str, password: str):
    c = new_client()
    return c, c.post("/api/v1/auth/login", json={"email": email, "password": password}, headers=csrf(c))


def post(c, path, json=None):
    return c.post(path, json=json or {}, headers=csrf(c))


# ====================================================================== email verification
def test_signup_sends_verification_link_in_user_language(db, mail):
    c, me = signup(preferred_locale="vi")
    assert me["email_verified"] is False and me["has_password"] is True
    assert len(mail) == 1 and mail[0].to == me["email"]
    assert mail[0].subject == "[Haken Work] Xác nhận địa chỉ email"
    assert "/vi/verify-email?token=" in mail[0].body and "24" in mail[0].body
    token = token_in(mail[0])
    # only a hash is stored; the email log has no body
    assert db.scalar(select(func.count()).select_from(UserToken).where(UserToken.token_hash == token)) == 0
    assert db.scalar(select(EmailLog.template).where(EmailLog.to_email == me["email"])) == "verify_email"

    r = post(new_client(), "/api/v1/auth/email/confirm", {"token": token})  # link opened on any device
    assert r.status_code == 200 and r.json() == {"purpose": "verify_email", "email": me["email"]}
    assert c.get("/api/v1/auth/me").json()["email_verified"] is True
    again = post(new_client(), "/api/v1/auth/email/confirm", {"token": token})  # single use
    assert again.status_code == 400 and again.json()["detail"]["code"] == "invalid_token"


def test_resend_voids_older_links_and_is_limited(db, mail):
    c, me = signup()
    first = token_in(mail[0])
    assert post(c, "/api/v1/auth/email/resend-verification").status_code == 202
    second = token_in(mail[1])
    assert post(c, "/api/v1/auth/email/confirm", {"token": first}).status_code == 400  # superseded
    assert post(c, "/api/v1/auth/email/confirm", {"token": second}).status_code == 200
    r = post(c, "/api/v1/auth/email/resend-verification")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "already_verified"

    c2, _ = signup()
    codes = [post(c2, "/api/v1/auth/email/resend-verification").status_code for _ in range(4)]
    assert codes == [202, 202, 202, 429]
    assert post(new_client(), "/api/v1/auth/email/resend-verification").status_code == 401


@pytest.mark.parametrize("bad", ["", "x" * 9, "not-a-real-token-value", "a" * 300])
def test_confirm_rejects_garbage(db, bad):
    r = post(new_client(), "/api/v1/auth/email/confirm", {"token": bad})
    assert r.status_code in (400, 422)


# ====================================================================== forgot / reset password
def test_forgot_password_does_not_reveal_accounts(db, mail):
    r = post(new_client(), "/api/v1/auth/password/forgot", {"email": "nobody-here@example.com"})
    assert r.status_code == 202 and r.json() == {"ok": True} and mail == []
    _, me = signup()
    mail.clear()
    r2 = post(new_client(), "/api/v1/auth/password/forgot", {"email": me["email"].upper()})
    assert r2.status_code == 202 and r2.json() == r.json()  # same answer
    assert len(mail) == 1 and "/ja/reset-password?token=" in mail[0].body and "30" in mail[0].body


def test_reset_password_flow_kills_every_session(db, mail):
    c, me = signup()
    c_other, _ = login(me["email"], PW)
    mail.clear()
    post(new_client(), "/api/v1/auth/password/forgot", {"email": me["email"]})
    token = token_in(mail[0])

    weak = post(new_client(), "/api/v1/auth/password/reset", {"token": token, "new_password": "short"})
    assert weak.status_code == 422
    same = post(new_client(), "/api/v1/auth/password/reset", {"token": token, "new_password": me["email"]})
    assert same.status_code == 422 and same.json()["detail"]["code"] == "password_equals_email"

    r = post(new_client(), "/api/v1/auth/password/reset", {"token": token, "new_password": NEW_PW})
    assert r.status_code == 204
    # both old sessions are dead right away: access token (token_version) and refresh token
    for old in (c, c_other):
        assert old.get("/api/v1/auth/me").status_code == 401
        assert post(old, "/api/v1/auth/refresh").status_code == 401
    assert login(me["email"], PW)[1].status_code == 401
    c_new, ok = login(me["email"], NEW_PW)
    assert ok.status_code == 200 and ok.json()["email_verified"] is True  # mailbox proven
    assert post(new_client(), "/api/v1/auth/password/reset", {"token": token, "new_password": NEW_PW + "x"}).status_code == 400
    assert mail[-1].subject == "【ハケンワーク】パスワードが変更されました"


def test_reset_token_expires(db, mail):
    _, me = signup()
    mail.clear()
    post(new_client(), "/api/v1/auth/password/forgot", {"email": me["email"]})
    row = db.scalar(select(UserToken).where(UserToken.purpose == "reset_password", UserToken.used_at.is_(None))
                    .join(User, User.id == UserToken.user_id).where(User.email == me["email"]))
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.flush()
    r = post(new_client(), "/api/v1/auth/password/reset", {"token": token_in(mail[0]), "new_password": NEW_PW})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "invalid_token"


def test_forgot_password_rate_limited_per_email(db, mail):
    _, me = signup()
    codes = [post(new_client(), "/api/v1/auth/password/forgot", {"email": me["email"]}).status_code for _ in range(4)]
    assert codes == [202, 202, 202, 429]


# ====================================================================== change password
def test_change_password_requires_current_and_signs_out_other_devices(db, mail):
    c, me = signup()
    other, _ = login(me["email"], PW)
    mail.clear()
    bad = c.put("/api/v1/account/password", json={"current_password": "wrong-password!", "new_password": NEW_PW},
                headers=csrf(c))
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "wrong_password"
    r = c.put("/api/v1/account/password", json={"current_password": PW, "new_password": NEW_PW}, headers=csrf(c))
    assert r.status_code == 200
    assert c.get("/api/v1/auth/me").status_code == 200          # this device got a fresh session
    assert other.get("/api/v1/auth/me").status_code == 401      # the other one is out
    assert login(me["email"], NEW_PW)[1].status_code == 200
    assert [m.subject for m in mail] == ["【ハケンワーク】パスワードが変更されました"]


# ====================================================================== change email
def test_change_email_needs_confirmation_from_new_address(db, mail):
    c, me = signup()
    _, taken = signup()
    mail.clear()
    assert post(c, "/api/v1/account/email", {"new_email": "x@example.com", "current_password": "nope-nope-nope"}).json()["detail"]["code"] == "wrong_password"
    assert post(c, "/api/v1/account/email", {"new_email": taken["email"], "current_password": PW}).status_code == 409
    assert post(c, "/api/v1/account/email", {"new_email": me["email"], "current_password": PW}).status_code == 400

    new = f"new-{me['email']}"
    assert post(c, "/api/v1/account/email", {"new_email": new.upper(), "current_password": PW}).status_code == 202
    assert len(mail) == 1 and mail[0].to == new and new in mail[0].body
    assert c.get("/api/v1/auth/me").json()["email"] == me["email"]  # nothing changed yet

    r = post(new_client(), "/api/v1/auth/email/confirm", {"token": token_in(mail[0])})
    assert r.status_code == 200 and r.json() == {"purpose": "change_email", "email": new}
    me2 = c.get("/api/v1/auth/me").json()
    assert me2["email"] == new and me2["email_verified"] is True
    notice = mail[1]
    assert notice.to == me["email"] and new not in notice.body and new[:2] + "***@" in notice.body
    assert login(new, PW)[1].status_code == 200 and login(me["email"], PW)[1].status_code == 401


def test_stale_verification_link_does_not_verify_new_address(db, mail):
    c, me = signup()
    stale = token_in(mail[0])  # verification link for the original address
    post(c, "/api/v1/account/email", {"new_email": f"n-{me['email']}", "current_password": PW})
    # requesting a change does not void it, but the address it was issued for is still current -> ok;
    # after the change completes, every older link is voided
    post(new_client(), "/api/v1/auth/email/confirm", {"token": token_in(mail[1])})
    assert post(new_client(), "/api/v1/auth/email/confirm", {"token": stale}).status_code == 400


def test_email_taken_between_request_and_confirm(db, mail):
    c, me = signup()
    target = f"race-{me['email']}"
    post(c, "/api/v1/account/email", {"new_email": target, "current_password": PW})
    token = token_in(mail[-1])
    signup(email=target)  # someone registers that address meanwhile
    r = post(new_client(), "/api/v1/auth/email/confirm", {"token": token})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "email_taken"


# ====================================================================== delete account (APPI)
def test_delete_account_removes_everything(db, s3, mail):
    rec_user, _ = staff(db, RoleName.RECRUITER)
    job = make_job(db, rec_user)
    c, me = signup()
    rid = upload(c, pdf_bytes(), "cv.pdf").json()["id"]
    key = db.scalar(select(Resume.s3_key).where(Resume.id == rid))
    assert post(c, "/api/v1/applications", {"job_id": str(job.id), "resume_id": rid}).status_code == 201
    mail.clear()

    assert post(c, "/api/v1/account/delete", {"password": "wrong-password!"}).status_code == 400
    r = post(c, "/api/v1/account/delete", {"password": PW})
    assert r.status_code == 204
    assert any(h.startswith("access_token=") for h in r.headers.get_list("set-cookie"))  # cookies cleared

    assert db.scalar(select(User.id).where(User.email == me["email"])) is None
    assert db.scalar(select(func.count()).select_from(Application).where(Application.job_id == job.id)) == 0
    assert s3.list_objects_v2(Bucket="test-resumes").get("KeyCount", 0) == 0, key
    assert db.scalar(select(func.count()).select_from(EmailLog).where(EmailLog.to_email == me["email"])) == 0
    assert [m.subject for m in mail] == ["【ハケンワーク】退会手続きが完了しました"]
    assert c.get("/api/v1/auth/me").status_code == 401


def test_staff_cannot_self_delete(db):
    _, c = staff(db, RoleName.RECRUITER_MANAGER)
    r = post(c, "/api/v1/account/delete", {"password": PW})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "staff_cannot_self_delete"


# ====================================================================== OAuth: linking & unlinking
def _oauth(c, google, *, link=False, nxt="/ja/mypage/account", **claims):
    params = {"next": nxt} | ({"link": "1"} if link else {})
    r = c.get("/api/v1/auth/oauth/google/login", params=params, follow_redirects=False)
    if r.status_code != 302:
        return r
    q = parse_qs(urlparse(r.headers["location"]).query)
    set_cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("oauth_state="))
    c.cookies.set("oauth_state", set_cookie.split(";", 1)[0].split("=", 1)[1])
    google["claims"] = id_claims(q["nonce"][0], **claims)
    return c.get("/api/v1/auth/oauth/google/callback", params={"code": "abc", "state": q["state"][0]},
                 follow_redirects=False)


def test_link_google_from_settings(db, google, mail):
    c, me = signup()
    r = _oauth(c, google, link=True, email="different@gmail.com", sub="g-link-1")
    assert r.status_code == 303 and r.headers["location"].endswith("/ja/mypage/account?linked=google")
    assert c.get("/api/v1/auth/me").json()["providers"] == ["google"]
    # Google login now reaches the same account
    c2 = new_client()
    _oauth(c2, google, nxt="/ja/mypage", email="different@gmail.com", sub="g-link-1")
    assert c2.get("/api/v1/auth/me").json()["id"] == me["id"]

    # another user cannot take that Google account
    c3, _ = signup()
    r3 = _oauth(c3, google, link=True, sub="g-link-1")
    assert r3.headers["location"].endswith("?link_error=oauth_already_linked")


def test_link_requires_login(db, google):
    r = new_client().get("/api/v1/auth/oauth/google/login", params={"link": "1", "next": "/vi/mypage/account"},
                         follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/vi/login?error=not_authenticated")


def test_verified_email_now_links_automatically(db, google, mail):
    _, me = signup(email="hanako@gmail.com")
    post(new_client(), "/api/v1/auth/email/confirm", {"token": token_in(mail[0])})
    c = new_client()
    r = _oauth(c, google, nxt="/ja/mypage", email="hanako@gmail.com", sub="g-hanako")
    assert r.headers["location"].endswith("/ja/mypage")
    assert c.get("/api/v1/auth/me").json()["id"] == me["id"]


def test_unlink_never_locks_the_user_out(db, google):
    c = new_client()
    _oauth(c, google, nxt="/ja/mypage", email="oauth-only@gmail.com", sub="g-only")
    me = c.get("/api/v1/auth/me").json()
    assert me["has_password"] is False and me["email_verified"] is True
    r = c.delete("/api/v1/account/social/google", headers=csrf(c))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "last_login_method"

    # OAuth-only users can set a first password (no current one to give), then unlink
    assert c.put("/api/v1/account/password", json={"new_password": NEW_PW}, headers=csrf(c)).status_code == 200
    r2 = c.delete("/api/v1/account/social/google", headers=csrf(c))
    assert r2.status_code == 200 and r2.json()["providers"] == [] and r2.json()["has_password"] is True
    assert db.scalar(select(SocialAccount.id).where(SocialAccount.provider_user_id == "g-only")) is None
    assert login("oauth-only@gmail.com", NEW_PW)[1].status_code == 200


def test_oauth_only_user_deletes_by_typing_email(db, google, mail):
    c = new_client()
    _oauth(c, google, nxt="/ja/mypage", email="bye@gmail.com", sub="g-bye")
    assert post(c, "/api/v1/account/delete", {"confirm_email": "other@gmail.com"}).status_code == 400
    assert post(c, "/api/v1/account/delete", {"confirm_email": "BYE@gmail.com"}).status_code == 204
    assert db.scalar(select(User.id).where(User.email == "bye@gmail.com")) is None
