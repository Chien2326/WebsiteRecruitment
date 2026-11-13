"""Phase 4: auth sessions, OAuth, resume upload security, applications. Real PostgreSQL + moto S3."""

from __future__ import annotations

import io
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from moto import mock_aws
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app import storage
from app.config import OAuthProvider
from app.files import InvalidFile, sanitize_filename, validate_resume
from app.main import app, get_db
from app.models import (
    Application, Job, JobStatus, RefreshToken, Role, RoleName, SalaryType, SocialAccount, User,
)
from app.ratelimit import limiter
from app.routers import oauth
from app.security import hash_password

engine = create_engine(os.environ["DATABASE_URL"])
PW = "correct-horse-battery"


# ====================================================================== fixtures
@pytest.fixture()
def db():
    conn = engine.connect()
    tx = conn.begin()
    s = Session(bind=conn, join_transaction_mode="create_savepoint")
    app.dependency_overrides[get_db] = lambda: s
    limiter.reset()
    yield s
    app.dependency_overrides.clear()
    s.close()
    tx.rollback()
    conn.close()


@pytest.fixture()
def s3():
    with mock_aws():
        storage.client.cache_clear()
        storage.ensure_bucket()
        yield boto3.client("s3", region_name="ap-northeast-1")
    storage.client.cache_clear()


def new_client() -> TestClient:
    return TestClient(app)


def csrf(c: TestClient) -> dict[str, str]:
    if not c.cookies.get("csrf_token"):
        c.get("/api/v1/auth/csrf")
    return {"X-CSRF-Token": c.cookies.get("csrf_token")}


def register(c: TestClient, email: str | None = None, **extra):
    body = {"email": email or f"{uuid.uuid4().hex[:8]}@example.com", "password": PW,
            "first_name": "An", "last_name": "Nguyen", **extra}
    return c.post("/api/v1/auth/register", json=body, headers=csrf(c))


def candidate_client() -> TestClient:
    c = new_client()
    assert register(c).status_code == 201
    return c


def staff(db: Session, role: RoleName) -> tuple[User, TestClient]:
    rid = db.scalar(select(Role.id).where(Role.name == role))
    u = User(email=f"{role.value}-{uuid.uuid4().hex[:6]}@example.com", password_hash=hash_password(PW), role_id=rid)
    db.add(u)
    db.flush()
    c = new_client()
    assert c.post("/api/v1/auth/login", json={"email": u.email, "password": PW}, headers=csrf(c)).status_code == 200
    return u, c


def make_job(db: Session, owner: User, status: JobStatus = JobStatus.PUBLISHED) -> Job:
    j = Job(job_code=f"T-{uuid.uuid4().hex[:10]}", title={"ja": "倉庫"}, description={"ja": "d"},
            salary_type=SalaryType.HOURLY, salary_min=1200, prefecture_id=13, status=status, created_by=owner.id)
    db.add(j)
    db.flush()
    return j


def pdf_bytes(extra: bytes = b"") -> bytes:
    return b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + extra + b"\ntrailer\n<<>>\n%%EOF\n"


def docx_bytes(*, macro: bool = False, word: bool = True, bomb: bool = False) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        ct = b'<?xml version="1.0"?><Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>' \
            if macro else b'<?xml version="1.0"?><Types/>'
        z.writestr("[Content_Types].xml", ct)
        if word:
            z.writestr("word/document.xml", b"\0" * (60 * 1024 * 1024) if bomb else b"<w:document/>")
        if macro:
            z.writestr("word/vbaProject.bin", b"\x00" * 10)
    return buf.getvalue()


def upload(c: TestClient, data: bytes, name: str):
    return c.post("/api/v1/resumes/upload", files={"file": (name, data, "application/octet-stream")}, headers=csrf(c))


