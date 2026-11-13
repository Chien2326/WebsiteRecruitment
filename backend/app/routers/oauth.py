"""Google / Apple sign-in (OpenID Connect authorization-code flow).

Security:
* `state` (CSRF), `nonce` (id_token replay) and PKCE (Google) are kept in a signed, HttpOnly, 10-minute
  cookie, so the server stays stateless.
* The id_token signature is verified against the provider's JWKS, plus `iss`, `aud`, `exp`, `nonce`.
* `next` is restricted to same-site relative paths (no open redirect).
* Accounts are linked by email ONLY when both the provider and our record have a verified email.
  Otherwise someone could pre-register a victim's email with a password and later inherit the
  victim's Google login ("pre-account takeover").
* Explicit linking (`?link=1`, from account settings) needs a logged-in session; the user id is bound
  into the signed state and re-checked against the session cookie on the callback.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select

from app.config import OAuthProvider, settings
from app.db import DB
from app.models import CandidateProfile, Role, RoleName, SocialAccount, SocialProvider, User
from app.security import JWT_ALG, current_user, set_session_cookies

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/auth/oauth", tags=["oauth"])

STATE_COOKIE = "oauth_state"
STATE_PATH = "/api/v1/auth/oauth"
STATE_TTL = 600


def _provider(name: str) -> OAuthProvider:
    if name == "google":
        return settings.google
    if name == "apple":
        return settings.apple
    raise HTTPException(404, detail={"code": "unknown_provider"})


def _configured(p: OAuthProvider) -> bool:
    if p.name == "apple":
        return bool(p.client_id and settings.apple_team_id and settings.apple_key_id and settings.apple_private_key)
    return bool(p.client_id and p.client_secret)


def safe_next(v: str | None) -> str:
    """Only same-site relative paths: '/ja/mypage' yes; '//evil.com', 'https://evil.com', '/\\evil' no."""
    if v and v.startswith("/") and not v.startswith("//") and "\\" not in v and len(v) <= 300:
        return v
    return "/"


def _redirect_uri(p: OAuthProvider) -> str:
    return f"{settings.frontend_url}/api/v1/auth/oauth/{p.name}/callback"


_LOCALE_PREFIX = re.compile(r"^/(ja|en|vi|my|ne|bn)(?:/|$)")


def _fail(code: str, next_path: str | None = None) -> RedirectResponse:
    """Back to the login page in the user's language (taken from `next`), with an error code."""
    m = _LOCALE_PREFIX.match(safe_next(next_path))
    login = f"/{m.group(1)}/login" if m else "/login"
    resp = RedirectResponse(f"{settings.frontend_url}{login}?error={code}", status_code=303)
    resp.delete_cookie(STATE_COOKIE, path=STATE_PATH, secure=True, samesite="none")
    return resp


def _link_result(next_path: str | None, key: str, value: str) -> RedirectResponse:
    """Back to the account settings page with ?linked=google or ?link_error=<code>."""
    target = safe_next(next_path)
    sep = "&" if "?" in target else "?"
    resp = RedirectResponse(f"{settings.frontend_url}{target}{sep}{key}={value}", status_code=303)
    resp.delete_cookie(STATE_COOKIE, path=STATE_PATH, secure=True, samesite="none")
    return resp


def _session_user_id(request: Request, db) -> str | None:
    try:
        return str(current_user(request, db).id)
    except HTTPException:
        return None


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


# ------------------------------------------------------------------ provider calls (patched in tests)
def _client_secret(p: OAuthProvider) -> str:
    if p.name != "apple":
        return p.client_secret or ""
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"iss": settings.apple_team_id, "iat": now, "exp": now + timedelta(minutes=5),
         "aud": "https://appleid.apple.com", "sub": p.client_id},
        settings.apple_private_key, algorithm="ES256", headers={"kid": settings.apple_key_id},
    )


