"""Pydantic v2 schemas.

Security rule: ``JobPublic`` / ``JobListItem`` have NO end-client field, so even
a bug in a route cannot serialize it. Only ``JobAdmin`` carries it, and it must
be used exclusively behind an admin/owner RBAC dependency.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models import (
    SUPPORTED_LOCALES,
    ApplicationStatus,
    ContentStatus,
    EmploymentType,
    FileType,
    JapaneseLevel,
    JobStatus,
    RoleName,
    SalaryType,
    SocialProvider,
)


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- i18n
class I18nStr(dict[str, str]):  # pragma: no cover - typing helper only
    pass


def _validate_i18n(v: dict[str, str], *, required: bool = True) -> dict[str, str]:
    unknown = set(v) - set(SUPPORTED_LOCALES)
    if unknown:
        raise ValueError(f"unsupported locales: {sorted(unknown)}")
    if required and not v.get("ja", "").strip():
        raise ValueError("'ja' translation is required")
    if any(len(t) > 20000 for t in v.values()):
        raise ValueError("translation too long")
    return v


I18n = Annotated[dict[str, str], Field(description="locale -> text; 'ja' required")]


class I18nModel(BaseModel):
    """Mixin: validates every field annotated as I18n-named in `_i18n_required`."""

    _i18n_required: tuple[str, ...] = ()
    _i18n_optional: tuple[str, ...] = ()

    @model_validator(mode="after")
    def _check_i18n(self):  # type: ignore[no-untyped-def]
        for f in self._i18n_required:
            _validate_i18n(getattr(self, f), required=True)
        for f in self._i18n_optional:
            val = getattr(self, f)
            if val is not None:
                _validate_i18n(val, required=False)
        return self


def localize(value: dict[str, str] | None, locale: str, default: str = "ja") -> str | None:
    """Pick text for `locale`, falling back to Japanese."""
    if not value:
        return None
    return value.get(locale) or value.get(default) or next(iter(value.values()), None)


# ---------------------------------------------------------------- Roles / Users / Auth
class RoleRead(ORM):
    id: int
    name: RoleName


Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]


class UserRegister(BaseModel):
    email: EmailStr
    password: Password
    # Self-registration may only create candidates/recruiters, never admins (enforced in service too).
    role: RoleName = RoleName.CANDIDATE
    preferred_locale: str = "ja"

    @field_validator("role")
    @classmethod
    def _candidate_only(cls, v: RoleName) -> RoleName:
        if v != RoleName.CANDIDATE:
            raise ValueError("cannot self-register as admin")
        return v

    @field_validator("preferred_locale")
    @classmethod
    def _locale(cls, v: str) -> str:
        if v not in SUPPORTED_LOCALES:
            raise ValueError("unsupported locale")
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: Annotated[str, StringConstraints(min_length=1, max_length=128)]


class OAuthLogin(BaseModel):
    provider: SocialProvider
    id_token: Annotated[str, StringConstraints(min_length=10, max_length=4096)]


class SocialAccountRead(ORM):
    provider: SocialProvider
    provider_email: str | None


class UserRead(ORM):
    id: uuid.UUID
    email: EmailStr
    role: RoleRead
    preferred_locale: str
    is_email_verified: bool
    created_at: datetime
    social_accounts: list[SocialAccountRead] = []
    # NOTE: password_hash intentionally absent.


# ---------------------------------------------------------------- Regions / Prefectures
class RegionRead(ORM):
    id: int
    code: str
    name: dict[str, str]


class PrefectureRead(ORM):
    id: int
    code: str
    name: dict[str, str]
    region_id: int


class RegionWithPrefectures(RegionRead):
    prefectures: list[PrefectureRead]


class VisaTypeRead(ORM):
    id: int
    code: str
    name: dict[str, str]


# ---------------------------------------------------------------- Jobs
class JobBase(I18nModel):
    employment_type: EmploymentType = EmploymentType.HAKEN
    salary_type: SalaryType
    salary_min: Annotated[int, Field(gt=0, le=10_000_000)]
    salary_max: Annotated[int, Field(gt=0, le=10_000_000)] | None = None
    transport_fee_included: bool = False
    prefecture_id: Annotated[int, Field(ge=1, le=47)]
    city: dict[str, str] | None = None
    nearest_station: dict[str, str] | None = None
    work_shift: dict[str, str] | None = None
    work_hours_per_week: Annotated[int, Field(ge=1, le=80)] | None = None
    japanese_level_required: JapaneseLevel = JapaneseLevel.NONE
    features: list[Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]] = []
    visa_type_ids: list[int] = []

    @model_validator(mode="after")
    def _salary_range(self):  # type: ignore[no-untyped-def]
        if self.salary_max is not None and self.salary_max < self.salary_min:
            raise ValueError("salary_max must be >= salary_min")
        return self


class JobCreate(JobBase):
    title: I18n
    description: I18n
    end_client_name: Annotated[str, StringConstraints(min_length=1, max_length=255)]  # internal
    end_client_address: str | None = Field(default=None, max_length=500)
    internal_note: str | None = None
    _i18n_required = ("title", "description")
    _i18n_optional = ("city", "nearest_station", "work_shift")


class JobUpdate(BaseModel):
    """Partial update; status transitions are validated by the service layer."""

    title: dict[str, str] | None = None
    description: dict[str, str] | None = None
    salary_type: SalaryType | None = None
    salary_min: Annotated[int, Field(gt=0)] | None = None
    salary_max: int | None = None
    prefecture_id: Annotated[int, Field(ge=1, le=47)] | None = None
    japanese_level_required: JapaneseLevel | None = None
    visa_type_ids: list[int] | None = None
    status: JobStatus | None = None
    end_client_name: str | None = Field(default=None, max_length=255)


class JobListItem(ORM):
    """Card on list/search pages. No end-client info."""

    id: uuid.UUID
    job_code: str
    title: dict[str, str]
    employment_type: EmploymentType
    salary_type: SalaryType
    salary_min: int
    salary_max: int | None
    prefecture: PrefectureRead
    japanese_level_required: JapaneseLevel
    features: list[str]
    published_at: datetime | None
    # extra card details (station line, monthly estimate)
    nearest_station: dict[str, str] | None = None
    work_hours_per_week: int | None = None
    transport_fee_included: bool = False


class JobPublic(JobListItem):
    description: dict[str, str]
    city: dict[str, str] | None
    work_shift: dict[str, str] | None
    # public application deadline (the job disappears after it)
    expires_at: datetime | None = None
    visa_types: list[VisaTypeRead]
    # Public company line for Haken jobs (never the real end-client; checked by the admin API).
    client_display_name: dict[str, str] | None = None


class JobAdmin(JobPublic):
    """ONLY for admin / owning recruiter endpoints."""

    status: JobStatus
    expires_at: datetime | None
    created_by: uuid.UUID
    end_client_name: str
    end_client_address: str | None = None
    internal_note: str | None = None


class JobSearchParams(BaseModel):
    """Query params for GET /jobs. Every filter maps to an index in models.Job."""

    prefecture_ids: list[Annotated[int, Field(ge=1, le=47)]] = Field(default=[], max_length=47)
    region_code: str | None = Field(default=None, max_length=20)
    salary_type: SalaryType | None = None
    salary_min: Annotated[int, Field(ge=0)] | None = None
    japanese_level_max: JapaneseLevel | None = None  # "jobs I can do with my level"
    visa_type_id: int | None = None
    features: list[str] = Field(default=[], max_length=10)
    q: Annotated[str, StringConstraints(max_length=100, strip_whitespace=True)] | None = None
    # Keyset pagination (stable & fast, unlike OFFSET)
    cursor_published_at: datetime | None = None
    cursor_id: uuid.UUID | None = None
    limit: Annotated[int, Field(ge=1, le=50)] = 20


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None


# ---------------------------------------------------------------- Candidate / Resume / Application
class CandidateProfileUpsert(BaseModel):
    first_name: Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]
    last_name: Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]
    first_name_kana: str | None = Field(default=None, max_length=100)
    last_name_kana: str | None = Field(default=None, max_length=100)
    birth_date: date | None = None
    nationality: Annotated[str, StringConstraints(pattern=r"^[A-Z]{2}$")] | None = None
    phone: Annotated[str, StringConstraints(pattern=r"^\+?[0-9\-]{8,20}$")] | None = None
    current_prefecture_id: Annotated[int, Field(ge=1, le=47)] | None = None
    japanese_level: JapaneseLevel = JapaneseLevel.NONE
    visa_type_id: int | None = None
    visa_expiry_date: date | None = None
    years_of_experience: Annotated[int, Field(ge=0, le=60)] = 0
    experience_summary: str | None = Field(default=None, max_length=5000)
    desired_prefecture_ids: list[Annotated[int, Field(ge=1, le=47)]] = Field(default=[], max_length=47)


class CandidateProfileRead(ORM, CandidateProfileUpsert):
    user_id: uuid.UUID
    visa_type: VisaTypeRead | None = None


class ResumeUploadRequest(BaseModel):
    """Step 1: client asks for a presigned PUT URL."""

    filename: Annotated[str, StringConstraints(min_length=1, max_length=255)]
    file_type: FileType
    file_size_bytes: Annotated[int, Field(gt=0, le=10 * 1024 * 1024)]


class ResumeUploadResponse(BaseModel):
    resume_id: uuid.UUID
    upload_url: str  # presigned PUT, short TTL (e.g. 5 min)
    expires_in: int


class ResumeRead(ORM):
    id: uuid.UUID
    original_filename: str
    file_type: FileType
    file_size_bytes: int
    is_default: bool
    uploaded_at: datetime
    # s3_key intentionally absent; download via /resumes/{id}/download-url (presigned GET).


class ApplicationCreate(BaseModel):
    job_id: uuid.UUID
    resume_id: uuid.UUID | None = None
    cover_message: str | None = Field(default=None, max_length=3000)


class ApplicationStatusUpdate(BaseModel):
    status: ApplicationStatus
    recruiter_note: str | None = Field(default=None, max_length=3000)


class ApplicationRead(ORM):
    """Candidate-facing view (no recruiter_note, job is the public shape)."""

    id: uuid.UUID
    status: ApplicationStatus
    job: JobListItem
    created_at: datetime
    status_changed_at: datetime


class ApplicationRecruiterRead(ORM):
    id: uuid.UUID
    job_id: uuid.UUID
    candidate_id: uuid.UUID
    resume_id: uuid.UUID | None
    status: ApplicationStatus
    cover_message: str | None
    recruiter_note: str | None
    created_at: datetime


# ---------------------------------------------------------------- News / CMS
class NewsCreate(I18nModel):
    slug: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{3,120}$")]
    title: I18n
    summary: dict[str, str] | None = None
    body: I18n
    status: ContentStatus = ContentStatus.DRAFT
    _i18n_required = ("title", "body")
    _i18n_optional = ("summary",)


class NewsIn(NewsCreate):
    """Admin create/update. `published_at` empty + status=published -> now; a future date schedules the post."""

    published_at: datetime | None = None


class NewsListItem(ORM):
    slug: str
    title: dict[str, str]
    summary: dict[str, str] | None
    published_at: datetime | None


class NewsRead(ORM):
    id: uuid.UUID
    slug: str
    title: dict[str, str]
    summary: dict[str, str] | None
    body: dict[str, str]
    published_at: datetime | None


class NewsAdminRead(NewsRead):
    status: ContentStatus
    created_at: datetime
    updated_at: datetime


class PublicPage[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------------------------------------------------------------- employer contact form (/employers)
InquiryStatusName = Annotated[str, StringConstraints(pattern=r"^(new|contacted|closed)$")]


class EmployerInquiryIn(BaseModel):
    company_name: Annotated[str, StringConstraints(min_length=1, max_length=200, strip_whitespace=True)]
    contact_name: Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]
    email: EmailStr
    phone: Annotated[str | None, StringConstraints(max_length=30, pattern=r"^[0-9+()\- ]*$", strip_whitespace=True)] = None
    prefecture_id: Annotated[int | None, Field(ge=1, le=47)] = None
    headcount: Annotated[int | None, Field(ge=1, le=100000)] = None
    message: Annotated[str, StringConstraints(min_length=1, max_length=2000, strip_whitespace=True)]
    locale: str = "ja"
    website: Annotated[str, StringConstraints(max_length=200)] = ""  # honeypot: humans never see/fill it
    agree: bool  # consent to the privacy policy (APPI)

    @field_validator("locale")
    @classmethod
    def _locale(cls, v: str) -> str:
        return v if v in SUPPORTED_LOCALES else "ja"

    @field_validator("agree")
    @classmethod
    def _agreed(cls, v: bool) -> bool:
        if not v:
            raise ValueError("consent is required")
        return v


class ContactIn(BaseModel):
    """/contact: general questions from anyone (job seekers, partners...)."""

    name: Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]
    email: EmailStr
    message: Annotated[str, StringConstraints(min_length=1, max_length=2000, strip_whitespace=True)]
    locale: str = "ja"
    website: Annotated[str, StringConstraints(max_length=200)] = ""  # honeypot
    agree: bool

    @field_validator("locale")
    @classmethod
    def _locale(cls, v: str) -> str:
        return v if v in SUPPORTED_LOCALES else "ja"

    @field_validator("agree")
    @classmethod
    def _agreed(cls, v: bool) -> bool:
        if not v:
            raise ValueError("consent is required")
        return v


class EmployerInquiryAdmin(ORM):
    id: uuid.UUID
    kind: str
    company_name: str | None
    contact_name: str
    email: str
    phone: str | None
    prefecture_id: int | None
    headcount: int | None
    message: str
    locale: str
    status: str
    admin_note: str | None
    created_at: datetime
    updated_at: datetime


class EmployerInquiryUpdate(BaseModel):
    status: InquiryStatusName | None = None
    admin_note: Annotated[str | None, StringConstraints(max_length=2000)] = None


class CmsContentUpsert(I18nModel):
    content: I18n
    extra: dict | None = None
    is_published: bool = True
    _i18n_required = ("content",)


class CmsContentRead(ORM):
    key: str
    content: dict[str, str]
    extra: dict | None


# ---------------------------------------------------------------- Phase 4: candidate auth & portal
Name = Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]


class CandidateRegister(BaseModel):
    """Public sign-up always creates a *candidate*; role is not client-selectable."""

    email: EmailStr
    password: Password
    first_name: Name
    last_name: Name
    preferred_locale: str = "ja"

    @field_validator("preferred_locale")
    @classmethod
    def _locale(cls, v: str) -> str:
        return v if v in SUPPORTED_LOCALES else "ja"

    @model_validator(mode="after")
    def _pw_not_email(self):  # type: ignore[no-untyped-def]
        if self.password.lower() == str(self.email).lower():
            raise ValueError("password must not equal email")
        return self


class MeOut(BaseModel):
    id: uuid.UUID
    email: str
    role: RoleName
    preferred_locale: str
    display_name: str | None
    profile_complete: bool
    providers: list[SocialProvider]
    permissions: list[str] = []
    email_verified: bool = False
    has_password: bool = True  # False for OAuth-only accounts (they "set" a password, no current one)


# ---------------------------------------------------------------- account & email (ps.txt part 1 A)
Token = Annotated[str, StringConstraints(min_length=10, max_length=200, strip_whitespace=True)]
OptionalSecret = Annotated[str | None, StringConstraints(max_length=128)]


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: Token
    new_password: Password


class TokenIn(BaseModel):
    token: Token


class ConfirmEmailOut(BaseModel):
    purpose: str  # verify_email | change_email
    email: str


class ChangePasswordIn(BaseModel):
    current_password: OptionalSecret = None  # required when the account already has a password
    new_password: Password


class ChangeEmailIn(BaseModel):
    new_email: EmailStr
    current_password: OptionalSecret = None


class DeleteAccountIn(BaseModel):
    password: OptionalSecret = None  # accounts with a password
    confirm_email: Annotated[str | None, StringConstraints(max_length=320)] = None  # OAuth-only accounts


class ApplicationCreated(BaseModel):
    id: uuid.UUID
    status: ApplicationStatus


# ---------------------------------------------------------------- Phase 5: admin
class AdminPage[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


class AdminJobIn(JobCreate):
    """Create/update payload. `end_client_name` is the real company (internal); `client_display_name` is
    what the public sees for Haken jobs (e.g. 'Major auto-parts maker'). The API rejects a display name that
    contains the real company name."""

    client_display_name: dict[str, str] | None = None
    expires_at: datetime | None = None
    _i18n_optional = ("city", "nearest_station", "work_shift", "client_display_name")


class JobTransitionIn(BaseModel):
    to: JobStatus
    note: str | None = Field(default=None, max_length=1000)


class AdminJobListItem(ORM):
    id: uuid.UUID
    job_code: str
    title: dict[str, str]
    status: JobStatus
    prefecture_id: int
    employment_type: EmploymentType
    salary_type: SalaryType
    salary_min: int
    salary_max: int | None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None
    created_by: uuid.UUID
    applications_count: int = 0
    view_count: int = 0  # all-time detail-page views


class AdminJobOut(ORM):
    id: uuid.UUID
    job_code: str
    status: JobStatus
    title: dict[str, str]
    description: dict[str, str]
    client_display_name: dict[str, str] | None
    employment_type: EmploymentType
    salary_type: SalaryType
    salary_min: int
    salary_max: int | None
    transport_fee_included: bool
    prefecture_id: int
    city: dict[str, str] | None
    nearest_station: dict[str, str] | None
    work_shift: dict[str, str] | None
    work_hours_per_week: int | None
    japanese_level_required: JapaneseLevel
    features: list[str]
    visa_type_ids: list[int]
    review_note: str | None
    expires_at: datetime | None
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID
    # internal (present only for callers with jobs.view_end_client)
    end_client_name: str | None = None
    end_client_address: str | None = None
    internal_note: str | None = None


class AdminCandidate(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    nationality: str | None = None
    japanese_level: JapaneseLevel = JapaneseLevel.NONE


class AdminApplicationListItem(BaseModel):
    id: uuid.UUID
    status: ApplicationStatus
    created_at: datetime
    status_changed_at: datetime
    job_id: uuid.UUID
    job_code: str
    job_title: dict[str, str]
    candidate: AdminCandidate
    has_resume: bool


class EmailLogRead(ORM):
    template: str
    status: str
    created_at: datetime
    sent_at: datetime | None


class StatusHistoryRead(BaseModel):
    from_status: str | None
    to_status: str
    changed_by: str | None  # email of the staff member / candidate, None if the account is gone
    created_at: datetime


class ResumeAccessRead(BaseModel):
    accessed_by: str | None  # email, None if the account is gone
    role: str
    inline: bool
    created_at: datetime


class AdminApplicationDetail(AdminApplicationListItem):
    cover_message: str | None
    recruiter_note: str | None
    profile: CandidateProfileRead | None
    resume: ResumeRead | None
    emails: list[EmailLogRead]
    history: list[StatusHistoryRead] = []
    # Who opened this CV. Only for staff who see all applications (managers / super admin): an audit tool.
    resume_access: list[ResumeAccessRead] | None = None


class AdminStatusIn(BaseModel):
    status: ApplicationStatus
    recruiter_note: str | None = Field(default=None, max_length=3000)
    notify: bool = True  # send the candidate an email about the change


class RegionAdmin(ORM):
    id: int
    code: str
    name: dict[str, str]
    sort_order: int
    is_active: bool


class PrefectureAdmin(ORM):
    id: int
    code: str
    region_id: int
    name: dict[str, str]
    is_active: bool


class PlacesAdmin(BaseModel):
    regions: list[RegionAdmin]
    prefectures: list[PrefectureAdmin]


class PlaceUpdate(I18nModel):
    name: dict[str, str] | None = None
    is_active: bool | None = None
    sort_order: Annotated[int, Field(ge=0, le=999)] | None = None
    _i18n_optional = ("name",)

    @model_validator(mode="after")
    def _ja_kept(self):  # type: ignore[no-untyped-def]
        if self.name is not None and not self.name.get("ja", "").strip():
            raise ValueError("'ja' name is required")
        return self


TranslationKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){1,5}$", max_length=200)]
Locale = Annotated[str, StringConstraints(pattern=r"^(ja|en|vi|my|ne|bn)$")]


class TranslationIn(BaseModel):
    key: TranslationKey
    locale: Locale
    value: Annotated[str, StringConstraints(min_length=1, max_length=2000)]


class TranslationOut(ORM):
    key: str
    locale: str
    value: str
    updated_at: datetime


class CmsAdminRead(ORM):
    key: str
    content: dict[str, str]
    extra: dict | None
    is_published: bool
    updated_at: datetime


class UserAdminRead(BaseModel):
    id: uuid.UUID
    email: str
    role: RoleName
    is_active: bool
    display_name: str | None
    created_at: datetime
    last_login_at: datetime | None


class UserAdminUpdate(BaseModel):
    role: RoleName | None = None
    is_active: bool | None = None
