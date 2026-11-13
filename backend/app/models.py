"""SQLAlchemy 2.0 models (PostgreSQL) for the Japan Haken recruitment site.

Design notes
------------
* i18n: short, structured text (names, titles, bodies) is stored as JSONB
  ``{"ja": "...", "en": "...", ...}``. ``ja`` is mandatory (default locale);
  readers fall back to ``ja`` when a locale is missing. One row per entity,
  no join explosion on list pages.
* Security: the real end-client name lives in its own table
  (``job_end_clients``). It can never leak through ``SELECT * FROM jobs`` or
  a careless ``Job`` serializer; only admin/internal code paths join it.
* Files (resumes) store only the S3 *key*; access is via presigned URLs.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

SUPPORTED_LOCALES: tuple[str, ...] = ("ja", "en", "vi", "my", "ne", "bn")
I18nText = dict[str, str]  # {"ja": "...", "en": "..."}


# --------------------------------------------------------------------------
# Enums (stored as native PG enums; values are lowercase strings)
# --------------------------------------------------------------------------
def _pg_enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class RoleName(str, enum.Enum):
    # Order matters: init_db seeds role ids 1..n in this order (existing DBs: see migrate_phase5.py).
    SUPER_ADMIN = "super_admin"  # was "admin" before Phase 5
    CANDIDATE = "candidate"
    RECRUITER = "recruiter"  # client-side recruiter: only their own jobs
    RECRUITER_MANAGER = "recruiter_manager"  # internal: all jobs & applications, approves postings
    CONTENT_EDITOR = "content_editor"  # internal: places, CMS, translations; never CVs/end-clients


class SocialProvider(str, enum.Enum):
    GOOGLE = "google"
    APPLE = "apple"


class JobStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING = "pending"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class SalaryType(str, enum.Enum):
    HOURLY = "hourly"
    MONTHLY = "monthly"


class EmploymentType(str, enum.Enum):
    HAKEN = "haken"  # 派遣
    PART_TIME = "part_time"  # アルバイト/パート
    FULL_TIME = "full_time"  # 正社員
    CONTRACT = "contract"  # 契約社員


class JapaneseLevel(str, enum.Enum):
    NONE = "none"
    N5 = "n5"
    N4 = "n4"
    N3 = "n3"
    N2 = "n2"
    N1 = "n1"


class FileType(str, enum.Enum):
    PDF = "pdf"
    DOC = "doc"
    DOCX = "docx"


class ApplicationStatus(str, enum.Enum):
    APPLIED = "applied"
    REVIEWING = "reviewing"
    INTERVIEW = "interview"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ContentStatus(str, enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


# --------------------------------------------------------------------------
# Base & mixins
# --------------------------------------------------------------------------
class Base(DeclarativeBase):
    # Deterministic names for constraints we don't name by hand, identical to PostgreSQL's own defaults
    # (so DBs created before Alembic match). Alembic migrations can then reference them reliably.
    # No "ck" entry on purpose: every CheckConstraint here already has an explicit name.
    metadata = MetaData(naming_convention={
        "pk": "%(table_name)s_pkey",
        "uq": "%(table_name)s_%(column_0_N_name)s_key",
        "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
        "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    })


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )


# --------------------------------------------------------------------------
# 1. Users & Auth
# --------------------------------------------------------------------------
class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[RoleName] = mapped_column(
        _pg_enum(RoleName, "role_name"), unique=True, nullable=False
    )
    description: Mapped[str | None] = mapped_column(String(255))

    users: Mapped[list[User]] = relationship(back_populates="role")


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # NULL for users who only sign in through OAuth. Store an argon2/bcrypt hash only.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False
    )
    preferred_locale: Mapped[str] = mapped_column(
        String(5), default="ja", server_default="ja", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    is_email_verified: Mapped[bool] = mapped_column(
        default=False, server_default=text("false")
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Bumped on password change/reset: every access token carries it ("tv"), so older tokens die at once.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)

    role: Mapped[Role] = relationship(back_populates="users", lazy="joined")
    social_accounts: Mapped[list[SocialAccount]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    profile: Mapped[CandidateProfile | None] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Case-insensitive uniqueness ("A@x.com" == "a@x.com")
        Index("uq_users_email_lower", func.lower(email), unique=True),
        CheckConstraint(
            "preferred_locale IN ('ja','en','vi','my','ne','bn')",
            name="ck_users_locale",
        ),
    )


class SocialAccount(TimestampMixin, Base):
    __tablename__ = "social_accounts"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[SocialProvider] = mapped_column(
        _pg_enum(SocialProvider, "social_provider"), nullable=False
    )
    provider_user_id: Mapped[str] = mapped_column(String(255), nullable=False)  # OIDC `sub`
    provider_email: Mapped[str | None] = mapped_column(String(320))

    user: Mapped[User] = relationship(back_populates="social_accounts")

    __table_args__ = (
        UniqueConstraint("provider", "provider_user_id", name="uq_social_provider_sub"),
        UniqueConstraint("user_id", "provider", name="uq_social_user_provider"),
    )


# --------------------------------------------------------------------------
# 2. Regions & Prefectures (Haken map)
# --------------------------------------------------------------------------
class Region(Base):
    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # "kanto"
    name: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))  # shown on the map

    prefectures: Mapped[list[Prefecture]] = relationship(
        back_populates="region", order_by="Prefecture.id"
    )


class Prefecture(Base):
    __tablename__ = "prefectures"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)  # JIS X 0401: 1..47
    region_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)  # "tokyo" (URL slug)
    name: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))  # shown on map/search

    region: Mapped[Region] = relationship(back_populates="prefectures", lazy="joined")

    __table_args__ = (
        CheckConstraint("id BETWEEN 1 AND 47", name="ck_prefectures_jis"),
        Index("ix_prefectures_region_id", "region_id"),
    )


# --------------------------------------------------------------------------
# 3. Jobs (Haken)
# --------------------------------------------------------------------------
class VisaType(Base):
    """Lookup table so visa types can be added without a migration of enums."""

    __tablename__ = "visa_types"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")


class JobVisaType(Base):
    __tablename__ = "job_visa_types"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    visa_type_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("visa_types.id", ondelete="CASCADE"), primary_key=True
    )

    # Reverse lookup: "jobs that accept visa X"
    __table_args__ = (Index("ix_job_visa_types_visa", "visa_type_id", "job_id"),)


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # Human-facing job code, e.g. "HK-2026-000123" (generated by the service layer)
    job_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)

    title: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    description: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    # Stored generated column: fast trigram search on the JA title
    # (Japanese has no word boundaries, so FTS tokenizers are unreliable; pg_trgm works).
    title_ja: Mapped[str] = mapped_column(
        Text, Computed("title ->> 'ja'", persisted=True)
    )
    # Public "company" line for Haken jobs, e.g. {"ja": "大手自動車部品メーカー"}. Never the real end-client
    # (enforced in the admin API). NULL -> the UI shows a generic "undisclosed" label.
    client_display_name: Mapped[I18nText | None] = mapped_column(JSONB)
    # Reviewer feedback when a pending job is sent back to draft (internal only).
    review_note: Mapped[str | None] = mapped_column(Text)

    employment_type: Mapped[EmploymentType] = mapped_column(
        _pg_enum(EmploymentType, "employment_type"),
        default=EmploymentType.HAKEN,
        server_default=EmploymentType.HAKEN.value,
        nullable=False,
    )

    # Salary (JPY). Hourly: e.g. 1500-1800. Monthly: e.g. 250000-300000.
    salary_type: Mapped[SalaryType] = mapped_column(
        _pg_enum(SalaryType, "salary_type"), nullable=False
    )
    salary_min: Mapped[int] = mapped_column(Integer, nullable=False)
    salary_max: Mapped[int | None] = mapped_column(Integer)
    transport_fee_included: Mapped[bool] = mapped_column(
        default=False, server_default=text("false")
    )

    prefecture_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("prefectures.id", ondelete="RESTRICT"), nullable=False
    )
    city: Mapped[I18nText | None] = mapped_column(JSONB)  # 市区町村, optional detail
    nearest_station: Mapped[I18nText | None] = mapped_column(JSONB)

    work_shift: Mapped[I18nText | None] = mapped_column(JSONB)  # "Day / Night / 2-shift"
    work_hours_per_week: Mapped[int | None] = mapped_column(SmallInteger)

    japanese_level_required: Mapped[JapaneseLevel] = mapped_column(
        _pg_enum(JapaneseLevel, "japanese_level"),
        default=JapaneseLevel.NONE,
        server_default=JapaneseLevel.NONE.value,
        nullable=False,
    )
    # Convenience tags for icons/filters: ["dormitory", "no_experience", "transport_paid"]
    features: Mapped[list[str]] = mapped_column(
        ARRAY(String(40)), default=list, server_default=text("'{}'"), nullable=False
    )

    status: Mapped[JobStatus] = mapped_column(
        _pg_enum(JobStatus, "job_status"),
        default=JobStatus.DRAFT,
        server_default=JobStatus.DRAFT.value,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    view_count: Mapped[int] = mapped_column(
        BigInteger, default=0, server_default="0", nullable=False
    )

    prefecture: Mapped[Prefecture] = relationship(lazy="joined")
    visa_types: Mapped[list[VisaType]] = relationship(secondary="job_visa_types")
    # lazy="raise": accessing it without an explicit join/selectinload is a bug, not a leak.
    end_client: Mapped[JobEndClient | None] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan", lazy="raise"
    )
    applications: Mapped[list[Application]] = relationship(
        back_populates="job", lazy="raise"
    )

    __table_args__ = (
        CheckConstraint("salary_min > 0", name="ck_jobs_salary_min_pos"),
        CheckConstraint(
            "salary_max IS NULL OR salary_max >= salary_min", name="ck_jobs_salary_range"
        ),
        CheckConstraint("title ? 'ja'", name="ck_jobs_title_has_ja"),
        CheckConstraint("description ? 'ja'", name="ck_jobs_desc_has_ja"),
        # ---- Search indexes (see init_db.py for the extension prerequisites) ----
        # (1) THE hot path: "published jobs in prefecture X, newest first".
        #     Partial index -> only published rows, tiny and always hot in cache.
        Index(
            "ix_jobs_pub_pref_recent",
            "prefecture_id",
            text("published_at DESC"),
            postgresql_where=text("status = 'published'"),
        ),
        # (2) Prefecture + salary type + salary filter (range scans on salary_min).
        Index(
            "ix_jobs_pub_pref_salary",
            "prefecture_id",
            "salary_type",
            "salary_min",
            postgresql_where=text("status = 'published'"),
        ),
        # (3) National listing / "new jobs" without a location filter.
        Index(
            "ix_jobs_pub_recent",
            text("published_at DESC"),
            postgresql_where=text("status = 'published'"),
        ),
        # (4) Japanese level filter.
        Index(
            "ix_jobs_pub_level",
            "japanese_level_required",
            text("published_at DESC"),
            postgresql_where=text("status = 'published'"),
        ),
        # (5) Keyword search on the JA title (ILIKE '%foo%').
        Index(
            "ix_jobs_title_ja_trgm",
            "title_ja",
            postgresql_using="gin",
            postgresql_ops={"title_ja": "gin_trgm_ops"},
        ),
        # (5b) Keyword search across ALL languages: `title::text ILIKE '%warehouse%'`
        #      (used by GET /jobs?q=; foreign users type in their own language).
        Index(
            "ix_jobs_title_all_trgm",
            text("(title::text) gin_trgm_ops"),
            postgresql_using="gin",
        ),
        # (6) Feature tag filters: features @> ARRAY['dormitory'].
        Index("ix_jobs_features_gin", "features", postgresql_using="gin"),
        # (7) Admin / recruiter dashboards.
        Index("ix_jobs_status_created", "status", text("created_at DESC")),
        Index("ix_jobs_created_by", "created_by", "status"),
    )


class JobEndClient(TimestampMixin, Base):
    """Real client company behind a Haken job. INTERNAL ONLY (admin/recruiter owner).

    Kept in a separate table on purpose: public queries never touch it.
    """

    __tablename__ = "job_end_clients"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    end_client_name: Mapped[str] = mapped_column(String(255), nullable=False)
    end_client_address: Mapped[str | None] = mapped_column(String(500))
    internal_note: Mapped[str | None] = mapped_column(Text)

    job: Mapped[Job] = relationship(back_populates="end_client")


# --------------------------------------------------------------------------
# 4. Candidates, resumes, applications
# --------------------------------------------------------------------------
class CandidateProfile(TimestampMixin, Base):
    __tablename__ = "candidates_profile"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    first_name_kana: Mapped[str | None] = mapped_column(String(100))
    last_name_kana: Mapped[str | None] = mapped_column(String(100))
    birth_date: Mapped[date | None] = mapped_column(Date)
    nationality: Mapped[str | None] = mapped_column(String(2))  # ISO 3166-1 alpha-2
    phone: Mapped[str | None] = mapped_column(String(30))
    current_prefecture_id: Mapped[int | None] = mapped_column(
        SmallInteger, ForeignKey("prefectures.id", ondelete="SET NULL")
    )
    japanese_level: Mapped[JapaneseLevel] = mapped_column(
        _pg_enum(JapaneseLevel, "japanese_level"),
        default=JapaneseLevel.NONE,
        server_default=JapaneseLevel.NONE.value,
        nullable=False,
    )
    visa_type_id: Mapped[int | None] = mapped_column(
        SmallInteger, ForeignKey("visa_types.id", ondelete="SET NULL")
    )
    visa_expiry_date: Mapped[date | None] = mapped_column(Date)
    years_of_experience: Mapped[int] = mapped_column(
        SmallInteger, default=0, server_default="0", nullable=False
    )
    experience_summary: Mapped[str | None] = mapped_column(Text)
    desired_prefecture_ids: Mapped[list[int]] = mapped_column(
        ARRAY(SmallInteger), default=list, server_default=text("'{}'"), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="profile")
    visa_type: Mapped[VisaType | None] = relationship(lazy="joined")
    resumes: Mapped[list[Resume]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan",
        primaryjoin="CandidateProfile.user_id == Resume.candidate_id",
    )

    __table_args__ = (
        CheckConstraint("years_of_experience BETWEEN 0 AND 60", name="ck_cand_exp"),
        Index("ix_cand_japanese_level", "japanese_level"),
    )


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = _uuid_pk()
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates_profile.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    # Object key only (e.g. "resumes/<user_id>/<uuid>.pdf"). NEVER a public URL;
    # download through a short-lived presigned GET.
    s3_key: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[FileType] = mapped_column(_pg_enum(FileType, "file_type"), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    is_default: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    candidate: Mapped[CandidateProfile] = relationship(
        back_populates="resumes",
        primaryjoin="Resume.candidate_id == CandidateProfile.user_id",
    )

    __table_args__ = (
        CheckConstraint(
            # = app.files.MAX_RESUME_BYTES (5 MB): the DB never accepts more than the API does.
            "file_size_bytes > 0 AND file_size_bytes <= 5242880", name="ck_resume_size_5mb"
        ),
        Index("ix_resumes_candidate", "candidate_id", text("uploaded_at DESC")),
        # At most one default resume per candidate.
        Index(
            "uq_resumes_one_default",
            "candidate_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )


class Application(TimestampMixin, Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = _uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates_profile.user_id", ondelete="CASCADE"),
        nullable=False,
    )
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL")
    )
    status: Mapped[ApplicationStatus] = mapped_column(
        _pg_enum(ApplicationStatus, "application_status"),
        default=ApplicationStatus.APPLIED,
        server_default=ApplicationStatus.APPLIED.value,
        nullable=False,
    )
    cover_message: Mapped[str | None] = mapped_column(Text)
    recruiter_note: Mapped[str | None] = mapped_column(Text)  # internal, never exposed to candidate
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    job: Mapped[Job] = relationship(back_populates="applications", lazy="raise")

    __table_args__ = (
        UniqueConstraint("job_id", "candidate_id", name="uq_application_job_candidate"),
        Index("ix_app_candidate", "candidate_id", text("created_at DESC")),
        Index("ix_app_job_status", "job_id", "status"),
    )


# --------------------------------------------------------------------------
# 5. i18n content: News & CMS
# --------------------------------------------------------------------------
class News(TimestampMixin, Base):
    __tablename__ = "news"

    id: Mapped[uuid.UUID] = _uuid_pk()
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    title: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    summary: Mapped[I18nText | None] = mapped_column(JSONB)
    body: Mapped[I18nText] = mapped_column(JSONB, nullable=False)  # sanitized HTML/Markdown per locale
    cover_image_key: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[ContentStatus] = mapped_column(
        _pg_enum(ContentStatus, "content_status"),
        default=ContentStatus.DRAFT,
        server_default=ContentStatus.DRAFT.value,
        nullable=False,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("title ? 'ja'", name="ck_news_title_has_ja"),
        Index(
            "ix_news_pub_recent",
            text("published_at DESC"),
            postgresql_where=text("status = 'published'"),
        ),
    )


class CmsContent(TimestampMixin, Base):
    """Key/value blocks: 'home.hero', 'footer.about', 'terms', 'privacy' ..."""

    __tablename__ = "cms_contents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    content: Mapped[I18nText] = mapped_column(JSONB, nullable=False)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # images, CTA links...
    is_published: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (CheckConstraint("content ? 'ja'", name="ck_cms_has_ja"),)


class ApplicationStatusHistory(Base):
    """Every status an application went through, who set it and when (applied -> reviewing -> ...)."""

    __tablename__ = "application_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    application_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    changed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_app_status_history_app", "application_id", "created_at"),)


class ResumeAccessLog(Base):
    """Audit trail: a staff member opened a candidate's CV (owners viewing their own CV are not logged).

    Rows outlive the CV and the accounts (FKs SET NULL) so the trail survives deletions; the role is a snapshot.
    """

    __tablename__ = "resume_access_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    resume_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL")
    )
    candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    accessed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    accessed_by_role: Mapped[str] = mapped_column(String(30), nullable=False)
    inline: Mapped[bool] = mapped_column(default=False, nullable=False)
    ip: Mapped[str | None] = mapped_column(String(45))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_resume_access_resume", "resume_id", text("created_at DESC")),
        Index("ix_resume_access_by", "accessed_by", text("created_at DESC")),
    )


class SavedJob(Base):
    """A candidate's bookmarked job (お気に入り). Deleted with the user or the job."""

    __tablename__ = "saved_jobs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (Index("ix_saved_jobs_user_recent", "user_id", text("created_at DESC")),)


