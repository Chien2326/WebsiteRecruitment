"""Self-service account settings: change password / email, unlink Google/Apple, delete account (APPI).

Every sensitive change re-checks the current password (when the account has one), so a stolen session
alone cannot take the account over, and each one notifies the account's email address.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response, status
from sqlalchemy import func, select, update

from app import accounts, mailer, storage
from app.db import DB
from app.models import EmailLog, Resume, RoleName, SocialAccount, SocialProvider, TokenPurpose, User
from app.ratelimit import enforce
from app.routers.auth import me_out, queue_password_changed
from app.schemas import ChangeEmailIn, ChangePasswordIn, DeleteAccountIn, MeOut
from app.security import (
    CurrentUser, clear_session_cookies, hash_password, revoke_all_sessions, set_session_cookies, verify_password,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/account", tags=["account"])


def _err(code: str, http: int) -> HTTPException:
    return HTTPException(http, detail={"code": code})


def _check_current_password(user: User, given: str | None) -> None:
    """Accounts with a password must re-enter it. OAuth-only accounts have none to give."""
    if user.password_hash is None:
        return
    enforce(f"reauth:{user.id}", 10, 900)  # a stolen session cannot brute-force the password here
    if not given or not verify_password(given, user.password_hash):
        raise _err("wrong_password", status.HTTP_400_BAD_REQUEST)


# ------------------------------------------------------------------ password
@router.put("/password", response_model=MeOut)
def change_password(body: ChangePasswordIn, user: CurrentUser, db: DB, response: Response, tasks: BackgroundTasks):
    _check_current_password(user, body.current_password)
    if body.new_password.lower() == user.email.lower():
        raise _err("password_equals_email", 422)
    user.password_hash = hash_password(body.new_password)
    accounts.void(db, user, TokenPurpose.RESET_PASSWORD)
    revoke_all_sessions(db, user)  # every other device is signed out...
    set_session_cookies(response, db, user)  # ...this one gets a fresh session
    queued = queue_password_changed(db, user)
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    return me_out(user)


# ------------------------------------------------------------------ email
@router.post("/email", status_code=status.HTTP_202_ACCEPTED)
def request_email_change(body: ChangeEmailIn, user: CurrentUser, db: DB, tasks: BackgroundTasks):
    """Sends a confirmation link to the NEW address; nothing changes until it is opened."""
    enforce(f"email-change:{user.id}", 5, 3600)
    _check_current_password(user, body.current_password)
    new_email = str(body.new_email).strip().lower()
    if new_email == user.email.lower():
        raise _err("same_email", status.HTTP_400_BAD_REQUEST)
    if db.scalar(select(User.id).where(func.lower(User.email) == new_email)):
        raise _err("email_taken", status.HTTP_409_CONFLICT)
    token = accounts.issue(db, user, TokenPurpose.CHANGE_EMAIL, email=new_email)
    queued = mailer.queue_account_email(
        db, user, "email_change", to=new_email, email=new_email, hours=accounts.CHANGE_HOURS,
        url=mailer.page_url(mailer.locale_of(user), f"verify-email?token={token}"))
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    return {"ok": True}


# ------------------------------------------------------------------ social accounts
@router.delete("/social/{provider}", response_model=MeOut)
def unlink_social(provider: SocialProvider, user: CurrentUser, db: DB):
    acct = next((s for s in user.social_accounts if s.provider == provider), None)
    if acct is None:
        raise _err("not_linked", status.HTTP_404_NOT_FOUND)
    if user.password_hash is None and len(user.social_accounts) == 1:
        raise _err("last_login_method", status.HTTP_409_CONFLICT)  # would lock the user out
    user.social_accounts.remove(acct)
    db.commit()
    db.refresh(user)
    return me_out(user)


# ------------------------------------------------------------------ delete (APPI: right to deletion)
@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: DeleteAccountIn, user: CurrentUser, db: DB, tasks: BackgroundTasks):
    if user.role.name != RoleName.CANDIDATE:
        raise _err("staff_cannot_self_delete", status.HTTP_403_FORBIDDEN)  # staff are removed by an admin
    if user.password_hash is not None:
        _check_current_password(user, body.password)
    elif (body.confirm_email or "").strip().lower() != user.email.lower():
        raise _err("confirm_email_mismatch", status.HTTP_400_BAD_REQUEST)

    keys = list(db.scalars(select(Resume.s3_key).where(Resume.candidate_id == user.id)))
    _, goodbye = mailer.build_account_mail(user, "account_deleted")
    email = user.email
    # Profile, CVs, applications, social links, sessions and tokens go with the user (ON DELETE CASCADE).
    # The email log keeps only that a mail was sent, not to whom.
    db.execute(update(EmailLog).where(func.lower(EmailLog.to_email) == email.lower()).values(to_email="(deleted)"))
    db.delete(user)
    db.commit()
    log.info("account deleted user_id=%s resumes=%d", user.id, len(keys))

    tasks.add_task(_delete_files, keys)
    tasks.add_task(mailer.deliver_unlogged, goodbye)
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookies(out)
    return out


def _delete_files(keys: list[str]) -> None:
    for key in keys:
        try:
            storage.delete_object(key)
        except Exception:  # noqa: BLE001 - logged with the key so it can be removed by hand
            log.error("could not delete CV object %s after account deletion", key, exc_info=True)
