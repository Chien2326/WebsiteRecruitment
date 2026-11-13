"""Email/password auth + session lifecycle (register, login, refresh, logout, me)
and the emailed-link flows (verify email, forgot/reset password, confirm a new email)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import accounts, mailer
from app.config import settings
from app.db import DB
from app.models import CandidateProfile, Role, RoleName, TokenPurpose, User
from app.permissions import perms_of
from app.ratelimit import enforce, rate_limit
from app.schemas import (
    CandidateRegister, ConfirmEmailOut, ForgotPasswordIn, MeOut, ResetPasswordIn, TokenIn, UserLogin,
)
from app.security import (
    CSRF_COOKIE, REFRESH_COOKIE, CurrentUser, clear_session_cookies, hash_password, new_csrf_token,
    revoke_all_sessions, revoke_by_token, rotate_refresh_token, set_session_cookies, verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def find_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def queue_verify_email(db: Session, user: User) -> tuple:
    token = accounts.issue(db, user, TokenPurpose.VERIFY_EMAIL)
    return mailer.queue_account_email(
        db, user, "verify_email", hours=accounts.VERIFY_HOURS,
        url=mailer.page_url(mailer.locale_of(user), f"verify-email?token={token}"))


def queue_password_changed(db: Session, user: User) -> tuple:
    return mailer.queue_account_email(
        db, user, "password_changed", url=mailer.page_url(mailer.locale_of(user), "forgot-password"))


def me_out(user: User) -> MeOut:
    p = user.profile
    return MeOut(
        id=user.id,
        email=user.email,
        role=user.role.name,
        preferred_locale=user.preferred_locale,
        display_name=f"{p.last_name} {p.first_name}".strip() if p else None,
        profile_complete=bool(p and p.first_name and p.last_name),
        providers=[s.provider for s in user.social_accounts],
        permissions=sorted(p.value for p in perms_of(user)),
        email_verified=user.is_email_verified,
        has_password=user.password_hash is not None,
    )


def _auth_error(code: str, http: int = status.HTTP_401_UNAUTHORIZED) -> HTTPException:
    return HTTPException(http, detail={"code": code})


def _reject(db: Session, code: str, http: int) -> HTTPException:
    """Undo a consumed-but-unused token (and anything else pending) before refusing."""
    db.rollback()
    return _auth_error(code, http)


@router.get("/csrf")
def csrf(request: Request, response: Response):
    """Hand the SPA a CSRF token (double-submit). Idempotent: keeps an existing one."""
    token = request.cookies.get(CSRF_COOKIE) or new_csrf_token()
    response.set_cookie(
        CSRF_COOKIE, token, max_age=settings.refresh_ttl_seconds, path="/",
        httponly=False, secure=settings.cookie_secure, samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"csrf_token": token}


@router.post(
    "/register", response_model=MeOut, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("register", 10, 3600))],
)
def register(body: CandidateRegister, response: Response, db: DB, tasks: BackgroundTasks):
    # Known trade-off (ps.txt): 409 reveals that an email is registered. Kept for a one-step sign-up
    # (log in immediately, apply at once); mitigated by the 10/hour/IP limit. Login and forgot-password
    # never reveal it.
    email = str(body.email).strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise _auth_error("email_taken", status.HTTP_409_CONFLICT)
    role_id = db.scalar(select(Role.id).where(Role.name == RoleName.CANDIDATE))
    user = User(email=email, password_hash=hash_password(body.password), role_id=role_id,
                preferred_locale=body.preferred_locale)
    user.profile = CandidateProfile(first_name=body.first_name, last_name=body.last_name)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # concurrent sign-up with the same email
        db.rollback()
        raise _auth_error("email_taken", status.HTTP_409_CONFLICT) from None
    set_session_cookies(response, db, user)
    queued = queue_verify_email(db, user)  # doubles as the welcome email
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    return me_out(user)


@router.post("/login", response_model=MeOut, dependencies=[Depends(rate_limit("login-ip", 20, 900))])
def login(body: UserLogin, response: Response, db: DB):
    email = str(body.email).strip().lower()
    enforce(f"login-email:{email}", 5, 900)  # slows targeted guessing on one account
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    ok = verify_password(body.password, user.password_hash if user else None)
    if not ok or user is None or not user.is_active:
        raise _auth_error("invalid_credentials")  # same answer for unknown email / wrong password
    user.last_login_at = datetime.now(timezone.utc)
    set_session_cookies(response, db, user)
    db.commit()
    return me_out(user)


@router.post("/refresh", response_model=MeOut, dependencies=[Depends(rate_limit("refresh", 60, 60))])
def refresh(request: Request, response: Response, db: DB):
    token = request.cookies.get(REFRESH_COOKIE)
    result = rotate_refresh_token(db, token) if token else None
    if result is None:
        db.commit()  # persist a family revocation, if reuse was detected
        out = JSONResponse({"detail": {"code": "session_expired"}}, status_code=401)
        clear_session_cookies(out)
        return out
    user, new_token = result
    set_session_cookies(response, db, user, refresh=new_token)
    db.commit()
    return me_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: DB):
    if token := request.cookies.get(REFRESH_COOKIE):
        revoke_by_token(db, token)
        db.commit()
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookies(out)
    return out


@router.get("/me", response_model=MeOut)
def me(user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return me_out(user)


# ------------------------------------------------------------------ email verification
@router.post("/email/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(user: CurrentUser, db: DB, tasks: BackgroundTasks):
    if user.is_email_verified:
        raise _auth_error("already_verified", status.HTTP_409_CONFLICT)
    enforce(f"verify-resend:{user.id}", 3, 3600)  # also protects the mailbox from being flooded
    queued = queue_verify_email(db, user)
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    return {"ok": True}


@router.post("/email/confirm", response_model=ConfirmEmailOut,
             dependencies=[Depends(rate_limit("email-confirm", 30, 3600))])
def confirm_email(body: TokenIn, db: DB, tasks: BackgroundTasks):
    """Opened from an emailed link (no login needed): verifies the address, or completes an email change."""
    row = accounts.consume(db, body.token, TokenPurpose.VERIFY_EMAIL, TokenPurpose.CHANGE_EMAIL)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None or not user.is_active:
        raise _reject(db, "invalid_token", status.HTTP_400_BAD_REQUEST)

    queued = None
    if row.purpose == TokenPurpose.VERIFY_EMAIL.value:
        if row.email.lower() != user.email.lower():  # link for an address the account no longer uses
            raise _reject(db, "invalid_token", status.HTTP_400_BAD_REQUEST)
        user.is_email_verified = True
    else:
        new_email, old_email = row.email.lower(), user.email
        taken = db.scalar(select(User.id).where(func.lower(User.email) == new_email, User.id != user.id))
        if taken:
            raise _reject(db, "email_taken", status.HTTP_409_CONFLICT)
        user.email, user.is_email_verified = new_email, True
        accounts.void(db, user, TokenPurpose.VERIFY_EMAIL, TokenPurpose.CHANGE_EMAIL, TokenPurpose.RESET_PASSWORD)
        # tell the OLD address, so a hijacked session cannot silently move the account away
        queued = mailer.queue_account_email(
            db, user, "email_changed", to=old_email, email=mailer.mask_email(new_email),
            url=mailer.page_url(mailer.locale_of(user), "forgot-password"))
    try:
        db.commit()
    except IntegrityError:  # someone took the address between the check and the commit
        db.rollback()
        raise _auth_error("email_taken", status.HTTP_409_CONFLICT) from None
    if queued:
        tasks.add_task(mailer.deliver, *queued)
    return ConfirmEmailOut(purpose=row.purpose, email=user.email)


# ------------------------------------------------------------------ forgot / reset password
@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(rate_limit("pw-forgot", 10, 3600))])
def forgot_password(body: ForgotPasswordIn, db: DB, tasks: BackgroundTasks):
    """Always the same answer, whether or not the email exists (no account enumeration)."""
    email = str(body.email).strip().lower()
    enforce(f"pw-forgot-email:{email}", 3, 3600)
    user = find_user_by_email(db, email)
    if user is not None and user.is_active:
        token = accounts.issue(db, user, TokenPurpose.RESET_PASSWORD)
        queued = mailer.queue_account_email(
            db, user, "password_reset", minutes=accounts.RESET_MINUTES,
            url=mailer.page_url(mailer.locale_of(user), f"reset-password?token={token}"))
        db.commit()
        tasks.add_task(mailer.deliver, *queued)
    return {"ok": True}


@router.post("/password/reset", status_code=status.HTTP_204_NO_CONTENT,
             dependencies=[Depends(rate_limit("pw-reset", 20, 3600))])
def reset_password(body: ResetPasswordIn, db: DB, tasks: BackgroundTasks):
    row = accounts.consume(db, body.token, TokenPurpose.RESET_PASSWORD)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None or not user.is_active:
        raise _reject(db, "invalid_token", status.HTTP_400_BAD_REQUEST)
    if body.new_password.lower() == user.email.lower():
        raise _reject(db, "password_equals_email", 422)  # link stays usable
    user.password_hash = hash_password(body.new_password)
    if row.email.lower() == user.email.lower():
        user.is_email_verified = True  # they just proved they read this mailbox
    accounts.void(db, user, TokenPurpose.RESET_PASSWORD)
    revoke_all_sessions(db, user)  # an attacker who had a session is out
    queued = queue_password_changed(db, user)
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookies(out)
    return out
