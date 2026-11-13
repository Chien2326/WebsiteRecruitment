"""Sample data: 15 realistic Japanese Haken/part-time jobs (hourly wages in the usual 1,200-1,600 JPY band)
and 4 news posts (お知らせ).

Usage: python -m app.seed_data     (needs DATABASE_URL; run app.init_db first). Idempotent.
Prefectures (Kanji / Romaji) are seeded by init_db; Vietnamese names there equal the romaji,
which is the standard Vietnamese usage for Japanese prefectures.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.envfile import database_url
from app.seed_news import NEWS
from app.seed_pages import PAGES

from app.models import (
    CmsContent, ContentStatus, EmploymentType, Job, News, JobEndClient, JobStatus, JapaneseLevel, Prefecture, Role, RoleName,
    SalaryType, User, VisaType,
)

L = JapaneseLevel
# (code, pref_id, ja title, en title, vi title, level, min, max, features, visas, shift_ja, end_client)
JOBS = [
    ("001", 23, "倉庫内ピッキング・軽作業／寮完備", "Warehouse picking & light work / Housing", "Nhặt hàng trong kho / Có ký túc xá", L.N4, 1200, 1500, ["dormitory", "no_experience", "transport_paid"], ["permanent_resident", "specified_skilled_1"], "日勤 8:00〜17:00", "株式会社アイチ物流"),
    ("002", 13, "コンビニ商品の仕分け（日勤）", "Convenience-store goods sorting (day)", "Phân loại hàng cho cửa hàng tiện lợi (ca ngày)", L.N3, 1300, 1600, ["transport_paid"], ["permanent_resident", "spouse_of_japanese", "student"], "日勤 9:00〜18:00", "東京フレッシュ食品株式会社"),
    ("003", 27, "自動車部品の組立・検査", "Auto parts assembly & inspection", "Lắp ráp & kiểm tra phụ tùng ô tô", L.N4, 1250, 1450, ["dormitory", "no_experience"], ["specified_skilled_1", "long_term_resident"], "2交替制", "関西オート工業株式会社"),
    ("004", 14, "ホテルのベッドメイキング", "Hotel bed-making & cleaning", "Dọn phòng & trải giường khách sạn", L.N3, 1250, 1400, ["transport_paid", "no_experience"], ["student", "dependent"], "9:00〜15:00（週3日〜）", "横浜ベイホテル株式会社"),
    ("005", 40, "食品工場での盛り付け・梱包", "Food factory plating & packing", "Xếp & đóng gói tại nhà máy thực phẩm", L.N5, 1200, 1350, ["dormitory", "no_experience"], ["specified_skilled_1", "technical_intern"], "日勤・夜勤選択可", "福岡ミール株式会社"),
    ("006", 1, "札幌 ホテルレストランのホールスタッフ", "Sapporo hotel restaurant floor staff", "Phục vụ nhà hàng khách sạn Sapporo", L.N2, 1300, 1500, ["english_ok", "transport_paid"], ["permanent_resident", "engineer_humanities"], "シフト制", "札幌グランドホテル株式会社"),
    ("007", 11, "物流センターのフォークリフト作業", "Logistics center forklift operator", "Lái xe nâng tại trung tâm logistics", L.N3, 1500, 1800, ["transport_paid"], ["permanent_resident", "long_term_resident"], "日勤 8:30〜17:30", "埼玉ロジスティクス株式会社"),
    ("008", 22, "電子部品の目視検査（空調完備）", "Electronic parts visual inspection (A/C)", "Kiểm tra bằng mắt linh kiện điện tử (có điều hòa)", L.N4, 1250, 1400, ["dormitory", "no_experience"], ["specified_skilled_1"], "日勤 8:00〜17:00", "静岡エレクトロニクス株式会社"),
    ("009", 12, "空港内の清掃スタッフ", "Airport cleaning staff", "Nhân viên vệ sinh sân bay", L.N4, 1250, 1400, ["transport_paid", "no_experience"], ["student", "spouse_of_japanese"], "早朝 5:00〜10:00", "成田クリーンサービス株式会社"),
    ("010", 26, "京都の旅館での接客・清掃", "Kyoto ryokan service & cleaning", "Phục vụ & dọn dẹp ryokan Kyoto", L.N3, 1200, 1400, ["dormitory", "english_ok"], ["permanent_resident", "specified_skilled_1"], "シフト制", "京都ひなた旅館株式会社"),
    ("011", 21, "プラスチック成形機のオペレーター", "Plastic molding machine operator", "Vận hành máy ép nhựa", L.N4, 1300, 1550, ["dormitory"], ["specified_skilled_1", "long_term_resident"], "2交替制", "岐阜モールド工業株式会社"),
    ("012", 28, "弁当工場の製造スタッフ", "Bento factory production staff", "Sản xuất cơm hộp tại nhà máy", L.N5, 1200, 1300, ["no_experience", "transport_paid"], ["student", "dependent", "spouse_of_japanese"], "朝・夕方シフト", "神戸フーズ株式会社"),
    ("013", 34, "広島 自動車工場のライン作業", "Hiroshima car plant line work", "Công nhân dây chuyền nhà máy ô tô Hiroshima", L.N4, 1400, 1650, ["dormitory", "transport_paid"], ["specified_skilled_1", "permanent_resident"], "2交替制", "広島オートパーツ株式会社"),
    ("014", 47, "沖縄 リゾートホテルの清掃", "Okinawa resort hotel cleaning", "Dọn dẹp khách sạn nghỉ dưỡng Okinawa", L.N5, 1200, 1350, ["dormitory", "english_ok"], ["student", "spouse_of_japanese"], "9:00〜16:00", "沖縄ブルーリゾート株式会社"),
    ("015", 20, "長野 精密部品の検品・梱包", "Nagano precision parts inspection & packing", "Kiểm hàng & đóng gói linh kiện chính xác Nagano", L.N4, 1250, 1500, ["dormitory", "no_experience"], ["specified_skilled_1", "technical_intern"], "日勤 8:00〜17:00", "長野プレシジョン株式会社"),
]

# Nearest station per sample job: (ja, en, vi). Shown on cards and the detail page.
STATIONS = {
    "001": ("JR東海道線 大府駅 徒歩10分", "Obu Sta. (JR Tokaido Line), 10 min walk", "Ga Obu (tuyến JR Tokaido), đi bộ 10 phút"),
    "002": ("東京メトロ東西線 南砂町駅 徒歩8分", "Minami-sunamachi Sta. (Tozai Line), 8 min walk", "Ga Minami-sunamachi (tuyến Tozai), đi bộ 8 phút"),
    "003": ("南海本線 堺駅 送迎バスあり", "Sakai Sta. (Nankai Line), shuttle bus", "Ga Sakai (tuyến Nankai), có xe đưa đón"),
    "004": ("みなとみらい線 みなとみらい駅 徒歩5分", "Minatomirai Sta., 5 min walk", "Ga Minatomirai, đi bộ 5 phút"),
    "005": ("西鉄天神大牟田線 春日原駅 徒歩12分", "Kasugabaru Sta. (Nishitetsu), 12 min walk", "Ga Kasugabaru (Nishitetsu), đi bộ 12 phút"),
    "006": ("地下鉄南北線 すすきの駅 徒歩3分", "Susukino Sta. (Namboku Line), 3 min walk", "Ga Susukino (tuyến Namboku), đi bộ 3 phút"),
    "007": ("JR武蔵野線 三郷駅 送迎バスあり", "Misato Sta. (JR Musashino Line), shuttle bus", "Ga Misato (tuyến JR Musashino), có xe đưa đón"),
    "008": ("JR東海道線 磐田駅 送迎バスあり", "Iwata Sta. (JR Tokaido Line), shuttle bus", "Ga Iwata (tuyến JR Tokaido), có xe đưa đón"),
    "009": ("JR成田線 成田空港駅 徒歩5分", "Narita Airport Sta., 5 min walk", "Ga sân bay Narita, đi bộ 5 phút"),
    "010": ("京阪本線 祇園四条駅 徒歩7分", "Gion-shijo Sta. (Keihan Line), 7 min walk", "Ga Gion-shijo (tuyến Keihan), đi bộ 7 phút"),
    "011": ("JR東海道線 大垣駅 送迎バスあり", "Ogaki Sta. (JR Tokaido Line), shuttle bus", "Ga Ogaki (tuyến JR Tokaido), có xe đưa đón"),
    "012": ("JR神戸線 西明石駅 徒歩15分", "Nishi-Akashi Sta. (JR Kobe Line), 15 min walk", "Ga Nishi-Akashi (tuyến JR Kobe), đi bộ 15 phút"),
    "013": ("JR山陽本線 向洋駅 徒歩10分", "Mukainada Sta. (JR Sanyo Line), 10 min walk", "Ga Mukainada (tuyến JR Sanyo), đi bộ 10 phút"),
    "014": ("ゆいレール 県庁前駅 送迎バスあり", "Kenchomae Sta. (Yui Rail), shuttle bus", "Ga Kenchomae (Yui Rail), có xe đưa đón"),
    "015": ("JR篠ノ井線 松本駅 送迎バスあり", "Matsumoto Sta. (JR Shinonoi Line), shuttle bus", "Ga Matsumoto (tuyến JR Shinonoi), có xe đưa đón"),
}


DESC_JA = "{t}のお仕事です。\n丁寧な研修があるので、未経験の方も安心してスタートできます。"
DESC_EN = "{t}.\nFull training is provided, so beginners are welcome."
DESC_VI = "{t}.\nCó đào tạo đầy đủ nên người mới cũng yên tâm."



def seed(url: str | None = None) -> None:
    engine = create_engine(url or database_url())
    now = datetime.now(timezone.utc)
    with Session(engine) as s, s.begin():
        owner = s.scalar(select(User).where(User.email == "seed-recruiter@example.com"))
        if owner is None:
            rid = s.scalar(select(Role.id).where(Role.name == RoleName.RECRUITER))
            owner = User(email="seed-recruiter@example.com", role_id=rid, is_email_verified=True)
            s.add(owner)
            s.flush()
        visas = {v.code: v for v in s.scalars(select(VisaType))}
        assert s.scalar(select(Prefecture.id).limit(1)), "run app.init_db first"

        for i, (n, pref, ja, en, vi, lvl, lo, hi, feats, vcodes, shift, client) in enumerate(JOBS):
            code = f"HK-2026-{n.zfill(6)}"
            st = STATIONS.get(n)
            station = {"ja": st[0], "en": st[1], "vi": st[2]} if st else None
            existing = s.scalar(select(Job).where(Job.job_code == code))
            if existing is not None:
                if existing.nearest_station is None and station:  # fill only an empty field, never overwrite
                    existing.nearest_station = station
                continue
            job = Job(
                job_code=code, created_by=owner.id, prefecture_id=pref,
                title={"ja": ja, "en": en, "vi": vi},
                description={"ja": DESC_JA.format(t=ja), "en": DESC_EN.format(t=en), "vi": DESC_VI.format(t=vi)},
                employment_type=EmploymentType.HAKEN, salary_type=SalaryType.HOURLY,
                salary_min=lo, salary_max=hi, transport_fee_included="transport_paid" in feats,
                nearest_station=station,
                work_shift={"ja": shift}, work_hours_per_week=40, japanese_level_required=lvl,
                features=feats, status=JobStatus.PUBLISHED,
                published_at=now - timedelta(hours=i * 7),
            )
            job.visa_types = [visas[c] for c in vcodes]
            job.end_client = JobEndClient(end_client_name=client)  # real name: DB/admin only
            s.add(job)

        for slug, days_ago, texts in NEWS:
            if s.scalar(select(News.id).where(News.slug == slug)):
                continue
            s.add(News(
                slug=slug, author_id=owner.id, status=ContentStatus.PUBLISHED,
                published_at=now - timedelta(days=days_ago),
                title={k: v[0] for k, v in texts.items()},
                summary={k: v[1] for k, v in texts.items()},
                body={k: v[2] for k, v in texts.items()},
            ))

        for key, content in PAGES.items():  # only when missing: never overwrite what an admin edited
            if not s.scalar(select(CmsContent.id).where(CmsContent.key == key)):
                s.add(CmsContent(key=key, content=content, is_published=True))
    print(f"Seeded {len(JOBS)} jobs, {len(NEWS)} news posts, {len(PAGES)} CMS pages (only missing ones are added).")


if __name__ == "__main__":
    seed()
