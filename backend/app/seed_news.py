"""Sample news posts (お知らせ) for app.seed_data.

Body format (rendered safely by the frontend, never as HTML): blank line = new paragraph, "## " heading,
"- " list item, **bold**, [text](https://... or /path) link.
Each entry: (slug, published N days ago, {locale: (title, summary, body)}).
"""

from __future__ import annotations

NEWS: list[tuple[str, int, dict[str, tuple[str, str, str]]]] = [
    ("site-open", 20, {
        "ja": (
            "ハケンワークをオープンしました",
            "外国人の方のための派遣・アルバイト求人サイトです。",
            "ハケンワークは、日本で働きたい外国人の方のための求人サイトです。\n\n"
            "## できること\n\n"
            "- 地図から都道府県を選んで求人を探す\n"
            "- 6言語（日本語・English・Tiếng Việt・မြန်မာ・नेपाली・বাংলা）で表示\n"
            "- 会員登録してすぐに応募\n\n"
            "まずは[求人一覧](/jobs)をご覧ください。",
        ),
        "en": (
            "Haken Work is now open",
            "A job site for foreign workers in Japan.",
            "Haken Work is a job site for foreigners who want to work in Japan.\n\n"
            "## What you can do\n\n"
            "- Find jobs by choosing a prefecture on the map\n"
            "- Use the site in 6 languages\n"
            "- Sign up and apply right away\n\n"
            "Start by browsing the [job list](/jobs).",
        ),
        "vi": (
            "Haken Work chính thức ra mắt",
            "Trang tuyển dụng dành cho người nước ngoài tại Nhật.",
            "Haken Work là trang tuyển dụng dành cho người nước ngoài muốn làm việc tại Nhật Bản.\n\n"
            "## Bạn có thể\n\n"
            "- Tìm việc theo tỉnh trên bản đồ\n"
            "- Xem trang bằng 6 ngôn ngữ\n"
            "- Đăng ký và ứng tuyển ngay\n\n"
            "Hãy bắt đầu với [danh sách việc làm](/jobs).",
        ),
    }),
    ("minimum-wage-2026", 12, {
        "ja": (
            "最低賃金改定のお知らせ",
            "各都道府県で最低賃金が引き上げられました。",
            "10月より、各都道府県で最低賃金が順次引き上げられました。\n\n"
            "当サイトに掲載している求人は、すべて**改定後の最低賃金以上**の時給です。\n\n"
            "お給料について不明な点があれば、応募先の担当者にお問い合わせください。",
        ),
        "en": (
            "Minimum wage revision",
            "Minimum wages have been raised in each prefecture.",
            "From October, minimum wages were raised in each prefecture.\n\n"
            "All jobs on this site pay **at least the new minimum wage**.\n\n"
            "If you have questions about your pay, please contact the person in charge of the job.",
        ),
        "vi": (
            "Thông báo điều chỉnh lương tối thiểu",
            "Lương tối thiểu đã tăng tại các tỉnh.",
            "Từ tháng 10, lương tối thiểu đã được nâng lên tại từng tỉnh.\n\n"
            "Tất cả việc làm trên trang đều trả **không thấp hơn mức lương tối thiểu mới**.\n\n"
            "Nếu có thắc mắc về lương, hãy liên hệ người phụ trách công việc.",
        ),
    }),
    ("year-end-holidays", 6, {
        "ja": (
            "年末年始の営業について",
            "12月28日〜1月4日はお休みをいただきます。",
            "誠に勝手ながら、下記の期間はお休みをいただきます。\n\n"
            "- 休業期間: 12月28日〜1月4日\n\n"
            "休業中も求人への応募はできますが、ご連絡は1月5日以降になります。",
        ),
        "en": (
            "Year-end holidays",
            "We are closed from December 28 to January 4.",
            "Our office will be closed during the following period.\n\n"
            "- Closed: December 28 - January 4\n\n"
            "You can still apply for jobs, but we will reply from January 5.",
        ),
        "vi": (
            "Lịch nghỉ cuối năm",
            "Chúng tôi nghỉ từ 28/12 đến 4/1.",
            "Văn phòng sẽ nghỉ trong thời gian sau.\n\n"
            "- Thời gian nghỉ: 28/12 - 4/1\n\n"
            "Bạn vẫn có thể ứng tuyển, nhưng chúng tôi sẽ liên hệ lại từ ngày 5/1.",
        ),
    }),
    ("winter-jobs", 1, {
        "ja": (
            "冬の短期・寮付き求人を追加しました",
            "北海道などで寮付きのお仕事が増えています。",
            "冬の期間に働ける短期のお仕事を追加しました。\n\n"
            "**寮完備**のお仕事も多いので、住む場所に困っている方にもおすすめです。\n\n"
            "[北海道の求人を見る](/jobs?prefecture=1)",
        ),
        "en": (
            "New short-term winter jobs with housing",
            "More jobs with dormitories in Hokkaido and other areas.",
            "We have added short-term jobs for the winter season.\n\n"
            "Many of them **include a dormitory**, which helps if you need a place to live.\n\n"
            "[See jobs in Hokkaido](/jobs?prefecture=1)",
        ),
        "vi": (
            "Thêm việc ngắn hạn mùa đông có ký túc xá",
            "Nhiều việc có ký túc xá tại Hokkaido và các vùng khác.",
            "Chúng tôi đã thêm các công việc ngắn hạn cho mùa đông.\n\n"
            "Nhiều việc **có ký túc xá**, phù hợp nếu bạn cần chỗ ở.\n\n"
            "[Xem việc làm tại Hokkaido](/jobs?prefecture=1)",
        ),
    }),
]
