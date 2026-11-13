"""Authentication & authorization primitives.

* Passwords: Argon2id.
* Access token: short-lived JWT (HS256) in an HttpOnly cookie. Never readable by JS -> XSS cannot steal it.
* Refresh token: opaque random string in an HttpOnly cookie scoped to /api/v1/auth, rotated on every use.
* CSRF: SameSite=Lax cookies + double-submit token (`csrf_token` cookie must equal `X-CSRF-Token` header)
  on every state-changing request.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.db import DB
from app.models import RefreshToken, RoleName, User
from app.passwords import hash_password, verify_password  # noqa: F401 - re-exported

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"
REFRESH_PATH = "/api/v1/auth"
JWT_ALG = "HS256"

# ------------------------------------------------------------------ tokens
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user: User) -> str:
    now = _now()
    claims = {
        "sub": str(user.id),
        "role": user.role.name.value,
        "type": "access",
        "tv": user.token_version,  # see revoke_all_sessions
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_ttl_seconds),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=JWT_ALG)


def decode_access_token(token: str) -> dict:
    claims = jwt.decode(
        token, settings.jwt_secret, algorithms=[JWT_ALG], options={"require": ["exp", "sub", "type"]}
    )
    if claims.get("type") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return claims


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_refresh_token(db: Session, user_id: uuid.UUID, family_id: uuid.UUID | None = None) -> str:
    token = secrets.token_urlsafe(48)
    db.add(RefreshToken(
        user_id=user_id,
        family_id=family_id or uuid.uuid4(),
        token_hash=_hash_token(token),
        expires_at=_now() + timedelta(seconds=settings.refresh_ttl_seconds),
    ))
    return token


def rotate_refresh_token(db: Session, token: str) -> tuple[User, str] | None:
    """Validate + rotate. Returns (user, new_token), or None if invalid. Detects replay of a used token."""
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(token)).with_for_update())
    if row is None:
        return None
    if row.revoked_at is not None:
        # Reuse of a rotated token: someone has a stolen copy. Kill the whole session family.
        revoke_family(db, row.family_id)
        db.commit()
        return None
    if row.expires_at <= _now():
        return None
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    row.revoked_at = _now()
    new = issue_refresh_token(db, user.id, row.family_id)
    return user, new


def revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def revoke_by_token(db: Session, token: str) -> None:
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == _hash_token(token)))
    if row is not None:
        revoke_family(db, row.family_id)


def revoke_all_sessions(db: Session, user: User) -> None:
    """Log the user out everywhere: kill every refresh token and invalidate live access tokens at once."""
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    user.token_version = (user.token_version or 0) + 1
    db.flush()


# ------------------------------------------------------------------ cookies
def _cookie(response: Response, key: str, value: str, max_age: int, *, http_only: bool = True, path: str = "/") -> None:
    response.set_cookie(
        key, value, max_age=max_age, path=path, httponly=http_only,
        secure=settings.cookie_secure, samesite="lax",
    )


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_session_cookies(response: Response, db: Session, user: User, refresh: str | None = None) -> None:
    """Issue a fresh access token, (rotated) refresh token and CSRF token."""
    refresh = refresh or issue_refresh_token(db, user.id)
    _cookie(response, ACCESS_COOKIE, create_access_token(user), settings.access_ttl_seconds)
    _cookie(response, REFRESH_COOKIE, refresh, settings.refresh_ttl_seconds, path=REFRESH_PATH)
    _cookie(response, CSRF_COOKIE, new_csrf_token(), settings.refresh_ttl_seconds, http_only=False)


def clear_session_cookies(response: Response) -> None:
    for key, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, REFRESH_PATH), (CSRF_COOKIE, "/")):
        response.delete_cookie(key, path=path, secure=settings.cookie_secure, samesite="lax")


# ------------------------------------------------------------------ CSRF
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Apple posts the OAuth callback cross-site (response_mode=form_post); it is protected by `state` instead.
# "/views": anonymous job-view counter. It changes no user data, and is rate limited per IP + job.
CSRF_EXEMPT_SUFFIXES = ("/callback", "/views")


def csrf_protect(request: Request) -> None:
    if request.method not in UNSAFE_METHODS or request.url.path.endswith(CSRF_EXEMPT_SUFFIXES):
        return
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "csrf_failed"})


# ------------------------------------------------------------------ dependencies (RBAC)
def _unauthorized() -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "not_authenticated"})


def current_user(request: Request, db: DB) -> User:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise _unauthorized()
    try:
        claims = decode_access_token(token)
        user_id = uuid.UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise _unauthorized() from None
    user = db.get(User, user_id)
    if user is None or not user.is_active or claims.get("tv", 0) != user.token_version:
        raise _unauthorized()
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_role(*roles: RoleName):
    def dep(user: CurrentUser) -> User:
        if user.role.name not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "forbidden"})
        return user

    return dep


Candidate = Annotated[User, Depends(require_role(RoleName.CANDIDATE))]
# Staff/admin authorization is permission-based: see app.permissions.
