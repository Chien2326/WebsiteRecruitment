"""Admin: job postings (list/filter/paginate, create/edit, approval workflow).

Approval flow
  draft --submit--> pending --approve--> published --hide--> archived
          <-reject(note)--      <-------------- re-open (approver) ----
* recruiter (own jobs only): draft<->pending, hide own job; editing a live job sends it back to pending.
* recruiter_manager / super_admin (jobs.approve): every transition.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, Text, func, select
from sqlalchemy.orm import selectinload

from app.db import DB
from app.models import JOB_CODE_SEQ, Application, Job, JobEndClient, JobStatus, Prefecture, User, VisaType
from app.permissions import JobsReader, JobsWriter, Perm, has
from app.routers.public import _escape_like
from app.schemas import AdminJobIn, AdminJobListItem, AdminJobOut, AdminPage, JobTransitionIn

router = APIRouter(prefix="/api/v1/admin/jobs", tags=["admin: jobs"])
JST = timezone(timedelta(hours=9), "JST")  # Japan has no DST; a fixed offset needs no tz database

S = JobStatus
ALLOWED: dict[JobStatus, set[JobStatus]] = {
    S.DRAFT: {S.PENDING, S.PUBLISHED, S.ARCHIVED},
    S.PENDING: {S.DRAFT, S.PUBLISHED, S.ARCHIVED},
    S.PUBLISHED: {S.ARCHIVED},
    S.ARCHIVED: {S.PUBLISHED, S.DRAFT},
}
# What a job owner WITHOUT jobs.approve may do.
OWNER_ALLOWED = {(S.DRAFT, S.PENDING), (S.PENDING, S.DRAFT), (S.DRAFT, S.ARCHIVED), (S.PUBLISHED, S.ARCHIVED)}

# Corporate designators stripped before comparing names ("トヨタ自動車株式会社" ~ "トヨタ自動車").
_CORP = re.compile(
    r"(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|co\.?,?ltd\.?|inc\.?|corp(oration)?\.?|k\.?k\.?|llc|ltd\.?|limited|company)",
    re.IGNORECASE,
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    s = _CORP.sub("", s)
    return re.sub(r"[\s・,.\-‐ー_()（）]", "", s)


def assert_display_name_safe(display: dict[str, str] | None, end_client: str) -> None:
    """Haken rule: the public display name must never reveal the real client."""
    core = _norm(end_client)
    if not display or len(core) < 2:
        return
    for text in display.values():
        if core in _norm(text):
            raise HTTPException(422, detail={"code": "display_name_reveals_client"})


def _scoped(stmt: Select, user: User) -> Select:
    return stmt if has(user, Perm.JOBS_ALL) else stmt.where(Job.created_by == user.id)


def _load(db, user: User, job_id: uuid.UUID) -> Job:
    job = db.scalar(_scoped(
        select(Job).options(selectinload(Job.visa_types), selectinload(Job.end_client)).where(Job.id == job_id), user))
    if job is None:
        raise HTTPException(404, detail={"code": "job_not_found"})
    return job


def _out(job: Job, user: User) -> AdminJobOut:
    data = {c: getattr(job, c) for c in AdminJobOut.model_fields if hasattr(job, c) and c not in
            {"visa_type_ids", "end_client_name", "end_client_address", "internal_note"}}
    out = AdminJobOut(**data, visa_type_ids=[v.id for v in job.visa_types])
    if has(user, Perm.END_CLIENT_VIEW) and job.end_client is not None:
        out.end_client_name = job.end_client.end_client_name
        out.end_client_address = job.end_client.end_client_address
        out.internal_note = job.end_client.internal_note
    return out


def _apply(db, job: Job, body: AdminJobIn) -> None:
    if db.get(Prefecture, body.prefecture_id) is None:
        raise HTTPException(422, detail={"code": "invalid_prefecture"})
    visas = db.scalars(select(VisaType).where(VisaType.id.in_(body.visa_type_ids))).all() if body.visa_type_ids else []
    if len(visas) != len(set(body.visa_type_ids)):
        raise HTTPException(422, detail={"code": "invalid_visa_type"})
    assert_display_name_safe(body.client_display_name, body.end_client_name)

    for f in ("title", "description", "client_display_name", "employment_type", "salary_type", "salary_min",
              "salary_max", "transport_fee_included", "prefecture_id", "city", "nearest_station", "work_shift",
              "work_hours_per_week", "japanese_level_required", "features", "expires_at"):
        setattr(job, f, getattr(body, f))
    job.visa_types = list(visas)
    if job.end_client is None:
        job.end_client = JobEndClient(end_client_name=body.end_client_name)
    job.end_client.end_client_name = body.end_client_name
    job.end_client.end_client_address = body.end_client_address
    job.end_client.internal_note = body.internal_note


# ------------------------------------------------------------------ routes
@router.get("", response_model=AdminPage[AdminJobListItem])
def list_jobs(
    user: JobsReader, db: DB,
    status_: Annotated[JobStatus | None, Query(alias="status")] = None,
    prefecture_id: Annotated[int | None, Query(ge=1, le=47)] = None,
    created_from: date | None = None,
    created_to: date | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    conds = []
    if status_:
        conds.append(Job.status == status_)
    if prefecture_id:
        conds.append(Job.prefecture_id == prefecture_id)
    # Calendar days are Japan days: "created on 11/12" means 11/12 00:00-24:00 JST, not UTC.
    if created_from:
        conds.append(Job.created_at >= datetime.combine(created_from, time.min, JST))
    if created_to:  # inclusive day
        conds.append(Job.created_at < datetime.combine(created_to + timedelta(days=1), time.min, JST))
    if q and (term := q.strip()):
        like = f"%{_escape_like(term)}%"
        conds.append(Job.title.cast(Text).ilike(like, escape="\\") | Job.job_code.ilike(like, escape="\\"))

    base = _scoped(select(Job.id).where(*conds), user)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    apps = (select(Application.job_id, func.count().label("n")).group_by(Application.job_id).subquery())
    rows = db.execute(
        _scoped(select(Job, func.coalesce(apps.c.n, 0)).outerjoin(apps, apps.c.job_id == Job.id).where(*conds), user)
        .order_by(Job.created_at.desc(), Job.id).offset((page - 1) * page_size).limit(page_size)
    ).all()
    items = [AdminJobListItem.model_validate(j).model_copy(update={"applications_count": n}) for j, n in rows]
    return AdminPage[AdminJobListItem](items=items, total=total, page=page, page_size=page_size)


@router.get("/{job_id}", response_model=AdminJobOut)
def get_job(job_id: uuid.UUID, user: JobsReader, db: DB):
    return _out(_load(db, user, job_id), user)


@router.post("", response_model=AdminJobOut, status_code=status.HTTP_201_CREATED)
def create_job(body: AdminJobIn, user: JobsWriter, db: DB):
    n = db.scalar(select(JOB_CODE_SEQ.next_value()))
    job = Job(job_code=f"HK-{datetime.now(timezone.utc).year}-{n:06d}", created_by=user.id, status=S.DRAFT)
    job.visa_types = []
    _apply(db, job, body)
    db.add(job)
    db.commit()
    return _out(_load(db, user, job.id), user)


@router.put("/{job_id}", response_model=AdminJobOut)
def update_job(job_id: uuid.UUID, body: AdminJobIn, user: JobsWriter, db: DB):
    job = _load(db, user, job_id)
    _apply(db, job, body)
    if job.status in (S.PUBLISHED, S.ARCHIVED) and not has(user, Perm.JOBS_APPROVE):
        job.status = S.PENDING  # a live job changed by a non-approver must be re-approved
    db.commit()
    return _out(_load(db, user, job.id), user)


@router.post("/{job_id}/transition", response_model=AdminJobOut)
def transition(job_id: uuid.UUID, body: JobTransitionIn, user: JobsWriter, db: DB):
    job = _load(db, user, job_id)
    frm, to = job.status, body.to
    if to not in ALLOWED.get(frm, set()):
        raise HTTPException(409, detail={"code": "invalid_transition"})
    if not has(user, Perm.JOBS_APPROVE) and (frm, to) not in OWNER_ALLOWED:
        raise HTTPException(403, detail={"code": "approval_required"})
    if frm == S.PENDING and to == S.DRAFT and has(user, Perm.JOBS_APPROVE) and job.created_by != user.id:
        if not (body.note and body.note.strip()):
            raise HTTPException(422, detail={"code": "review_note_required"})  # a rejection must say why
    job.status = to
    if to == S.PUBLISHED:
        job.published_at = job.published_at or datetime.now(timezone.utc)
        job.review_note = None
    elif body.note is not None:
        job.review_note = body.note.strip() or None
    db.commit()
    return _out(_load(db, user, job.id), user)
