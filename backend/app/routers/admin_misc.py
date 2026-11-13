"""Admin: dashboard stats, places (regions/prefectures), UI translations, CMS blocks, staff users."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import delete, func, select, update

from app.db import DB
from app.models import (
    Application, ApplicationStatus, CmsContent, EmployerInquiry, Job, JobStatus, JobViewDaily, Prefecture, RefreshToken, Region, Role, RoleName,
    TranslationOverride, User,
)
from app.permissions import AdminAccess, CmsWriter, Perm, PlacesWriter, UsersManager, has, require
from app.routers.public import JST, live_job
from app.routers.public import _escape_like
from app.schemas import (
    AdminPage, CmsAdminRead, CmsContentUpsert, PlacesAdmin, PlaceUpdate, PrefectureAdmin, RegionAdmin,
    TranslationIn, TranslationOut, UserAdminRead, UserAdminUpdate,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ------------------------------------------------------------------ dashboard
@router.get("/stats")
def stats(user: AdminAccess, db: DB):
    out: dict[str, int] = {}
    if has(user, Perm.JOBS_READ):
        own = [] if has(user, Perm.JOBS_ALL) else [Job.created_by == user.id]
        for s in JobStatus:
            out[f"jobs_{s.value}"] = db.scalar(select(func.count()).select_from(Job).where(Job.status == s, *own)) or 0
    if has(user, Perm.APPS_READ):
        scope = [] if has(user, Perm.APPS_ALL) else [Job.created_by == user.id]
        base = select(func.count()).select_from(Application).join(Job, Job.id == Application.job_id)
        out["applications_new"] = db.scalar(base.where(Application.status == ApplicationStatus.APPLIED, *scope)) or 0
        out["applications_7d"] = db.scalar(base.where(
            Application.created_at >= datetime.now(timezone.utc) - timedelta(days=7), *scope)) or 0
    if has(user, Perm.INQUIRIES_MANAGE):
        out["inquiries_new"] = db.scalar(
            select(func.count()).select_from(EmployerInquiry).where(EmployerInquiry.status == "new")) or 0
    return out


# ------------------------------------------------------------------ analytics (アクセス・応募分析)
@router.get("/analytics")
def analytics(user: Annotated[User, Depends(require(Perm.JOBS_READ, Perm.APPS_READ))], db: DB, response: Response,
              weeks: Annotated[int, Query(ge=4, le=26)] = 12):
    """Weekly applications / job views / sign-ups, application status mix, most-viewed jobs, top prefectures.

    Same row-level scope as the rest of admin: a client recruiter sees only their own jobs; sign-ups (a
    company-wide number) only for roles with applications.all. Weeks start on Monday, Japan time.
    """
    response.headers["Cache-Control"] = "no-store"
    own_jobs = [] if has(user, Perm.JOBS_ALL) else [Job.created_by == user.id]
    own_apps = [] if has(user, Perm.APPS_ALL) else [Job.created_by == user.id]
    today = datetime.now(JST).date()
    first = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks - 1)
    since = datetime.combine(first, datetime.min.time(), JST)
    d30 = today - timedelta(days=29)

    app_week = func.date_trunc("week", func.timezone("Asia/Tokyo", Application.created_at))
    apps_by_week = {r[0].date(): r[1] for r in db.execute(
        select(app_week, func.count()).select_from(Application).join(Job, Job.id == Application.job_id)
        .where(Application.created_at >= since, *own_apps).group_by(app_week))}
    view_week = func.date_trunc("week", JobViewDaily.day)
    views_by_week = {r[0].date(): int(r[1]) for r in db.execute(
        select(view_week, func.sum(JobViewDaily.views)).join(Job, Job.id == JobViewDaily.job_id)
        .where(JobViewDaily.day >= first, *own_jobs).group_by(view_week))}
    show_signups = has(user, Perm.APPS_ALL)
    signups_by_week: dict[date, int] = {}
    if show_signups:
        cand_role = select(Role.id).where(Role.name == RoleName.CANDIDATE).scalar_subquery()
        u_week = func.date_trunc("week", func.timezone("Asia/Tokyo", User.created_at))
        signups_by_week = {r[0].date(): r[1] for r in db.execute(
            select(u_week, func.count()).select_from(User).where(User.role_id == cand_role, User.created_at >= since)
            .group_by(u_week))}
    week_list = [first + timedelta(weeks=i) for i in range(weeks)]

    views_30 = func.coalesce(func.sum(JobViewDaily.views).filter(JobViewDaily.day >= d30), 0)
    since30 = datetime.combine(d30, datetime.min.time(), JST)
    app_30 = (select(func.count()).select_from(Application)
              .where(Application.job_id == Job.id,
                     Application.created_at >= since30)
              .correlate(Job).scalar_subquery())
    top = db.execute(
        select(Job.id, Job.job_code, Job.title_ja, Job.status, Job.view_count, views_30.label("v30"), app_30.label("a30"))
        .outerjoin(JobViewDaily, JobViewDaily.job_id == Job.id).where(*own_jobs)
        .group_by(Job.id).order_by(views_30.desc(), Job.view_count.desc(), Job.published_at.desc().nulls_last())
        .limit(10)).all()

    status_counts = dict(db.execute(
        select(Application.status, func.count()).join(Job, Job.id == Application.job_id).where(*own_apps)
        .group_by(Application.status)).all())
    d90 = datetime.combine(today - timedelta(days=89), datetime.min.time(), JST)
    prefs = db.execute(
        select(Job.prefecture_id, func.count()).select_from(Application).join(Job, Job.id == Application.job_id)
        .where(Application.created_at >= d90, *own_apps).group_by(Job.prefecture_id)
        .order_by(func.count().desc(), Job.prefecture_id).limit(8)).all()

    views30_total = int(db.scalar(select(func.coalesce(func.sum(JobViewDaily.views), 0)).join(Job, Job.id == JobViewDaily.job_id)
                                  .where(JobViewDaily.day >= d30, *own_jobs)) or 0)
    apps30_total = db.scalar(select(func.count()).select_from(Application).join(Job, Job.id == Application.job_id)
                             .where(Application.created_at >= since30, *own_apps)) or 0
    return {
        "weeks": [{"start": w.isoformat(), "applications": apps_by_week.get(w, 0), "views": views_by_week.get(w, 0),
                   "signups": signups_by_week.get(w, 0) if show_signups else None} for w in week_list],
        "totals": {
            "views_30d": views30_total,
            "applications_30d": apps30_total,
            "live_jobs": db.scalar(select(func.count()).select_from(Job).where(*live_job(), *own_jobs)) or 0,
            "signups_30d": (db.scalar(select(func.count()).select_from(User).where(
                User.role_id == select(Role.id).where(Role.name == RoleName.CANDIDATE).scalar_subquery(),
                User.created_at >= since30)) or 0) if show_signups else None,
        },
        "status": {s.value: status_counts.get(s, 0) for s in ApplicationStatus},
        "top_jobs": [{"id": str(r.id), "job_code": r.job_code, "title": r.title_ja, "status": r.status.value,
                      "views_total": r.view_count, "views_30d": int(r.v30), "applications_30d": r.a30} for r in top],
        "prefectures": [{"id": pid, "applications": n} for pid, n in prefs],
    }


# ------------------------------------------------------------------ places
@router.get("/places", response_model=PlacesAdmin)
def places(user: PlacesWriter, db: DB):
    return PlacesAdmin(
        regions=[RegionAdmin.model_validate(r) for r in db.scalars(select(Region).order_by(Region.sort_order, Region.id))],
        prefectures=[PrefectureAdmin.model_validate(p) for p in db.scalars(select(Prefecture).order_by(Prefecture.id))],
    )


def _patch_place(obj, body: PlaceUpdate) -> None:
    if body.name is not None:
        obj.name = {k: v.strip() for k, v in body.name.items() if v and v.strip()}
    if body.is_active is not None:
        obj.is_active = body.is_active
    if body.sort_order is not None and hasattr(obj, "sort_order"):
        obj.sort_order = body.sort_order


def _get_or_404(db, model, pk):
    obj = db.get(model, pk)
    if obj is None:
        raise HTTPException(404, detail={"code": "not_found"})
    return obj


@router.patch("/regions/{region_id}", response_model=RegionAdmin)
def patch_region(region_id: int, body: PlaceUpdate, user: PlacesWriter, db: DB):
    r = _get_or_404(db, Region, region_id)
    _patch_place(r, body)
    db.commit()
    return r


@router.patch("/prefectures/{prefecture_id}", response_model=PrefectureAdmin)
def patch_prefecture(prefecture_id: int, body: PlaceUpdate, user: PlacesWriter, db: DB):
    p = _get_or_404(db, Prefecture, prefecture_id)
    _patch_place(p, body)
    db.commit()
    return p


# ------------------------------------------------------------------ UI translations (overrides)
@router.get("/translations", response_model=list[TranslationOut])
def list_translations(user: CmsWriter, db: DB):
    return db.scalars(select(TranslationOverride).order_by(TranslationOverride.key, TranslationOverride.locale)).all()


@router.put("/translations", response_model=TranslationOut)
def upsert_translation(body: TranslationIn, user: CmsWriter, db: DB):
    row = db.scalar(select(TranslationOverride).where(
        TranslationOverride.key == body.key, TranslationOverride.locale == body.locale))
    if row is None:
        row = TranslationOverride(key=body.key, locale=body.locale, value=body.value, updated_by=user.id)
        db.add(row)
    else:
        row.value, row.updated_by = body.value, user.id
    db.commit()
    db.refresh(row)
    return row


@router.delete("/translations", status_code=status.HTTP_204_NO_CONTENT)
def delete_translation(user: CmsWriter, db: DB, key: Annotated[str, Query(max_length=200)],
                       locale: Annotated[str, Query(pattern=r"^(ja|en|vi|my|ne|bn)$")]):
    db.execute(delete(TranslationOverride).where(TranslationOverride.key == key, TranslationOverride.locale == locale))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ CMS blocks
@router.get("/cms", response_model=list[CmsAdminRead])
def list_cms(user: CmsWriter, db: DB):
    return db.scalars(select(CmsContent).order_by(CmsContent.key)).all()


@router.put("/cms/{key}", response_model=CmsAdminRead)
def upsert_cms(key: Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9._-]{1,99}$")], body: CmsContentUpsert,
               user: CmsWriter, db: DB):
    row = db.scalar(select(CmsContent).where(CmsContent.key == key))
    if row is None:
        row = CmsContent(key=key, content=body.content)
        db.add(row)
    row.content, row.extra, row.is_published, row.updated_by = body.content, body.extra, body.is_published, user.id
    db.commit()
    db.refresh(row)
    return row


@router.delete("/cms/{key}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cms(key: str, user: CmsWriter, db: DB):
    db.execute(delete(CmsContent).where(CmsContent.key == key))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ users & roles
def _user_out(u: User) -> UserAdminRead:
    p = u.profile
    return UserAdminRead(id=u.id, email=u.email, role=u.role.name, is_active=u.is_active,
                         display_name=f"{p.last_name} {p.first_name}".strip() if p else None,
                         created_at=u.created_at, last_login_at=u.last_login_at)


@router.get("/users", response_model=AdminPage[UserAdminRead])
def list_users(
    user: UsersManager, db: DB,
    role: RoleName | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    stmt = select(User).join(Role, Role.id == User.role_id)
    if role:
        stmt = stmt.where(Role.name == role)
    if q and (term := q.strip()):
        stmt = stmt.where(User.email.ilike(f"%{_escape_like(term)}%", escape="\\"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return AdminPage[UserAdminRead](items=[_user_out(u) for u in rows], total=total, page=page, page_size=page_size)


@router.patch("/users/{user_id}", response_model=UserAdminRead)
def update_user(user_id: uuid.UUID, body: UserAdminUpdate, user: UsersManager, db: DB):
    if user_id == user.id:
        raise HTTPException(409, detail={"code": "cannot_modify_self"})  # no accidental self-lockout
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(404, detail={"code": "user_not_found"})
    if body.role is not None:
        target.role_id = db.scalar(select(Role.id).where(Role.name == body.role))
    if body.is_active is not None:
        target.is_active = body.is_active
    # Force a fresh login: refresh tokens die now; access tokens re-read the role from the DB on every request.
    db.execute(update(RefreshToken).where(RefreshToken.user_id == target.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=datetime.now(timezone.utc)))
    db.commit()
    db.refresh(target)
    return _user_out(target)