# ====================================================================== 1. file validation (unit)
@pytest.mark.parametrize("data,name,code", [
    (b"MZ\x90\x00" + b"\0" * 100, "cv.pdf", "content_mismatch"),            # Windows .exe renamed to .pdf
    (b"<html><script>alert(1)</script></html>", "cv.pdf", "content_mismatch"),
    (b"<html></html>", "cv.docx", "content_mismatch"),
    (docx_bytes(word=False), "cv.docx", "content_mismatch"),                  # a zip that is not Word
    (docx_bytes(macro=True), "cv.docx", "unsafe_content"),                    # .docm renamed to .docx
    (pdf_bytes(b"/OpenAction << /S /JavaScript /JS (app.alert(1)) >>"), "cv.pdf", "unsafe_content"),
    (pdf_bytes(b"/AA << /S /J#61vaScript >>"), "cv.pdf", "unsafe_content"),   # hex-obfuscated name
    (pdf_bytes(b"/Launch << /F (cmd.exe) >>"), "cv.pdf", "unsafe_content"),
    (pdf_bytes(), "cv.exe", "unsupported_type"),
    (pdf_bytes(), "cv.doc", "unsupported_type"),
    (pdf_bytes(), "cv", "unsupported_type"),
    (b"", "cv.pdf", "empty_file"),
    (b"%PDF-1.7" + b"0" * (5 * 1024 * 1024), "cv.pdf", "file_too_large"),
    (b"%PDF-1.7\n truncated", "cv.pdf", "corrupt_file"),
])
def test_rejects_bad_files(data, name, code):
    with pytest.raises(InvalidFile) as e:
        validate_resume(data, name)
    assert e.value.code == code


def test_rejects_zip_bomb():
    with pytest.raises(InvalidFile) as e:
        validate_resume(docx_bytes(bomb=True), "cv.docx")
    assert e.value.code == "unsafe_content"


def test_accepts_real_pdf_and_docx():
    assert validate_resume(pdf_bytes(), "履歴書.PDF").content_type == "application/pdf"
    assert validate_resume(docx_bytes(), "cv.docx").file_type.value == "docx"


def test_filename_sanitized():
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("C:\\Users\\a\\履歴書.pdf") == "履歴書.pdf"
    assert sanitize_filename("cv\u202e\x00fdp.exe") == "cvfdp.exe"  # RTL override + NUL stripped


# ====================================================================== 2. auth & sessions
def test_register_sets_secure_cookie_flags(db):
    c = new_client()
    r = register(c)
    assert r.status_code == 201
    cookies = {h.split("=", 1)[0]: h for h in r.headers.get_list("set-cookie")}
    assert "HttpOnly" in cookies["access_token"] and "SameSite=lax" in cookies["access_token"]
    assert "HttpOnly" in cookies["refresh_token"] and "Path=/api/v1/auth" in cookies["refresh_token"]
    assert "HttpOnly" not in cookies["csrf_token"]  # JS must read it to echo in the header
    assert r.json()["role"] == "candidate" and r.json()["profile_complete"] is True


