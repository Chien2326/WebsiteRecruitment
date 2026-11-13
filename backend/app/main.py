"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import get_db  # noqa: F401 - re-exported (tests override this dependency)
from app.files import MAX_RESUME_BYTES
from app.routers import (
    account, admin_applications, admin_jobs, admin_misc, applications, auth, content, me, oauth, public, resumes,
)
from app.security import csrf_protect

log = logging.getLogger(__name__)

# Our INFO logs carry the resume-access audit trail and (in dev) the console mail backend, so they must not be
# swallowed by Python's default WARNING level. Uvicorn only configures its own loggers.
_app_log = logging.getLogger("app")
if not _app_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    _app_log.addHandler(_h)
    _app_log.setLevel(logging.INFO)
    _app_log.propagate = False


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.is_dev:
        try:
            from app import storage

            storage.ensure_bucket()
        except Exception:  # noqa: BLE001 - storage may simply not be running in dev
            log.warning("object storage not reachable; resume upload will fail until it is", exc_info=True)
    yield


app = FastAPI(
    title="Haken Work API",
    docs_url="/api/docs" if settings.is_dev else None,  # no public API docs in production
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.is_dev else None,
    lifespan=lifespan,
    dependencies=[Depends(csrf_protect)],
)

for r in (public.router, auth.router, oauth.router, me.router, account.router, resumes.router,
          applications.router, admin_jobs.router, admin_applications.router, admin_misc.router,
          content.router, content.admin_router):
    app.include_router(r)

_UPLOAD_BODY_LIMIT = MAX_RESUME_BYTES + 64 * 1024  # file + multipart overhead
_PRIVATE_PREFIXES = ("/api/v1/auth", "/api/v1/me", "/api/v1/account", "/api/v1/resumes", "/api/v1/applications",
                     "/api/v1/admin")


@app.middleware("http")
async def guard(request: Request, call_next):
    # Reject oversized uploads before the multipart body is parsed (Nginx client_max_body_size is the outer guard).
    if request.url.path.endswith("/resumes/upload"):
        try:
            if int(request.headers.get("content-length", "0")) > _UPLOAD_BODY_LIMIT:
                return JSONResponse({"detail": {"code": "file_too_large"}}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": {"code": "bad_request"}}, status_code=400)

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith(_PRIVATE_PREFIXES):
        response.headers.setdefault("Cache-Control", "no-store")  # personal data never cached by proxies/CDN
    return response
