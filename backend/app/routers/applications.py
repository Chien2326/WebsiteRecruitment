"""Job applications (candidate side). Staff-side management lives in admin_applications.py."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app import mailer
from app.db import DB
from app.models import Application, ApplicationStatusHistory, Job, Resume
from app.ratelimit import rate_limit
from app.routers.public import live_job
from app.schemas import ApplicationCreate, ApplicationCreated, ApplicationRead
from app.security import Candidate

router = APIRouter(prefix="/api/v1/applications", tags=["applications"])


@router.post(
    "", response_model=ApplicationCreated, status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("apply", 30, 3600))],
)
def apply(body: ApplicationCreate, user: Candidate, db: DB, tasks: BackgroundTasks):
    p = user.profile
    if p is None or not (p.first_name and p.last_name):
        raise HTTPException(409, detail={"code": "profile_incomplete"})
    job_title = db.scalar(select(Job.title).where(Job.id == body.job_id, *live_job()))  # not expired either
    if job_title is None:
        raise HTTPException(404, detail={"code": "job_not_found"})
    if body.resume_id is not None and db.scalar(
        select(Resume.id).where(Resume.id == body.resume_id, Resume.candidate_id == user.id)
    ) is None:
        raise HTTPException(404, detail={"code": "resume_not_found"})  # can't attach someone else's CV

    app_ = Application(job_id=body.job_id, candidate_id=user.id, resume_id=body.resume_id,
                       cover_message=(body.cover_message or "").strip() or None)
    db.add(app_)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "already_applied"}) from None
    db.add(ApplicationStatusHistory(application_id=app_.id, from_status=None, to_status=app_.status.value,
                                    changed_by=user.id))
    queued = mailer.queue_application_email(db, user, app_, job_title)  # "we received your application"
    db.commit()
    tasks.add_task(mailer.deliver, *queued)
    return ApplicationCreated(id=app_.id, status=app_.status)


@router.get("/my-applications", response_model=list[ApplicationRead])
def my_applications(user: Candidate, db: DB, response: Response):
    """The candidate's own applications. Shape has no recruiter_note and no end-client data."""
    response.headers["Cache-Control"] = "no-store"
    return db.scalars(
        select(Application).options(selectinload(Application.job))
        .where(Application.candidate_id == user.id).order_by(Application.created_at.desc())
    ).all()
