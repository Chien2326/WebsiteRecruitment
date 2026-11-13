"""Resume (CV) upload & management. Files live in a private bucket; reads use 15-minute presigned URLs."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import exists, func, select, update

from app import storage
from app.db import DB
from app.files import MAX_RESUME_BYTES, MAX_RESUMES_PER_USER, CONTENT_TYPES, InvalidFile, validate_resume
from app.models import Application, FileType, Job, Resume, ResumeAccessLog
from app.ratelimit import client_ip, rate_limit
from app.schemas import ResumeRead
from app.permissions import Perm, has
from app.security import Candidate, CurrentUser

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/resumes", tags=["resumes"])


def _owned(db, user_id: uuid.UUID, resume_id: uuid.UUID) -> Resume:
    r = db.scalar(select(Resume).where(Resume.id == resume_id, Resume.candidate_id == user_id))
    if r is None:
        raise HTTPException(404, detail={"code": "resume_not_found"})
    return r


@router.get("", response_model=list[ResumeRead])
def list_resumes(user: Candidate, db: DB, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return db.scalars(select(Resume).where(Resume.candidate_id == user.id).order_by(Resume.uploaded_at.desc())).all()


@router.post(
    "/upload", response_model=ResumeRead, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("resume-upload", 20, 3600))],
)
def upload_resume(user: Candidate, db: DB, file: UploadFile = File(...)):
    if user.profile is None:
        raise HTTPException(409, detail={"code": "profile_required"})
    count = db.scalar(select(func.count()).select_from(Resume).where(Resume.candidate_id == user.id)) or 0
    if count >= MAX_RESUMES_PER_USER:
        raise HTTPException(409, detail={"code": "too_many_resumes"})

    data = file.file.read(MAX_RESUME_BYTES + 1)  # never read more than the limit + 1 byte
    try:
        v = validate_resume(data, file.filename or "")
    except InvalidFile as e:
        code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE if e.code == "file_too_large" else 422
        raise HTTPException(code, detail={"code": e.code}) from None

    rid = uuid.uuid4()
    key = f"resumes/{user.id}/{rid}.{v.file_type.value}"  # server-generated: user input never reaches the key
    storage.put_object(key, data, v.content_type)
    resume = Resume(
        id=rid, candidate_id=user.id, s3_key=key, original_filename=v.safe_name,
        file_type=v.file_type, file_size_bytes=len(data), is_default=count == 0,
    )
    try:
        db.add(resume)
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_object(key)  # no orphaned objects
        raise
    db.refresh(resume)
    return resume


@router.patch("/{resume_id}/default", response_model=ResumeRead)
def set_default(resume_id: uuid.UUID, user: Candidate, db: DB):
    r = _owned(db, user.id, resume_id)
    db.execute(update(Resume).where(Resume.candidate_id == user.id, Resume.id != r.id).values(is_default=False))
    db.flush()
    r.is_default = True
    db.commit()
    db.refresh(r)
    return r


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resume(resume_id: uuid.UUID, user: Candidate, db: DB):
    r = _owned(db, user.id, resume_id)
    key, was_default = r.s3_key, r.is_default
    db.delete(r)  # applications keep their row; resume_id becomes NULL (FK ON DELETE SET NULL)
    db.flush()
    if was_default:
        newest = db.scalar(select(Resume).where(Resume.candidate_id == user.id).order_by(Resume.uploaded_at.desc()))
        if newest:
            newest.is_default = True
    db.commit()
    try:
        storage.delete_object(key)
    except Exception:  # noqa: BLE001 - DB is the source of truth; a lifecycle rule can sweep leftovers
        log.warning("could not delete %s from storage", key, exc_info=True)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{resume_id}/download-url")
def download_url(resume_id: uuid.UUID, user: CurrentUser, db: DB, request: Request, response: Response,
                 inline: bool = False):
    """15-minute presigned URL.

    Allowed: the owner; staff with resumes.read + applications.all (managers, super admin); a client-side
    recruiter only for CVs submitted to their own jobs. Everyone else gets 404 (not 403) so IDs can't be probed.
    `inline=true` (staff, PDF only) returns a URL served as inline application/pdf for the admin PDF viewer.
    """
    r = db.get(Resume, resume_id)
    is_owner = r is not None and r.candidate_id == user.id
    staff_ok = r is not None and has(user, Perm.RESUMES_READ) and (
        has(user, Perm.APPS_ALL)
        or bool(db.scalar(select(exists().where(
            Application.resume_id == r.id, Application.job_id == Job.id, Job.created_by == user.id))))
    )
    if not (is_owner or staff_ok):
        raise HTTPException(404, detail={"code": "resume_not_found"})
    if inline and not (staff_ok and r.file_type == FileType.PDF):
        raise HTTPException(422, detail={"code": "inline_not_allowed"})
    if not is_owner:  # audit trail in the DB (see ResumeAccessLog); the app log line stays for log shipping
        log.info("resume access: user=%s role=%s resume=%s inline=%s", user.id, user.role.name.value, r.id, inline)
        db.add(ResumeAccessLog(resume_id=r.id, candidate_id=r.candidate_id, accessed_by=user.id,
                               accessed_by_role=user.role.name.value, inline=inline, ip=client_ip(request)))
        db.commit()
    response.headers["Cache-Control"] = "no-store"
    return {
        "url": storage.presigned_get(r.s3_key, r.original_filename, CONTENT_TYPES[r.file_type], inline=inline),
        "expires_in": storage.PRESIGN_TTL_SECONDS,
    }