class JobViewDaily(Base):
    """Detail-page views per job per day (Asia/Tokyo calendar day). Only counts, no visitor data (APPI-friendly).
    Feeds the admin analytics page; jobs.view_count keeps the all-time total."""

    __tablename__ = "job_views_daily"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    views: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    __table_args__ = (Index("ix_job_views_daily_day", "day"),)


class InquiryStatus(str, enum.Enum):
    NEW = "new"
    CONTACTED = "contacted"
    CLOSED = "closed"


class EmployerInquiry(TimestampMixin, Base):
    """Contact forms: kind='employer' from /employers (a company that wants to hire; company_name required) or
    kind='general' from /contact (anyone). Internal: admin-only (inquiries.manage).

    Personal data (contact name, email, phone): delete rows once they are no longer needed (APPI).
    """

    __tablename__ = "employer_inquiries"

    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="employer", server_default="employer")
    company_name: Mapped[str | None] = mapped_column(String(200))
    contact_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    prefecture_id: Mapped[int | None] = mapped_column(SmallInteger, ForeignKey("prefectures.id", ondelete="SET NULL"))
    headcount: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="ja", server_default="ja")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", server_default="new")
    admin_note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("status IN ('new','contacted','closed')", name="ck_employer_inquiries_status"),
        CheckConstraint("kind IN ('employer','general')", name="ck_employer_inquiries_kind"),
        CheckConstraint("kind <> 'employer' OR company_name IS NOT NULL", name="ck_employer_inquiries_company"),
        CheckConstraint("headcount IS NULL OR headcount BETWEEN 1 AND 100000", name="ck_employer_inquiries_headcount"),
        Index("ix_employer_inquiries_created", text("created_at DESC")),
    )


