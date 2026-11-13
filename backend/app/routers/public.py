"""Public, unauthenticated read endpoints (jobs, map counts, lookups)."""

from __future__ import annotations

import uuid
from typing import Annotated

from typing import Literal

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from sqlalchemy import Text, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from app.db import DB
from app.models import (
    CmsContent, EmploymentType, JapaneseLevel, Job, JobStatus, JobViewDaily, JobVisaType, Prefecture, Region, SalaryType,
    TranslationOverride, VisaType,
)
from app.ratelimit import client_ip, limiter
from app.schemas import JobListItem, JobPublic, PublicPage, VisaTypeRead

router = APIRouter(prefix="/api/v1", tags=["public"])


def _escape_like(term: str) -> str:
    """User text is a literal: neutralise LIKE wildcards so '%' or '_' can't widen the match."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def live_job():
    """Conditions for a job the public may see / apply to: published and not past its expiry date."""
    return (Job.status == JobStatus.PUBLISHED, or_(Job.expires_at.is_(None), Job.expires_at > func.now()))


# Candidate's level -> every requirement up to it ("jobs I can do with N3" = none, N5, N4, N3).
_LEVELS = list(JapaneseLevel)
FEATURES = ("dormitory", "no_experience", "transport_paid", "english_ok")


@router.get("/jobs", response_model=list[JobListItem])
def list_jobs(
    db: DB,
    prefecture_id: Annotated[int | None, Query(ge=1, le=47)] = None,
    region: Annotated[str | None, Query(pattern=r"^[a-z]{2,20}$")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    stmt = select(Job).where(*live_job())
    if prefecture_id is not None:
        stmt = stmt.where(Job.prefecture_id == prefecture_id)
    elif region:
        stmt = stmt.where(
            Job.prefecture_id.in_(select(Prefecture.id).join(Region).where(Region.code == region))
        )
    if q and (term := q.strip()):
        # Matches the title in any language (JSONB as text); backed by a pg_trgm GIN index.
        stmt = stmt.where(Job.title.cast(Text).ilike(f"%{_escape_like(term)}%", escape="\\"))
    stmt = stmt.order_by(Job.published_at.desc()).limit(limit)
    return db.scalars(stmt).all()


@router.get("/jobs/search", response_model=PublicPage[JobListItem])
def search_jobs(
    db: DB, response: Response,
    prefecture_id: Annotated[int | None, Query(ge=1, le=47)] = None,
    region: Annotated[str | None, Query(pattern=r"^[a-z]{2,20}$")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    level: Annotated[JapaneseLevel | None, Query(description="candidate's level: jobs requiring at most this")] = None,
    visa: Annotated[str | None, Query(pattern=r"^[a-z0-9_]{2,50}$", description="visa type code")] = None,
    min_hourly: Annotated[int | None, Query(ge=0, le=10_000)] = None,
    employment: EmploymentType | None = None,
    features: Annotated[list[str] | None, Query(max_length=4)] = None,
    sort: Literal["new", "salary"] = "new",
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 20,
):
    """Paginated public search with every filter of the jobs page. Unknown feature tags are ignored."""
    stmt = select(Job).where(*live_job())
    if prefecture_id is not None:
        stmt = stmt.where(Job.prefecture_id == prefecture_id)
    elif region:
        stmt = stmt.where(Job.prefecture_id.in_(select(Prefecture.id).join(Region).where(Region.code == region)))
    if q and (term := q.strip()):
        stmt = stmt.where(Job.title.cast(Text).ilike(f"%{_escape_like(term)}%", escape="\\"))
    if level is not None:
        stmt = stmt.where(Job.japanese_level_required.in_(_LEVELS[: _LEVELS.index(level) + 1]))
    if visa:
        stmt = stmt.where(Job.id.in_(
            select(JobVisaType.job_id).join(VisaType, VisaType.id == JobVisaType.visa_type_id).where(VisaType.code == visa)))
    if min_hourly is not None:
        stmt = stmt.where(Job.salary_type == SalaryType.HOURLY,
                          func.coalesce(Job.salary_max, Job.salary_min) >= min_hourly)
    if employment is not None:
        stmt = stmt.where(Job.employment_type == employment)
    wanted = [f for f in (features or []) if f in FEATURES]
    if wanted:
        stmt = stmt.where(Job.features.contains(wanted))  # features @> ARRAY[...] (GIN index)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    order = ((func.coalesce(Job.salary_max, Job.salary_min).desc(), Job.published_at.desc()) if sort == "salary"
             else (Job.published_at.desc(),))
    rows = db.scalars(stmt.order_by(*order, Job.id).offset((page - 1) * page_size).limit(page_size)).all()
    response.headers["Cache-Control"] = "public, max-age=30"
    return PublicPage[JobListItem](items=[JobListItem.model_validate(j) for j in rows],
                                   total=total, page=page, page_size=page_size)


@router.get("/stats/jobs-by-prefecture")
def jobs_by_prefecture(db: DB, response: Response):
    """Published job count per prefecture, for the map badges. Shared/CDN cacheable for 60s."""
    rows = db.execute(
        select(Job.prefecture_id, func.count())
        .where(*live_job())
        .group_by(Job.prefecture_id)
    ).all()
    counts = {str(pid): n for pid, n in rows}
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return {"counts": counts, "total": sum(counts.values())}


@router.get("/visa-types", response_model=list[VisaTypeRead])
def visa_types(db: DB, response: Response):
    response.headers["Cache-Control"] = "public, max-age=3600"
    return db.scalars(select(VisaType).order_by(VisaType.sort_order)).all()


@router.get("/jobs/{ref}", response_model=JobPublic)
def get_job(ref: str, db: DB):
    """`ref` is a UUID or the human job code. Only published jobs are visible.

    The end-client relation is never loaded here (lazy='raise' + JobPublic has no such field).
    """
    cond = Job.job_code == ref
    try:
        cond = Job.id == uuid.UUID(ref)
    except ValueError:
        pass
    job = db.scalar(
        select(Job).options(selectinload(Job.visa_types)).where(cond, *live_job())
    )
    if job is None:
        raise HTTPException(status_code=404, detail={"code": "job_not_found"})
    return job


@router.get("/jobs/{ref}/similar", response_model=list[JobListItem])
def similar_jobs(ref: str, db: DB, response: Response, limit: Annotated[int, Query(ge=1, le=12)] = 4):
    """Other live jobs near this one: same prefecture first, then same region; newest first.

    Unknown / hidden job -> empty list (not 404), so the detail page never breaks because of it.
    """
    cond = Job.job_code == ref
    try:
        cond = Job.id == uuid.UUID(ref)
    except ValueError:
        pass
    base = db.execute(select(Job.id, Job.prefecture_id).where(cond, *live_job())).first()
    response.headers["Cache-Control"] = "public, max-age=60"
    if base is None:
        return []
    region_prefs = select(Prefecture.id).where(
        Prefecture.region_id == select(Prefecture.region_id).where(Prefecture.id == base.prefecture_id).scalar_subquery())
    same_pref = (Job.prefecture_id == base.prefecture_id)
    return db.scalars(
        select(Job).where(*live_job(), Job.id != base.id, Job.prefecture_id.in_(region_prefs))
        .order_by(same_pref.desc(), Job.published_at.desc(), Job.id).limit(limit)
    ).all()


JST = timezone(timedelta(hours=9), "JST")  # Japan has no DST; avoids needing tzdata on Windows
VIEW_DEDUP_SECONDS = 30 * 60   # the same visitor (IP) re-opening a job within 30 min = one view
VIEW_IP_LIMIT = 300            # per IP per hour, across all jobs (bots / refresh loops stop counting)


@router.post("/jobs/{job_id}/views", status_code=status.HTTP_204_NO_CONTENT)
def record_view(job_id: uuid.UUID, request: Request, db: DB):
    """Count one detail-page view (called by the browser, so most crawlers that do not run JS are not counted).

    Stores only counters - no IP, cookie or user id is saved. Over-limit hits are silently ignored (still 204),
    so a script cannot tell whether it is being counted. CSRF-exempt on purpose: it changes no user data.
    """
    ip = client_ip(request)
    if limiter.hit(f"view:{ip}:{job_id}", 1, VIEW_DEDUP_SECONDS) or limiter.hit(f"view-ip:{ip}", VIEW_IP_LIMIT, 3600):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    done = db.execute(update(Job).where(Job.id == job_id, *live_job()).values(view_count=Job.view_count + 1))
    if done.rowcount == 0:
        raise HTTPException(404, detail={"code": "job_not_found"})
    today = datetime.now(JST).date()
    db.execute(insert(JobViewDaily).values(job_id=job_id, day=today, views=1).on_conflict_do_update(
        index_elements=[JobViewDaily.job_id, JobViewDaily.day], set_={"views": JobViewDaily.views + 1}))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ places / i18n / CMS (public, cacheable)
@router.get("/places")
def places(db: DB, response: Response):
    """Regions & prefectures with admin-edited names and map visibility."""
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return {
        "regions": [{"code": r.code, "name": r.name, "is_active": r.is_active, "sort_order": r.sort_order}
                    for r in db.scalars(select(Region).order_by(Region.sort_order, Region.id))],
        "prefectures": [{"id": p.id, "name": p.name, "is_active": p.is_active}
                        for p in db.scalars(select(Prefecture).order_by(Prefecture.id))],
    }


@router.get("/i18n/{locale}")
def translation_overrides(locale: Annotated[str, Path(pattern=r"^(ja|en|vi|my|ne|bn)$")], db: DB, response: Response):
    """Admin overrides for UI strings: {"nav.jobs": "..."} merged over the bundled messages by the frontend."""
    response.headers["Cache-Control"] = "public, max-age=60"
    rows = db.execute(select(TranslationOverride.key, TranslationOverride.value)
                      .where(TranslationOverride.locale == locale)).all()
    return {k: v for k, v in rows}


@router.get("/cms/{key}")
def cms_block(key: Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9._-]{1,99}$")], db: DB, response: Response):
    row = db.scalar(select(CmsContent).where(CmsContent.key == key, CmsContent.is_published.is_(True)))
    if row is None:
        raise HTTPException(404, detail={"code": "not_found"})
    response.headers["Cache-Control"] = "public, max-age=60"
    return {"key": row.key, "content": row.content, "extra": row.extra}
