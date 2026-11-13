"""Candidate profile and saved jobs (self-service)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app.db import DB
from app.models import Application, CandidateProfile, JapaneseLevel, Job, JobVisaType, SavedJob, VisaType
from app.routers.public import _LEVELS, live_job
from app.schemas import CandidateProfileRead, CandidateProfileUpsert, JobListItem
from app.security import Candidate

MAX_SAVED_JOBS = 200

router = APIRouter(prefix="/api/v1/me", tags=["me"])


@router.get("/profile", response_model=CandidateProfileRead | None)
def get_profile(user: Candidate, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return user.profile


@router.put("/profile", response_model=CandidateProfileRead)
def put_profile(body: CandidateProfileUpsert, user: Candidate, db: DB):
    if body.visa_type_id is not None and db.scalar(select(VisaType.id).where(VisaType.id == body.visa_type_id)) is None:
        raise HTTPException(422, detail={"code": "invalid_visa_type"})
    profile = user.profile or CandidateProfile(user_id=user.id)
    for field, value in body.model_dump().items():  # whitelisted by the schema: no mass assignment
        setattr(profile, field, value)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


# ------------------------------------------------------------------ saved jobs (お気に入り)
@router.get("/saved-jobs", response_model=list[JobListItem])
def saved_jobs(user: Candidate, db: DB):
    """Newest first. Jobs that were unpublished or expired are hidden (the bookmark itself is kept)."""
    return db.scalars(select(Job).join(SavedJob, SavedJob.job_id == Job.id)
                      .where(SavedJob.user_id == user.id, *live_job())
                      .order_by(SavedJob.created_at.desc())).all()


@router.get("/saved-jobs/ids", response_model=list[uuid.UUID])
def saved_job_ids(user: Candidate, db: DB):
    """Cheap list for the heart icons on job cards."""
    return db.scalars(select(SavedJob.job_id).where(SavedJob.user_id == user.id)).all()


@router.put("/saved-jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def save_job(job_id: uuid.UUID, user: Candidate, db: DB):
    if db.scalar(select(Job.id).where(Job.id == job_id, *live_job())) is None:
        raise HTTPException(404, detail={"code": "job_not_found"})
    if (db.scalar(select(func.count()).select_from(SavedJob).where(SavedJob.user_id == user.id)) or 0) >= MAX_SAVED_JOBS:
        raise HTTPException(409, detail={"code": "too_many_saved_jobs"})
    # Idempotent: saving twice is not an error.
    db.execute(insert(SavedJob).values(user_id=user.id, job_id=job_id).on_conflict_do_nothing())
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/saved-jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def unsave_job(job_id: uuid.UUID, user: Candidate, db: DB):
    db.execute(delete(SavedJob).where(SavedJob.user_id == user.id, SavedJob.job_id == job_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ recommendations (おすすめ求人)
@router.get("/recommended-jobs", response_model=list[JobListItem])
def recommended_jobs(user: Candidate, db: DB, response: Response, limit: int = 6):
    """Jobs that fit the profile. Hard rules: live, not already applied to, Japanese requirement <= the
    candidate's level, and (if the candidate set a visa) a job that accepts that visa.
    Ranking: desired prefecture > current prefecture > anywhere, then newest.
    No profile yet -> newest jobs (the page shows a "fill in your profile" hint)."""
    response.headers["Cache-Control"] = "no-store"
    limit = max(1, min(limit, 12))
    stmt = select(Job).where(*live_job(), Job.id.not_in(select(Application.job_id).where(Application.candidate_id == user.id)))
    p = user.profile
    if p is None:
        return db.scalars(stmt.order_by(Job.published_at.desc(), Job.id).limit(limit)).all()
    level = p.japanese_level or JapaneseLevel.NONE
    stmt = stmt.where(Job.japanese_level_required.in_(_LEVELS[: _LEVELS.index(level) + 1]))
    if p.visa_type_id is not None:
        stmt = stmt.where(Job.id.in_(select(JobVisaType.job_id).where(JobVisaType.visa_type_id == p.visa_type_id)))
    desired = list(p.desired_prefecture_ids or [])
    rank = case(
        *([(Job.prefecture_id.in_(desired), 0)] if desired else []),
        *([(Job.prefecture_id == p.current_prefecture_id, 1)] if p.current_prefecture_id else []),
        else_=2,
    ) if (desired or p.current_prefecture_id) else None
    order = ([rank] if rank is not None else []) + [Job.published_at.desc(), Job.id]
    return db.scalars(stmt.order_by(*order).limit(limit)).all()
