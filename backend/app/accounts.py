"""Single-use emailed tokens (verify email, reset password, confirm new email).

* 256-bit random token; only its SHA-256 is stored, so a DB leak does not leak usable links.
* Issuing a new token of a purpose voids the user's older unused ones (only the latest email works).
* Consuming locks the row (FOR UPDATE) and marks it used in the same transaction: no double use.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import TokenPurpose, User, UserToken

TTL: dict[TokenPurpose, timedelta] = {
    TokenPurpose.VERIFY_EMAIL: timedelta(hours=24),
    TokenPurpose.RESET_PASSWORD: timedelta(minutes=30),
    TokenPurpose.CHANGE_EMAIL: timedelta(hours=24),
}
VERIFY_HOURS = int(TTL[TokenPurpose.VERIFY_EMAIL].total_seconds() // 3600)
CHANGE_HOURS = int(TTL[TokenPurpose.CHANGE_EMAIL].total_seconds() // 3600)
RESET_MINUTES = int(TTL[TokenPurpose.RESET_PASSWORD].total_seconds() // 60)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db: Session, user: User, purpose: TokenPurpose, email: str | None = None) -> str:
    void(db, user, purpose)
    token = secrets.token_urlsafe(32)
    db.add(UserToken(user_id=user.id, purpose=purpose.value, token_hash=_hash(token),
                     email=email or user.email, expires_at=_now() + TTL[purpose]))
    db.flush()
    return token


def void(db: Session, user: User, *purposes: TokenPurpose) -> None:
    db.execute(update(UserToken).where(
        UserToken.user_id == user.id, UserToken.used_at.is_(None),
        UserToken.purpose.in_([p.value for p in purposes]),
    ).values(used_at=_now()))


def consume(db: Session, token: str, *purposes: TokenPurpose) -> UserToken | None:
    """Return the token row (now marked used) if valid for one of `purposes`, else None."""
    if not token or len(token) > 200:
        return None
    row = db.scalar(select(UserToken).where(UserToken.token_hash == _hash(token)).with_for_update())
    if (row is None or row.used_at is not None or row.expires_at <= _now()
            or row.purpose not in {p.value for p in purposes}):
        return None
    row.used_at = _now()
    return row
