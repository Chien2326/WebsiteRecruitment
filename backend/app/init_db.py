"""Bring a database to the current schema (Alembic) and load reference data. Safe to run repeatedly.

Usage:  python -m app.init_db            (DATABASE_URL from the environment or backend/.env)

1. `alembic upgrade head`  - the schema is owned by the migrations in backend/alembic/versions
2. seed reference data     - roles, regions, 47 prefectures, visa types (only what is missing)

Sample jobs are separate: python -m app.seed_data
"""

from __future__ import annotations

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app.envfile import BACKEND_DIR, database_url
from app.models import Prefecture, Region, Role, RoleName, VisaType

# (code, ja, en, vi)
REGIONS = [
    ("hokkaido", "北海道", "Hokkaido", "Hokkaido"),
    ("tohoku", "東北", "Tohoku", "Tohoku"),
    ("kanto", "関東", "Kanto", "Kanto"),
    ("chubu", "中部", "Chubu", "Chubu"),
    ("kansai", "関西", "Kansai", "Kansai"),
    ("chugoku", "中国", "Chugoku", "Chugoku"),
    ("shikoku", "四国", "Shikoku", "Shikoku"),
    ("kyushu", "九州・沖縄", "Kyushu & Okinawa", "Kyushu & Okinawa"),
]
_R = {c: i for i, (c, *_) in enumerate(REGIONS, start=1)}

# JIS code -> (slug, ja, en, region)
PREFECTURES = [
    (1, "hokkaido", "北海道", "Hokkaido", "hokkaido"),
    (2, "aomori", "青森県", "Aomori", "tohoku"), (3, "iwate", "岩手県", "Iwate", "tohoku"),
    (4, "miyagi", "宮城県", "Miyagi", "tohoku"), (5, "akita", "秋田県", "Akita", "tohoku"),
    (6, "yamagata", "山形県", "Yamagata", "tohoku"), (7, "fukushima", "福島県", "Fukushima", "tohoku"),
    (8, "ibaraki", "茨城県", "Ibaraki", "kanto"), (9, "tochigi", "栃木県", "Tochigi", "kanto"),
    (10, "gunma", "群馬県", "Gunma", "kanto"), (11, "saitama", "埼玉県", "Saitama", "kanto"),
    (12, "chiba", "千葉県", "Chiba", "kanto"), (13, "tokyo", "東京都", "Tokyo", "kanto"),
    (14, "kanagawa", "神奈川県", "Kanagawa", "kanto"),
    (15, "niigata", "新潟県", "Niigata", "chubu"), (16, "toyama", "富山県", "Toyama", "chubu"),
    (17, "ishikawa", "石川県", "Ishikawa", "chubu"), (18, "fukui", "福井県", "Fukui", "chubu"),
    (19, "yamanashi", "山梨県", "Yamanashi", "chubu"), (20, "nagano", "長野県", "Nagano", "chubu"),
    (21, "gifu", "岐阜県", "Gifu", "chubu"), (22, "shizuoka", "静岡県", "Shizuoka", "chubu"),
    (23, "aichi", "愛知県", "Aichi", "chubu"),
    (24, "mie", "三重県", "Mie", "kansai"), (25, "shiga", "滋賀県", "Shiga", "kansai"),
    (26, "kyoto", "京都府", "Kyoto", "kansai"), (27, "osaka", "大阪府", "Osaka", "kansai"),
    (28, "hyogo", "兵庫県", "Hyogo", "kansai"), (29, "nara", "奈良県", "Nara", "kansai"),
    (30, "wakayama", "和歌山県", "Wakayama", "kansai"),
    (31, "tottori", "鳥取県", "Tottori", "chugoku"), (32, "shimane", "島根県", "Shimane", "chugoku"),
    (33, "okayama", "岡山県", "Okayama", "chugoku"), (34, "hiroshima", "広島県", "Hiroshima", "chugoku"),
    (35, "yamaguchi", "山口県", "Yamaguchi", "chugoku"),
    (36, "tokushima", "徳島県", "Tokushima", "shikoku"), (37, "kagawa", "香川県", "Kagawa", "shikoku"),
    (38, "ehime", "愛媛県", "Ehime", "shikoku"), (39, "kochi", "高知県", "Kochi", "shikoku"),
    (40, "fukuoka", "福岡県", "Fukuoka", "kyushu"), (41, "saga", "佐賀県", "Saga", "kyushu"),
    (42, "nagasaki", "長崎県", "Nagasaki", "kyushu"), (43, "kumamoto", "熊本県", "Kumamoto", "kyushu"),
    (44, "oita", "大分県", "Oita", "kyushu"), (45, "miyazaki", "宮崎県", "Miyazaki", "kyushu"),
    (46, "kagoshima", "鹿児島県", "Kagoshima", "kyushu"), (47, "okinawa", "沖縄県", "Okinawa", "kyushu"),
]