def test_csrf_required_for_state_changes(db):
    c = new_client()
    r = c.post("/api/v1/auth/register", json={"email": "x@example.com", "password": PW, "first_name": "a", "last_name": "b"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "csrf_failed"
    r = c.post("/api/v1/auth/register", json={"email": "x@example.com", "password": PW, "first_name": "a", "last_name": "b"},
               headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403


def test_register_cannot_choose_role_and_email_unique(db):
    c = new_client()
    r = register(c, email="Dup@Example.com", role="admin")
    assert r.status_code == 201 and r.json()["role"] == "candidate"
    assert register(new_client(), email="dup@example.COM").status_code == 409


def test_login_generic_errors_and_rate_limit(db):
    c = new_client()
    register(c, email="who@example.com")
    c2 = new_client()
    bad = c2.post("/api/v1/auth/login", json={"email": "who@example.com", "password": "wrong-password"}, headers=csrf(c2))
    nobody = c2.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password"}, headers=csrf(c2))
    assert bad.status_code == nobody.status_code == 401
    assert bad.json() == nobody.json()  # no user enumeration
    codes = [c2.post("/api/v1/auth/login", json={"email": "who@example.com", "password": "x" * 12}, headers=csrf(c2)).status_code
             for _ in range(5)]
    assert codes[-1] == 429


def test_me_requires_valid_token(db):
    c = new_client()
    assert c.get("/api/v1/auth/me").status_code == 401
    forged = jwt.encode({"sub": str(uuid.uuid4()), "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=5)},
                        "not-the-secret-" + "y" * 30, algorithm="HS256")
    c.cookies.set("access_token", forged)
    assert c.get("/api/v1/auth/me").status_code == 401
    unsigned = jwt.encode({"sub": str(uuid.uuid4()), "type": "access", "exp": 9999999999}, None, algorithm="none")
    c.cookies.set("access_token", unsigned)
    assert c.get("/api/v1/auth/me").status_code == 401


def test_refresh_rotation_and_reuse_detection(db):
    c = candidate_client()
    old = c.cookies.get("refresh_token")
    r = c.post("/api/v1/auth/refresh", headers=csrf(c))
    assert r.status_code == 200
    new = c.cookies.get("refresh_token")
    assert new and new != old

    attacker = new_client()  # replays the stolen, already-rotated token
    attacker.cookies.set("refresh_token", old, path="/api/v1/auth")
    assert attacker.post("/api/v1/auth/refresh", headers=csrf(attacker)).status_code == 401
    # ...which revoked the whole family: the legitimate (newest) token is dead too
    assert c.post("/api/v1/auth/refresh", headers=csrf(c)).status_code == 401
    user_id = db.scalar(select(RefreshToken.user_id).order_by(RefreshToken.created_at.desc()))
    assert db.scalar(select(RefreshToken.id).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))) is None


def test_logout_revokes_session(db):
    c = candidate_client()
    token = c.cookies.get("refresh_token")
    assert c.post("/api/v1/auth/logout", headers=csrf(c)).status_code == 204
    replay = new_client()
    replay.cookies.set("refresh_token", token, path="/api/v1/auth")
    assert replay.post("/api/v1/auth/refresh", headers=csrf(replay)).status_code == 401


# ====================================================================== 3. OAuth
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEST_GOOGLE = OAuthProvider(
    name="google", client_id="test-client", client_secret="s3cret", authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
    token_url="https://example.invalid/token", jwks_url="https://example.invalid/jwks",
    issuers=("https://accounts.google.com",), scope="openid email profile", use_pkce=True,
)


@pytest.fixture()
def google(monkeypatch):
    monkeypatch.setattr(oauth, "_provider", lambda name: TEST_GOOGLE if name == "google" else pytest.fail())
    monkeypatch.setattr(oauth, "_configured", lambda p: True)
    monkeypatch.setattr(oauth, "signing_key", lambda p, t: KEY.public_key())
    holder: dict = {}

    def fake_exchange(p, code, verifier):
        assert verifier, "PKCE verifier must be sent"
        return {"id_token": jwt.encode(holder["claims"], KEY, algorithm="RS256")}

    monkeypatch.setattr(oauth, "exchange_code", fake_exchange)
    return holder


def start_oauth(c: TestClient, next_path: str = "/ja/mypage") -> tuple[dict, str]:
    r = c.get("/api/v1/auth/oauth/google/login", params={"next": next_path}, follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    assert q["code_challenge_method"] == ["S256"] and q["state"] and q["nonce"]
    set_cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("oauth_state="))
    assert "HttpOnly" in set_cookie and "Secure" in set_cookie and "SameSite=none" in set_cookie
    c.cookies.set("oauth_state", set_cookie.split(";", 1)[0].split("=", 1)[1])  # Secure cookie: replay manually over http
    return {k: v[0] for k, v in q.items()}, q["state"][0]


def id_claims(nonce: str, **over) -> dict:
    now = datetime.now(timezone.utc)
    return {"iss": "https://accounts.google.com", "aud": "test-client", "sub": "g-123", "email": "taro@gmail.com",
            "email_verified": True, "given_name": "Taro", "family_name": "Yamada", "nonce": nonce,
            "iat": now, "exp": now + timedelta(minutes=5), **over}


def test_oauth_unconfigured_redirects_with_error(db):
    r = new_client().get("/api/v1/auth/oauth/google/login", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/login?error=oauth_unavailable")


def test_oauth_happy_path_creates_candidate(db, google):
    c = new_client()
    q, state = start_oauth(c)
    google["claims"] = id_claims(q["nonce"])
    r = c.get("/api/v1/auth/oauth/google/callback", params={"code": "abc", "state": state}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/ja/mypage")
    me = c.get("/api/v1/auth/me").json()
    assert me["email"] == "taro@gmail.com" and me["providers"] == ["google"] and me["display_name"] == "Yamada Taro"
    # second login with the same Google sub -> same user, no duplicate
    c2 = new_client()
    q2, state2 = start_oauth(c2)
    google["claims"] = id_claims(q2["nonce"])
    c2.get("/api/v1/auth/oauth/google/callback", params={"code": "abc", "state": state2}, follow_redirects=False)
    assert c2.get("/api/v1/auth/me").json()["id"] == me["id"]
    assert db.scalar(select(text("count(*)")).select_from(SocialAccount).where(SocialAccount.provider_user_id == "g-123")) == 1


@pytest.mark.parametrize("tamper", ["nonce", "aud", "iss", "expired", "state"])
def test_oauth_rejects_tampering(db, google, tamper):
    c = new_client()
    q, state = start_oauth(c)
    over = {"nonce": {"nonce": "other"}, "aud": {"aud": "someone-else"}, "iss": {"iss": "https://evil.example"},
            "expired": {"exp": datetime.now(timezone.utc) - timedelta(hours=1)}}.get(tamper, {})
    google["claims"] = {**id_claims(q["nonce"]), **over}
    r = c.get("/api/v1/auth/oauth/google/callback",
              params={"code": "abc", "state": "forged" if tamper == "state" else state}, follow_redirects=False)
    assert r.headers["location"].endswith("/ja/login?error=oauth_failed")
    assert c.get("/api/v1/auth/me").status_code == 401


def test_oauth_does_not_link_unverified_existing_account(db, google):
    register(new_client(), email="taro@gmail.com")  # attacker pre-registers the victim's email
    c = new_client()
    q, state = start_oauth(c)
    google["claims"] = id_claims(q["nonce"])
    r = c.get("/api/v1/auth/oauth/google/callback", params={"code": "abc", "state": state}, follow_redirects=False)
    assert r.headers["location"].endswith("/ja/login?error=email_exists")
    assert db.scalar(select(SocialAccount.id).where(SocialAccount.provider_user_id == "g-123")) is None


@pytest.mark.parametrize("nxt,expected", [("/ja/mypage", "/ja/mypage"), ("//evil.com", "/"),
                                          ("https://evil.com", "/"), ("/\\evil.com", "/")])
def test_oauth_next_is_not_an_open_redirect(nxt, expected):
    assert oauth.safe_next(nxt) == expected


def test_apple_form_post_callback_is_csrf_exempt(db):
    r = new_client().post("/api/v1/auth/oauth/apple/callback", data={"state": "x", "code": "y"}, follow_redirects=False)
    assert r.status_code == 303 and "error=oauth_failed" in r.headers["location"]  # reached handler, not 403


# ====================================================================== 4. resumes
def test_upload_stores_privately_with_server_key(db, s3):
    c = candidate_client()
    r = upload(c, pdf_bytes(), "../../履歴書.pdf")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["original_filename"] == "履歴書.pdf" and body["is_default"] is True and "s3_key" not in body
    keys = [o["Key"] for o in s3.list_objects_v2(Bucket="test-resumes")["Contents"]]
    assert len(keys) == 1 and keys[0].endswith(f"/{body['id']}.pdf") and "履歴書" not in keys[0]
    head = s3.head_object(Bucket="test-resumes", Key=keys[0])
    assert head["ContentType"] == "application/pdf" and head["ServerSideEncryption"] == "AES256"


def test_upload_rejects_malicious_file_and_stores_nothing(db, s3):
    c = candidate_client()
    r = upload(c, b"MZ\x90\x00" + b"\0" * 64, "cv.pdf")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "content_mismatch"
    assert s3.list_objects_v2(Bucket="test-resumes").get("KeyCount") == 0
    assert c.get("/api/v1/resumes").json() == []


def test_upload_size_limit_and_count_limit(db, s3):
    c = candidate_client()
    assert upload(c, b"%PDF-" + b"0" * (6 * 1024 * 1024), "big.pdf").status_code == 413
    for i in range(5):
        assert upload(c, pdf_bytes(), f"cv{i}.pdf").status_code == 201
    r = upload(c, pdf_bytes(), "cv6.pdf")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "too_many_resumes"


def test_download_url_rbac(db, s3):
    owner = candidate_client()
    rid = upload(owner, pdf_bytes(), "cv.pdf").json()["id"]
    url = owner.get(f"/api/v1/resumes/{rid}/download-url").json()["url"]
    q = parse_qs(urlparse(url).query)
    assert q["X-Amz-Expires"] == ["900"] and q["response-content-disposition"][0].startswith("attachment")

    assert candidate_client().get(f"/api/v1/resumes/{rid}/download-url").status_code == 404  # other candidate
    _, admin = staff(db, RoleName.SUPER_ADMIN)
    assert admin.get(f"/api/v1/resumes/{rid}/download-url").status_code == 200
    rec_user, rec = staff(db, RoleName.RECRUITER)
    assert rec.get(f"/api/v1/resumes/{rid}/download-url").status_code == 404  # no relation yet
    job = make_job(db, rec_user)
    owner.post("/api/v1/applications", json={"job_id": str(job.id), "resume_id": rid}, headers=csrf(owner))
    assert rec.get(f"/api/v1/resumes/{rid}/download-url").status_code == 200  # CV was submitted to their job


def test_default_and_delete(db, s3):
    c = candidate_client()
    a = upload(c, pdf_bytes(), "a.pdf").json()["id"]
    b = upload(c, docx_bytes(), "b.docx").json()["id"]
    assert c.patch(f"/api/v1/resumes/{b}/default", headers=csrf(c)).json()["is_default"] is True
    assert c.delete(f"/api/v1/resumes/{b}", headers=csrf(c)).status_code == 204
    left = c.get("/api/v1/resumes").json()
    assert [r["id"] for r in left] == [a] and left[0]["is_default"] is True  # promoted
    assert s3.list_objects_v2(Bucket="test-resumes")["KeyCount"] == 1
    other = candidate_client()
    assert other.delete(f"/api/v1/resumes/{a}", headers=csrf(other)).status_code == 404


def test_only_candidates_upload(db, s3):
    _, rec = staff(db, RoleName.RECRUITER)
    assert upload(rec, pdf_bytes(), "cv.pdf").status_code == 403


# ====================================================================== 5. applications
def test_apply_flow_and_tracking(db, s3):
    rec_user, rec = staff(db, RoleName.RECRUITER)
    job = make_job(db, rec_user)
    c = candidate_client()
    rid = upload(c, pdf_bytes(), "cv.pdf").json()["id"]

    r = c.post("/api/v1/applications", json={"job_id": str(job.id), "resume_id": rid, "cover_message": "よろしく"},
               headers=csrf(c))
    assert r.status_code == 201 and r.json()["status"] == "applied"
    app_id = r.json()["id"]
    dup = c.post("/api/v1/applications", json={"job_id": str(job.id)}, headers=csrf(c))
    assert dup.status_code == 409 and dup.json()["detail"]["code"] == "already_applied"

    mine = c.get("/api/v1/applications/my-applications").json()
    assert len(mine) == 1 and mine[0]["job"]["job_code"] == job.job_code
    assert "recruiter_note" not in mine[0] and "end_client" not in str(mine[0])

    # status moves: recruiter who owns the job only
    other_rec_user, other_rec = staff(db, RoleName.RECRUITER)
    assert other_rec.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "interview"},
                           headers=csrf(other_rec)).status_code == 404
    assert c.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "accepted"},
                   headers=csrf(c)).status_code == 403
    r = rec.patch(f"/api/v1/admin/applications/{app_id}/status", json={"status": "interview", "recruiter_note": "internal"},
                  headers=csrf(rec))
    assert r.status_code == 200
    mine = c.get("/api/v1/applications/my-applications").json()
    assert mine[0]["status"] == "interview" and "internal" not in str(mine[0])


