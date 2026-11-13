"""Admin: applications (list, detail with candidate profile & CV, status change + email)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import aliased, selectinload

from app import mailer
from app.db import DB
from app.models import (
    Application, ApplicationStatus, ApplicationStatusHistory, CandidateProfile, EmailLog, Job, Resume, ResumeAccessLog,
    User,
)
from app.permissions import AppsReader, AppsUpdater, Perm, has
from app.routers.public import _escape_like
from app.schemas import (
    AdminApplicationDetail, AdminApplicationListItem, AdminCandidate, AdminPage, AdminStatusIn,
    CandidateProfileRead, EmailLogRead, ResumeAccessRead, ResumeRead, StatusHistoryRead,
)

router = APIRouter(prefix="/api/v1/admin/applications", tags=["admin: applications"])


def _scoped(stmt: Select, user: User) -> Select:
    """Recruiters only see applications to jobs they created."""
    return stmt if has(user, Perm.APPS_ALL) else stmt.where(Job.created_by == user.id)


def _base() -> Select:
    return (select(Application, Job, User, CandidateProfile)
            .join(Job, Job.id == Application.job_id)
            .join(User, User.id == Application.candidate_id)
            .outerjoin(CandidateProfile, CandidateProfile.user_id == Application.candidate_id))


def _item(a: Application, j: Job, u: User, p: CandidateProfile | None) -> dict:
    return dict(
        id=a.id, status=a.status, created_at=a.created_at, status_changed_at=a.status_changed_at,
        job_id=j.id, job_code=j.job_code, job_title=j.title, has_resume=a.resume_id is not None,
        candidate=AdminCandidate(
            user_id=u.id, email=u.email,
            display_name=f"{p.last_name} {p.first_name}".strip() if p else u.email,
            nationality=p.nationality if p else None,
            japanese_level=p.japanese_level if p else "none",
        ),
    )


def _detail(db, user: User, application_id: uuid.UUID) -> AdminApplicationDetail:
    row = db.execute(_scoped(_base().where(Application.id == application_id), user)
                     .options(selectinload(Application.job))).first()
    if row is None:
        raise HTTPException(404, detail={"code": "application_not_found"})
    a, j, u, p = row
    resume = db.get(Resume, a.resume_id) if a.resume_id else None
    emails = db.scalars(select(EmailLog).where(EmailLog.application_id == a.id).order_by(EmailLog.created_at.desc())).all()
    who = aliased(User)
    history = db.execute(
        select(ApplicationStatusHistory, who.email).outerjoin(who, who.id == ApplicationStatusHistory.changed_by)
        .where(ApplicationStatusHistory.application_id == a.id)
        .order_by(ApplicationStatusHistory.created_at, ApplicationStatusHistory.id)).all()
    access = None
    if resume is not None and has(user, Perm.APPS_ALL):
        access = [ResumeAccessRead(accessed_by=email, role=log_.accessed_by_role, inline=log_.inline, created_at=log_.created_at)
                  for log_, email in db.execute(
                      select(ResumeAccessLog, who.email).outerjoin(who, who.id == ResumeAccessLog.accessed_by)
                      .where(ResumeAccessLog.resume_id == resume.id)
                      .order_by(ResumeAccessLog.created_at.desc()).limit(50))]
    return AdminApplicationDetail(
        **_item(a, j, u, p),
        cover_message=a.cover_message, recruiter_note=a.recruiter_note,
        profile=CandidateProfileRead.model_validate(p) if p else None,
        resume=ResumeRead.model_validate(resume) if resume else None,
        emails=[EmailLogRead(template=e.template, status=e.status.value, created_at=e.created_at, sent_at=e.sent_at) for e in emails],
        history=[StatusHistoryRead(from_status=h.from_status, to_status=h.to_status, changed_by=email, created_at=h.created_at)
                 for h, email in history],
        resume_access=access,
    )


@router.get("", response_model=AdminPage[AdminApplicationListItem])
def list_applications(
    user: AppsReader, db: DB,
    status_: Annotated[ApplicationStatus | None, Query(alias="status")] = None,
    job_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    conds = []
    if status_:
        conds.append(Application.status == status_)
    if job_id:
        conds.append(Application.job_id == job_id)
    if q and (term := q.strip()):
        like = f"%{_escape_like(term)}%"
        conds.append(or_(User.email.ilike(like, escape="\\"), CandidateProfile.first_name.ilike(like, escape="\\"),
                         CandidateProfile.last_name.ilike(like, escape="\\"), Job.job_code.ilike(like, escape="\\")))
    stmt = _scoped(_base().where(*conds), user)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(stmt.order_by(Application.created_at.desc(), Application.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return AdminPage[AdminApplicationListItem](
        items=[AdminApplicationListItem(**_item(*r)) for r in rows], total=total, page=page, page_size=page_size)


@router.get("/{application_id}", response_model=AdminApplicationDetail)
def get_application(application_id: uuid.UUID, user: AppsReader, db: DB):
    return _detail(db, user, application_id)


@router.patch("/{application_id}/status", response_model=AdminApplicationDetail)
def change_status(application_id: uuid.UUID, body: AdminStatusIn, user: AppsUpdater, db: DB, tasks: BackgroundTasks):
    row = db.execute(_scoped(_base().where(Application.id == application_id), user)).first()
    if row is None:
        raise HTTPException(404, detail={"code": "application_not_found"})
    a, job, candidate, _p = row
    changed = a.status != body.status
    if changed:
        db.add(ApplicationStatusHistory(application_id=a.id, from_status=a.status.value, to_status=body.status.value,
                                        changed_by=user.id))
        a.status = body.status
        a.status_changed_at = datetime.now(timezone.utc)
    if body.recruiter_note is not None:
        a.recruiter_note = body.recruiter_note.strip() or None
    queued = mailer.queue_status_email(db, candidate, a, job.title) if changed and body.notify else None
    db.commit()
    if queued:  # after commit: the email never announces a change that was rolled back
        tasks.add_task(mailer.deliver, *queued)
    return _detail(db, user, application_id)
