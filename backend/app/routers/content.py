"""News (お知らせ) and the employer contact form (企業の方へ).

Public:  GET  /api/v1/news, GET /api/v1/news/{slug}, POST /api/v1/employers/inquiries
Admin:   /api/v1/admin/news        (cms.write: content_editor, super_admin)
         /api/v1/admin/inquiries   (inquiries.manage: recruiter_manager, super_admin)
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import Text, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app import mailer
from app.config import settings
from app.db import DB
from app.models import ContentStatus, EmailLog, EmployerInquiry, News, Prefecture
from app.permissions import CmsWriter, InquiriesManager
from app.ratelimit import enforce, rate_limit
from app.routers.public import _escape_like
from app.schemas import (
    AdminPage, ContactIn, EmployerInquiryAdmin, EmployerInquiryIn, EmployerInquiryUpdate, NewsAdminRead, NewsIn, NewsListItem,
    NewsRead, PublicPage,
)

router = APIRouter(prefix="/api/v1", tags=["content"])
admin_router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

Slug = Annotated[str, Path(pattern=r"^[a-z0-9-]{3,120}$")]


def _visible():
    """A post is public once published AND its publish time has come (a future date = scheduled)."""
    return (News.status == ContentStatus.PUBLISHED, News.published_at.is_not(None), News.published_at <= func.now())


# ====================================================================== public: news
@router.get("/news", response_model=PublicPage[NewsListItem])
def list_news(
    db: DB, response: Response,
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = 10,
):
    total = db.scalar(select(func.count()).select_from(News).where(*_visible())) or 0
    rows = db.scalars(select(News).where(*_visible()).order_by(News.published_at.desc(), News.id)
                      .offset((page - 1) * page_size).limit(page_size)).all()
    response.headers["Cache-Control"] = "public, max-age=60"
    return PublicPage[NewsListItem](items=[NewsListItem.model_validate(n) for n in rows],
                                    total=total, page=page, page_size=page_size)


@router.get("/news/{slug}", response_model=NewsRead)
def get_news(slug: Slug, db: DB, response: Response):
    n = db.scalar(select(News).where(News.slug == slug, *_visible()))
    if n is None:
        raise HTTPException(404, detail={"code": "news_not_found"})
    response.headers["Cache-Control"] = "public, max-age=60"
    return n


# ====================================================================== public: employer contact form
@router.post("/employers/inquiries", status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(rate_limit("employer_inquiry", 5, 3600))])
def create_inquiry(body: EmployerInquiryIn, background: BackgroundTasks, db: DB):
    if body.website:  # honeypot filled -> a bot. Same answer as success, nothing stored or sent.
        return {"ok": True}
    # Also per address: the auto-reply must not become a way to flood one mailbox from many IPs.
    enforce(f"employer_inquiry_email:{body.email.lower()}", 3, 24 * 3600)

    _store_and_notify(db, background, EmployerInquiry(
        kind="employer", company_name=body.company_name, contact_name=body.contact_name, email=str(body.email),
        phone=body.phone or None, prefecture_id=body.prefecture_id, headcount=body.headcount,
        message=body.message, locale=body.locale,
    ))
    return {"ok": True}


@router.post("/contact", status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(rate_limit("contact", 5, 3600))])
def create_contact(body: ContactIn, background: BackgroundTasks, db: DB):
    """/contact: same inbox, protections and auto-reply as the employer form."""
    if body.website:
        return {"ok": True}
    enforce(f"employer_inquiry_email:{body.email.lower()}", 3, 24 * 3600)
    _store_and_notify(db, background, EmployerInquiry(
        kind="general", contact_name=body.name, email=str(body.email), message=body.message, locale=body.locale,
    ))
    return {"ok": True}


def _store_and_notify(db, background: BackgroundTasks, inq: EmployerInquiry) -> None:
    db.add(inq)
    db.flush()
    pref = db.get(Prefecture, inq.prefecture_id) if inq.prefecture_id else None
    pref_name = (pref.name.get("ja") or pref.name.get("en")) if pref else None
    queued = [mailer.queue_mail(db, mailer.build_inquiry_notice(to, inq, pref_name), "employer_inquiry_notice")
              for to in settings.admin_notify_emails]
    loc, reply = mailer.build_inquiry_reply(inq.email, inq.locale, page="employers" if inq.kind == "employer" else "contact")
    queued.append(mailer.queue_mail(db, reply, "employer_inquiry_reply", loc))
    db.commit()
    for log_id, mail in queued:
        background.add_task(mailer.deliver, log_id, mail)


# ====================================================================== admin: news
def _clean(v: dict[str, str] | None) -> dict[str, str] | None:
    out = {k: s.strip() for k, s in (v or {}).items() if s and s.strip()}
    return out or None


def _apply(n: News, body: NewsIn) -> None:
    n.slug = body.slug
    n.title = _clean(body.title) or {}
    n.summary = _clean(body.summary)
    n.body = _clean(body.body) or {}
    n.status = body.status
    if body.status == ContentStatus.PUBLISHED:
        # DB clock (same one `_visible()` compares with), so "publish now" is visible at once.
        n.published_at = body.published_at or n.published_at or func.now()
    else:
        n.published_at = body.published_at


def _save_news(db, n: News) -> News:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, detail={"code": "slug_taken"}) from None
    db.refresh(n)
    return n


def _news_or_404(db, news_id: uuid.UUID) -> News:
    n = db.get(News, news_id)
    if n is None:
        raise HTTPException(404, detail={"code": "news_not_found"})
    return n


def _slug_free(db, slug: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(News.id).where(News.slug == slug)
    if exclude:
        stmt = stmt.where(News.id != exclude)
    if db.scalar(stmt):
        raise HTTPException(409, detail={"code": "slug_taken"})


@admin_router.get("/news", response_model=AdminPage[NewsAdminRead])
def admin_list_news(
    user: CmsWriter, db: DB,
    status_: Annotated[ContentStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    stmt = select(News)
    if status_:
        stmt = stmt.where(News.status == status_)
    if q and (term := q.strip()):
        like = f"%{_escape_like(term)}%"
        stmt = stmt.where(or_(News.slug.ilike(like, escape="\\"), News.title.cast(Text).ilike(like, escape="\\")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(News.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return AdminPage[NewsAdminRead](items=[NewsAdminRead.model_validate(n) for n in rows],
                                    total=total, page=page, page_size=page_size)


@admin_router.get("/news/{news_id}", response_model=NewsAdminRead)
def admin_get_news(news_id: uuid.UUID, user: CmsWriter, db: DB):
    return _news_or_404(db, news_id)


@admin_router.post("/news", response_model=NewsAdminRead, status_code=status.HTTP_201_CREATED)
def admin_create_news(body: NewsIn, user: CmsWriter, db: DB):
    _slug_free(db, body.slug)
    n = News(author_id=user.id)
    _apply(n, body)
    db.add(n)
    return _save_news(db, n)


@admin_router.put("/news/{news_id}", response_model=NewsAdminRead)
def admin_update_news(news_id: uuid.UUID, body: NewsIn, user: CmsWriter, db: DB):
    n = _news_or_404(db, news_id)
    _slug_free(db, body.slug, exclude=n.id)
    _apply(n, body)
    return _save_news(db, n)


@admin_router.delete("/news/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_news(news_id: uuid.UUID, user: CmsWriter, db: DB):
    db.delete(_news_or_404(db, news_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ====================================================================== admin: employer inquiries
def _inquiry_or_404(db, inquiry_id: uuid.UUID) -> EmployerInquiry:
    inq = db.get(EmployerInquiry, inquiry_id)
    if inq is None:
        raise HTTPException(404, detail={"code": "not_found"})
    return inq


@admin_router.get("/inquiries", response_model=AdminPage[EmployerInquiryAdmin])
def admin_list_inquiries(
    user: InquiriesManager, db: DB,
    status_: Annotated[str | None, Query(alias="status", pattern=r"^(new|contacted|closed)$")] = None,
    kind: Annotated[str | None, Query(pattern=r"^(employer|general)$")] = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    stmt = select(EmployerInquiry)
    if status_:
        stmt = stmt.where(EmployerInquiry.status == status_)
    if kind:
        stmt = stmt.where(EmployerInquiry.kind == kind)
    if q and (term := q.strip()):
        like = f"%{_escape_like(term)}%"
        stmt = stmt.where(or_(*(col.ilike(like, escape="\\") for col in (
            EmployerInquiry.company_name, EmployerInquiry.contact_name, EmployerInquiry.email))))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(EmployerInquiry.created_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return AdminPage[EmployerInquiryAdmin](items=[EmployerInquiryAdmin.model_validate(r) for r in rows],
                                           total=total, page=page, page_size=page_size)


@admin_router.patch("/inquiries/{inquiry_id}", response_model=EmployerInquiryAdmin)
def admin_update_inquiry(inquiry_id: uuid.UUID, body: EmployerInquiryUpdate, user: InquiriesManager, db: DB):
    inq = _inquiry_or_404(db, inquiry_id)
    if body.status is not None:
        inq.status = body.status
    if "admin_note" in body.model_fields_set:
        inq.admin_note = (body.admin_note or "").strip() or None
    db.commit()
    db.refresh(inq)
    return inq


@admin_router.delete("/inquiries/{inquiry_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_inquiry(inquiry_id: uuid.UUID, user: InquiriesManager, db: DB):
    """APPI: remove the lead and the address from the auto-reply log."""
    inq = _inquiry_or_404(db, inquiry_id)
    db.execute(update(EmailLog).where(EmailLog.to_email == inq.email,
                                      EmailLog.template == "employer_inquiry_reply").values(to_email="(deleted)"))
    db.execute(delete(EmployerInquiry).where(EmployerInquiry.id == inq.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
