"""Shared test setup. Env must be set before `app.config` is imported."""

from __future__ import annotations

import os

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ["S3_ACCESS_KEY"] = "testing"
os.environ["S3_SECRET_KEY"] = "testing"
os.environ["S3_BUCKET"] = "test-resumes"
os.environ["S3_REGION"] = "ap-northeast-1"
# Set to "" (not popped): app/envfile.py loads backend/.env without overriding variables that EXIST, and
# config treats "" as unset. Popping would let the developer's real .env values leak into the tests.
os.environ["S3_ENDPOINT_URL"] = ""  # moto intercepts the real AWS endpoint
for _k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APPLE_CLIENT_ID", "ADMIN_NOTIFY_EMAIL"):
    os.environ[_k] = ""
# backend/.env may say MAIL_BACKEND=smtp (real Gmail/SES): tests must never send real mail.
os.environ["MAIL_BACKEND"] = "memory"
