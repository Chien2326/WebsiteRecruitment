"""Password hashing (Argon2id). No app settings needed, so CLI tools can use it without JWT/S3 config."""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_ph = PasswordHasher()  # argon2id, library defaults (memory-hard)
_DUMMY_HASH = _ph.hash(secrets.token_urlsafe(16))


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, hashed: str | None) -> bool:
    """Constant work whether or not the user exists (no user-enumeration by timing)."""
    try:
        return _ph.verify(hashed or _DUMMY_HASH, pw) and hashed is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