def exchange_code(p: OAuthProvider, code: str, verifier: str | None) -> dict[str, Any]:
    data = {
        "grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(p),
        "client_id": p.client_id, "client_secret": _client_secret(p),
    }
    if verifier:
        data["code_verifier"] = verifier
    r = httpx.post(p.token_url, data=data, timeout=10)
    r.raise_for_status()
    return r.json()


@lru_cache(maxsize=4)
def _jwks(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def signing_key(p: OAuthProvider, id_token: str) -> Any:
    return _jwks(p.jwks_url).get_signing_key_from_jwt(id_token).key


def verify_id_token(p: OAuthProvider, id_token: str, nonce: str) -> dict[str, Any]:
    claims = jwt.decode(
        id_token, signing_key(p, id_token), algorithms=["RS256"],
        audience=p.client_id, issuer=list(p.issuers), leeway=60,
        options={"require": ["exp", "iat", "iss", "aud", "sub"]},
    )
    if not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        raise jwt.InvalidTokenError("nonce mismatch")
    return claims


# ------------------------------------------------------------------ account resolution
def resolve_user(db, p: OAuthProvider, claims: dict[str, Any], names: tuple[str, str]) -> tuple[User | None, str | None]:
    provider = SocialProvider(p.name)
    sub = str(claims["sub"])
    email = (claims.get("email") or "").strip().lower()
    verified = claims.get("email_verified") in (True, "true")

    acct = db.scalar(select(SocialAccount).where(
        SocialAccount.provider == provider, SocialAccount.provider_user_id == sub))
    if acct is not None:
        user = db.get(User, acct.user_id)
        return (user, None) if user and user.is_active else (None, "account_disabled")

    if not email:
        return None, "oauth_no_email"
    existing = db.scalar(select(User).where(func.lower(User.email) == email))
    if existing is not None:
        if verified and existing.is_email_verified and existing.is_active:
            db.add(SocialAccount(user_id=existing.id, provider=provider, provider_user_id=sub, provider_email=email))
            return existing, None
        return None, "email_exists"  # log in with password first; linking comes later from account settings

    role_id = db.scalar(select(Role.id).where(Role.name == RoleName.CANDIDATE))
    user = User(email=email, password_hash=None, role_id=role_id, is_email_verified=verified)
    given, family = names
    user.profile = CandidateProfile(
        first_name=(given or claims.get("given_name") or "")[:100],
        last_name=(family or claims.get("family_name") or "")[:100],
    )
    user.social_accounts.append(SocialAccount(provider=provider, provider_user_id=sub, provider_email=email))
    db.add(user)
    db.flush()
    return user, None


# ------------------------------------------------------------------ routes
@router.get("/{provider}/login")
def oauth_login(provider: str, request: Request, db: DB, next: str | None = None, link: bool = False):
    p = _provider(provider)
    link_uid = None
    if link:
        link_uid = _session_user_id(request, db)
        if link_uid is None:
            return _fail("not_authenticated", next)
    if not _configured(p):
        return _link_result(next, "link_error", "oauth_unavailable") if link else _fail("oauth_unavailable", next)
    state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64) if p.use_pkce else None
    params = {
        "client_id": p.client_id, "redirect_uri": _redirect_uri(p), "response_type": "code",
        "scope": p.scope, "state": state, "nonce": nonce,
    }
    if verifier:
        params |= {"code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
                   "code_challenge_method": "S256"}
    if p.response_mode:
        params["response_mode"] = p.response_mode
    if p.name == "google":
        params["prompt"] = "select_account"

    signed = jwt.encode(
        {"s": state, "n": nonce, "v": verifier, "next": safe_next(next), "p": p.name, "link": link_uid,
         "exp":datetime.now(timezone.utc) + timedelta(seconds=STATE_TTL)},
        settings.jwt_secret, algorithm=JWT_ALG,
    )
    resp = RedirectResponse(f"{p.authorize_url}?{urlencode(params)}", status_code=302)
    # SameSite=None: Apple returns via a cross-site POST, which would not carry a Lax cookie.
    resp.set_cookie(STATE_COOKIE, signed, max_age=STATE_TTL, path=STATE_PATH,
                    httponly=True, secure=True, samesite="none")
    return resp