def test_apply_guards(db, s3):
    rec_user, _ = staff(db, RoleName.RECRUITER)
    draft = make_job(db, rec_user, JobStatus.DRAFT)
    pub = make_job(db, rec_user)
    victim = candidate_client()
    victim_cv = upload(victim, pdf_bytes(), "cv.pdf").json()["id"]
    c = candidate_client()
    assert c.post("/api/v1/applications", json={"job_id": str(draft.id)}, headers=csrf(c)).status_code == 404
    r = c.post("/api/v1/applications", json={"job_id": str(pub.id), "resume_id": victim_cv}, headers=csrf(c))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "resume_not_found"
    assert c.get("/api/v1/applications/my-applications").json() == []
    assert db.scalar(select(text("count(*)")).select_from(Application).where(Application.resume_id == uuid.UUID(victim_cv))) == 0


def test_oauth_error_returns_to_login_in_user_language(db):
    r = new_client().get("/api/v1/auth/oauth/apple/login", params={"next": "/vi/jobs/HK-1"}, follow_redirects=False)
    assert r.headers["location"].endswith("/vi/login?error=oauth_unavailable")
    r = new_client().get("/api/v1/auth/oauth/apple/login", params={"next": "https://evil.com/ja/"}, follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=oauth_unavailable") and "/ja/" not in r.headers["location"]