# --------------------------------------------------------------------------
# 6. Sessions: refresh tokens (rotation + reuse detection)
# --------------------------------------------------------------------------
class RefreshToken(Base):
    """One row per issued refresh token. Only a SHA-256 hash is stored, never the token.

    Every refresh revokes the presented token and issues a new one in the same `family_id`.
    Presenting an already-revoked token means it was stolen and replayed -> the whole family
    (that login session on every device that shares it) is revoked.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_refresh_tokens_family", "family_id"),
        Index("ix_refresh_tokens_user", "user_id"),
    )


class TokenPurpose(str, enum.Enum):
    VERIFY_EMAIL = "verify_email"  # prove the account's email address
    RESET_PASSWORD = "reset_password"
    CHANGE_EMAIL = "change_email"  # confirm a new address before it replaces the old one


class UserToken(Base):
    """Single-use link sent by email. Only a SHA-256 hash is stored; the raw token exists only in the email.

    `email` is the address the link was sent to: for verify_email it must still equal users.email when
    the link is used (a stale link for an old address does nothing); for change_email it is the new address.
    """

    __tablename__ = "user_tokens"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_user_tokens_user_purpose", "user_id", "purpose"),
        CheckConstraint(
            "purpose IN ('verify_email','reset_password','change_email')", name="ck_user_tokens_purpose"
        ),
    )


# --------------------------------------------------------------------------
# 7. Admin: UI translation overrides & outbound email log
# --------------------------------------------------------------------------
class TranslationOverride(Base):
    """Admin-edited UI string, e.g. key="nav.jobs", locale="vi". Merged over the bundled JSON at runtime."""

    __tablename__ = "translation_overrides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("key", "locale", name="uq_translation_key_locale"),
        CheckConstraint("locale IN ('ja','en','vi','my','ne','bn')", name="ck_translation_locale"),
    )


class EmailStatus(str, enum.Enum):
    QUEUED = "queued"
    SENT = "sent"
    FAILED = "failed"


class EmailLog(Base):
    """Every notification we try to send (audit + retry source). Body is not stored (personal data)."""

    __tablename__ = "email_logs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    template: Mapped[str] = mapped_column(String(60), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False)
    subject: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[EmailStatus] = mapped_column(
        _pg_enum(EmailStatus, "email_status"), default=EmailStatus.QUEUED,
        server_default=EmailStatus.QUEUED.value, nullable=False,
    )
    error: Mapped[str | None] = mapped_column(String(500))
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("applications.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_email_logs_created", text("created_at DESC")),)


# Job codes: HK-<year>-<6 digits> from a DB sequence (no race between concurrent creates).
from sqlalchemy import Sequence  # noqa: E402

JOB_CODE_SEQ = Sequence("job_code_seq", start=1000, metadata=Base.metadata)