def _complete(provider: str, request: Request, db, code: str | None, state: str | None,
              error: str | None, apple_user: str | None) -> RedirectResponse:
    p = _provider(provider)
    if error:
        return _fail("oauth_cancelled")
    try:
        st = jwt.decode(request.cookies.get(STATE_COOKIE, ""), settings.jwt_secret, algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        return _fail("oauth_failed")
    nxt = st.get("next")
    if st.get("p") != p.name or not state or not hmac.compare_digest(st.get("s", ""), state) or not code:
        return _fail("oauth_failed", nxt)
    try:
        tokens = exchange_code(p, code, st.get("v"))
        claims = verify_id_token(p, tokens["id_token"], st["n"])
    except Exception:  # noqa: BLE001 - any provider/verification failure ends the same way
        log.warning("oauth %s verification failed", p.name, exc_info=True)
        return _fail("oauth_failed", nxt)

    if st.get("link"):
        return _complete_link(p, request, db, claims, st)

    names = ("", "")
    if apple_user:  # Apple sends the name once, on first authorization only
        try:
            n = json.loads(apple_user).get("name") or {}
            names = (str(n.get("firstName", "")), str(n.get("lastName", "")))
        except (ValueError, AttributeError):
            pass

    user, err = resolve_user(db, p, claims, names)
    if err or user is None:
        db.rollback()
        return _fail(err or "oauth_failed", nxt)
    user.last_login_at = datetime.now(timezone.utc)
    resp = RedirectResponse(f"{settings.frontend_url}{safe_next(st.get('next'))}", status_code=303)
    set_session_cookies(resp, db, user)
    resp.delete_cookie(STATE_COOKIE, path=STATE_PATH, secure=True, samesite="none")
    db.commit()
    return resp


def _complete_link(p: OAuthProvider, request: Request, db, claims: dict[str, Any], st: dict) -> RedirectResponse:
    """Attach this provider identity to the user who started the link.

    The user id comes from the signed state cookie, minted only after the session was checked. The
    session cookie itself is not required here: Apple returns with a cross-site POST, which does not carry
    SameSite=Lax cookies. If a session *is* present it must be the same user (no mix-ups between tabs).
    """
    nxt = st.get("next")
    uid = str(st["link"])
    current = _session_user_id(request, db)
    if current is not None and not hmac.compare_digest(current, uid):
        return _link_result(nxt, "link_error", "not_authenticated")
    user = db.get(User, uuid.UUID(uid))
    if user is None or not user.is_active:
        return _link_result(nxt, "link_error", "account_disabled")
    provider, sub = SocialProvider(p.name), str(claims["sub"])
    owner = db.scalar(select(SocialAccount.user_id).where(
        SocialAccount.provider == provider, SocialAccount.provider_user_id == sub))
    if owner is not None and owner != user.id:
        return _link_result(nxt, "link_error", "oauth_already_linked")  # that Google account is someone else's
    if owner is None:
        if any(s.provider == provider for s in user.social_accounts):
            return _link_result(nxt, "link_error", "provider_already_linked")
        db.add(SocialAccount(user_id=user.id, provider=provider, provider_user_id=sub,
                             provider_email=(claims.get("email") or "").strip().lower() or None))
        db.commit()
    return _link_result(nxt, "linked", p.name)


@router.get("/{provider}/callback")
def oauth_callback_get(provider: str, request: Request, db: DB, code: str | None = None,
                       state: str | None = None, error: str | None = None):
    return _complete(provider, request, db, code, state, error, None)


@router.post("/{provider}/callback")
def oauth_callback_post(
    provider: str, request: Request, db: DB,
    code: Annotated[str | None, Form()] = None,
    state: Annotated[str | None, Form()] = None,
    error: Annotated[str | None, Form()] = None,
    user: Annotated[str | None, Form(max_length=2000)] = None,
):
    return _complete(provider, request, db, code, state, error, user)