VISAS = [
    ("permanent_resident", "永住者", "Permanent Resident", "Vĩnh trú"),
    ("spouse_of_japanese", "日本人の配偶者等", "Spouse of Japanese National", "Vợ/chồng người Nhật"),
    ("long_term_resident", "定住者", "Long-term Resident", "Định cư dài hạn"),
    ("specified_skilled_1", "特定技能1号", "Specified Skilled Worker (i)", "Kỹ năng đặc định 1"),
    ("specified_skilled_2", "特定技能2号", "Specified Skilled Worker (ii)", "Kỹ năng đặc định 2"),
    ("engineer_humanities", "技術・人文知識・国際業務", "Engineer/Specialist in Humanities/Intl Services", "Kỹ sư/Nhân văn/Quốc tế"),
    ("technical_intern", "技能実習", "Technical Intern Training", "Thực tập sinh kỹ năng"),
    ("student", "留学（資格外活動許可）", "Student (work permit)", "Du học sinh (có giấy phép làm thêm)"),
    ("dependent", "家族滞在（資格外活動許可）", "Dependent (work permit)", "Gia đình (có giấy phép làm thêm)"),
]

ROLE_DESC = {
    RoleName.SUPER_ADMIN: "Super administrator (everything, incl. user roles)",
    RoleName.CANDIDATE: "Job seeker",
    RoleName.RECRUITER: "Client-side recruiter (own jobs only)",
    RoleName.RECRUITER_MANAGER: "Internal recruiter manager (all jobs, approvals, applications)",
    RoleName.CONTENT_EDITOR: "Content editor (places, CMS, translations)",
}

LEGACY_MSG = """This database already has tables but no Alembic history (it was created before Alembic).
Bring it to the current schema once, then record the baseline:
  python -m app.migrate_phase5     # only if it predates Phase 5
  alembic stamp head
After that, always use: alembic upgrade head"""


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def upgrade_schema(url: str) -> None:
    engine = create_engine(url, pool_pre_ping=True)
    tables = set(inspect(engine).get_table_names())
    if "users" in tables and "alembic_version" not in tables:
        raise SystemExit(LEGACY_MSG)  # never run CREATE TABLE migrations over an un-baselined schema
    cfg = alembic_config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    engine.dispose()


def seed_reference_data(url: str) -> None:
    engine = create_engine(url, pool_pre_ping=True)
    with Session(engine) as s, s.begin():
        existing_roles = set(s.scalars(select(Role.name)))
        s.add_all(Role(id=i, name=r, description=ROLE_DESC[r])
                  for i, r in enumerate(RoleName, start=1) if r not in existing_roles)

        if not s.scalar(select(Region.id).limit(1)):
            s.add_all(
                Region(id=i, code=c, sort_order=i, name={"ja": ja, "en": en, "vi": vi})
                for i, (c, ja, en, vi) in enumerate(REGIONS, start=1)
            )
            s.flush()
            s.add_all(
                Prefecture(id=pid, code=slug, region_id=_R[reg], name={"ja": ja, "en": en})
                for pid, slug, ja, en, reg in PREFECTURES
            )

        if not s.scalar(select(VisaType.id).limit(1)):
            s.add_all(
                VisaType(id=i, code=c, sort_order=i, name={"ja": ja, "en": en, "vi": vi})
                for i, (c, ja, en, vi) in enumerate(VISAS, start=1)
            )
    engine.dispose()


def init(url: str | None = None) -> None:
    url = url or database_url()
    upgrade_schema(url)
    seed_reference_data(url)
    print("Database initialised (schema at alembic head, reference data present).")


if __name__ == "__main__":
    init()
