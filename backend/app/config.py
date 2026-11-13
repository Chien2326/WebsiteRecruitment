"""Runtime settings from environment variables (12-factor). Secure defaults; dev relaxations are explicit."""

from __future__ import annotations

import os
import secrets
import warnings
from dataclasses import dataclass

import app.envfile  # noqa: F401 - loads backend/.env (real env vars win)


def _env(key: str, default: str | None = None) -> str | None:
    v = os.environ.get(key)
    return v if v not in (None, "") else default


@dataclass(frozen=True)
class OAuthProvider:
    name: str
    client_id: str | None
    client_secret: str | None
    authorize_url: str
    token_url: str
    jwks_url: str
    issuers: tuple[str, ...]
    scope: str
    use_pkce: bool
    response_mode: str | None = None  # Apple: form_post (callback arrives as a cross-site POST)

    @property
    def configured(self) -> bool:
        return bool(self.client_id)


@dataclass(frozen=True)
class Settings:
    env: str
    database_url: str
    jwt_secret: str
    access_ttl_seconds: int
    refresh_ttl_seconds: int
    cookie_secure: bool
    frontend_url: str
    s3_endpoint_url: str | None
    s3_region: str
    s3_bucket: str
    s3_access_key: str | None
    s3_secret_key: str | None
    google: OAuthProvider
    apple: OAuthProvider
    apple_team_id: str | None
    apple_key_id: str | None
    apple_private_key: str | None  # PEM (ES256 .p8 contents)
    mail_backend: str = "console"  # console | smtp | memory (tests)
    mail_from: str = "Haken Work <no-reply@example.com>"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    admin_notify_emails: tuple[str, ...] = ()  # who is told about new employer inquiries (ADMIN_NOTIFY_EMAIL)

    @property
    def is_dev(self) -> bool:
        return self.env == "development"


def load_settings() -> Settings:
    env = _env("APP_ENV", "production")
    secret = _env("JWT_SECRET")
    if not secret:
        if env != "development":
            raise RuntimeError("JWT_SECRET must be set outside development")
        secret = secrets.token_urlsafe(48)
        warnings.warn("JWT_SECRET not set: using a random per-process secret (sessions reset on restart)")
    elif len(secret) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")

    return Settings(
        env=env,
        database_url=os.environ["DATABASE_URL"],
        jwt_secret=secret,
        access_ttl_seconds=int(_env("ACCESS_TTL_SECONDS", "900")),  # 15 min
        refresh_ttl_seconds=int(_env("REFRESH_TTL_SECONDS", str(14 * 24 * 3600))),  # 14 days
        # Secure cookies everywhere except plain-http local development.
        cookie_secure=_env("COOKIE_SECURE", "false" if env == "development" else "true") == "true",
        frontend_url=(_env("FRONTEND_URL", "http://localhost:3111") or "").rstrip("/"),
        s3_endpoint_url=_env("S3_ENDPOINT_URL"),  # e.g. http://localhost:9000 for MinIO; unset for AWS
        s3_region=_env("S3_REGION", "ap-northeast-1") or "ap-northeast-1",
        s3_bucket=_env("S3_BUCKET", "haken-resumes") or "haken-resumes",
        s3_access_key=_env("S3_ACCESS_KEY"),
        s3_secret_key=_env("S3_SECRET_KEY"),
        google=OAuthProvider(
            name="google",
            client_id=_env("GOOGLE_CLIENT_ID"),
            client_secret=_env("GOOGLE_CLIENT_SECRET"),
            authorize_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            jwks_url="https://www.googleapis.com/oauth2/v3/certs",
            issuers=("https://accounts.google.com", "accounts.google.com"),
            scope="openid email profile",
            use_pkce=True,
        ),
        apple=OAuthProvider(
            name="apple",
            client_id=_env("APPLE_CLIENT_ID"),  # the Services ID
            client_secret=None,  # generated per request (ES256 JWT), see oauth.py
            authorize_url="https://appleid.apple.com/auth/authorize",
            token_url="https://appleid.apple.com/auth/token",
            jwks_url="https://appleid.apple.com/auth/keys",
            issuers=("https://appleid.apple.com",),
            scope="name email",
            use_pkce=False,
            response_mode="form_post",
        ),
        apple_team_id=_env("APPLE_TEAM_ID"),
        apple_key_id=_env("APPLE_KEY_ID"),
        apple_private_key=_env("APPLE_PRIVATE_KEY"),
        mail_backend=_env("MAIL_BACKEND", "console") or "console",
        mail_from=_env("MAIL_FROM", "Haken Work <no-reply@example.com>") or "",
        smtp_host=_env("SMTP_HOST"),
        smtp_port=int(_env("SMTP_PORT", "587") or 587),
        smtp_user=_env("SMTP_USER"),
        smtp_password=_env("SMTP_PASSWORD"),
        smtp_starttls=_env("SMTP_STARTTLS", "true") == "true",
        admin_notify_emails=tuple(e.strip() for e in (_env("ADMIN_NOTIFY_EMAIL", "") or "").split(",") if e.strip()),
    )


settings = load_settings()
