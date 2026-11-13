"""Transactional email: account emails (verify, reset, change...) and application notifications.

Flow: the request handler *queues* (writes an `email_logs` row in the same transaction as the change it
announces) and schedules delivery as a FastAPI background task, which runs after the response is sent.
A failed send is recorded (status=failed) and can be retried from the log; it never breaks the request.
The body is never stored: it can contain a one-time link (token) and personal data.

Backends (MAIL_BACKEND): console (dev, logs the mail), smtp (production: SES/SendGrid SMTP...), memory (tests).
"""

from __future__ import annotations

import logging
import smtplib
import ssl
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Application, ApplicationStatus, EmailLog, EmailStatus, EmployerInquiry, User

log = logging.getLogger(__name__)

NOTIFY_STATUSES = {ApplicationStatus.REVIEWING, ApplicationStatus.INTERVIEW,
                   ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED}


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    body: str


# ------------------------------------------------------------------ backends
outbox: list[Mail] = []  # memory backend (tests)


def _send_smtp(m: Mail) -> None:
    msg = EmailMessage()  # refuses CR/LF in headers -> no header injection
    msg["From"] = settings.mail_from
    msg["To"] = m.to
    msg["Subject"] = m.subject
    msg.set_content(m.body)
    with smtplib.SMTP(settings.smtp_host or "localhost", settings.smtp_port, timeout=15) as s:
        if settings.smtp_starttls:
            s.starttls(context=ssl.create_default_context())
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password or "")
        s.send_message(msg)


def send(m: Mail) -> None:
    if settings.mail_backend == "smtp":
        _send_smtp(m)
    elif settings.mail_backend == "memory":
        outbox.append(m)
    else:
        log.info("[mail:console] to=%s subject=%s\n%s", m.to, m.subject, m.body)


# ------------------------------------------------------------------ templates (6 languages)
# Application status templates: {name}, {job}
_T: dict[str, dict[str, tuple[str, str]]] = {
    "ja": {
        "applied": ("【ハケンワーク】ご応募を受け付けました", "{name} 様\n\n「{job}」へのご応募を受け付けました。選考状況はマイページでご確認いただけます。"),
        "reviewing": ("【ハケンワーク】選考が始まりました", "{name} 様\n\n「{job}」へのご応募について、選考を開始しました。結果をお待ちください。"),
        "interview": ("【ハケンワーク】面接のご案内", "{name} 様\n\n「{job}」について、面接のご案内があります。詳細はマイページをご確認ください。"),
        "accepted": ("【ハケンワーク】採用のお知らせ", "{name} 様\n\nおめでとうございます！「{job}」で採用が決まりました。今後の流れはマイページをご確認ください。"),
        "rejected": ("【ハケンワーク】選考結果のお知らせ", "{name} 様\n\n「{job}」へのご応募ありがとうございました。慎重に検討しましたが、今回はご縁がありませんでした。ほかのお仕事もぜひご覧ください。"),
    },
    "en": {
        "applied": ("[Haken Work] We received your application", "Hello {name},\n\nWe have received your application for \"{job}\". You can follow its progress on your page."),
        "reviewing": ("[Haken Work] Your application is being reviewed", "Hello {name},\n\nWe have started reviewing your application for \"{job}\"."),
        "interview": ("[Haken Work] Interview invitation", "Hello {name},\n\nYou are invited to an interview for \"{job}\". Please check your page for details."),
        "accepted": ("[Haken Work] Congratulations, you are hired!", "Hello {name},\n\nGreat news: you have been hired for \"{job}\". Please check your page for next steps."),
        "rejected": ("[Haken Work] About your application", "Hello {name},\n\nThank you for applying for \"{job}\". Unfortunately you were not selected this time. Please take a look at our other jobs."),
    },
    "vi": {
        "applied": ("[Haken Work] Đã nhận hồ sơ ứng tuyển của bạn", "Xin chào {name},\n\nChúng tôi đã nhận hồ sơ ứng tuyển \"{job}\" của bạn. Bạn có thể theo dõi tiến độ tại Trang của tôi."),
        "reviewing": ("[Haken Work] Hồ sơ của bạn đang được xét duyệt", "Xin chào {name},\n\nChúng tôi đã bắt đầu xét duyệt hồ sơ ứng tuyển \"{job}\" của bạn."),
        "interview": ("[Haken Work] Thư mời phỏng vấn", "Xin chào {name},\n\nBạn được mời phỏng vấn cho công việc \"{job}\". Vui lòng xem chi tiết tại Trang của tôi."),
        "accepted": ("[Haken Work] Chúc mừng bạn đã trúng tuyển!", "Xin chào {name},\n\nChúc mừng! Bạn đã trúng tuyển công việc \"{job}\". Vui lòng xem các bước tiếp theo tại Trang của tôi."),
        "rejected": ("[Haken Work] Kết quả ứng tuyển", "Xin chào {name},\n\nCảm ơn bạn đã ứng tuyển \"{job}\". Rất tiếc lần này bạn chưa phù hợp. Hãy xem thêm các công việc khác nhé."),
    },
    "my": {
        "applied": ("[Haken Work] သင့်လျှောက်လွှာကို လက်ခံရရှိပါပြီ", "မင်္ဂလာပါ {name}၊\n\n\"{job}\" အတွက် သင့်လျှောက်လွှာကို လက်ခံရရှိပါပြီ။ တိုးတက်မှုကို ကျွန်ုပ်၏စာမျက်နှာတွင် ကြည့်နိုင်ပါသည်။"),
        "reviewing": ("[Haken Work] သင့်လျှောက်လွှာကို စစ်ဆေးနေပါသည်", "မင်္ဂလာပါ {name}၊\n\n\"{job}\" အတွက် သင့်လျှောက်လွှာကို စတင်စစ်ဆေးနေပါပြီ။"),
        "interview": ("[Haken Work] အင်တာဗျူး ဖိတ်ကြားချက်", "မင်္ဂလာပါ {name}၊\n\n\"{job}\" အတွက် အင်တာဗျူးသို့ ဖိတ်ကြားပါသည်။ အသေးစိတ်ကို ကျွန်ုပ်၏စာမျက်နှာတွင် ကြည့်ပါ။"),
        "accepted": ("[Haken Work] ခန့်အပ်ခံရပါပြီ!", "မင်္ဂလာပါ {name}၊\n\nဂုဏ်ယူပါသည်! \"{job}\" တွင် ခန့်အပ်ခံရပါပြီ။ နောက်အဆင့်များကို ကျွန်ုပ်၏စာမျက်နှာတွင် ကြည့်ပါ။"),
        "rejected": ("[Haken Work] လျှောက်လွှာ ရလဒ်", "မင်္ဂလာပါ {name}၊\n\n\"{job}\" ကို လျှောက်ထားသည့်အတွက် ကျေးဇူးတင်ပါသည်။ ဤတစ်ကြိမ် မရွေးချယ်ခံရပါ။ အခြားအလုပ်များကို ကြည့်ပါ။"),
    },
    "ne": {
        "applied": ("[Haken Work] तपाईंको आवेदन प्राप्त भयो", "नमस्ते {name},\n\n\"{job}\" का लागि तपाईंको आवेदन प्राप्त भयो। प्रगति मेरो पेजमा हेर्न सक्नुहुन्छ।"),
        "reviewing": ("[Haken Work] तपाईंको आवेदन जाँच हुँदैछ", "नमस्ते {name},\n\n\"{job}\" का लागि तपाईंको आवेदन जाँच सुरु भएको छ।"),
        "interview": ("[Haken Work] अन्तर्वार्ताको निम्तो", "नमस्ते {name},\n\n\"{job}\" का लागि अन्तर्वार्तामा निम्तो छ। विवरण मेरो पेजमा हेर्नुहोस्।"),
        "accepted": ("[Haken Work] बधाई छ, तपाईं छनोट हुनुभयो!", "नमस्ते {name},\n\nबधाई छ! \"{job}\" मा तपाईं छनोट हुनुभयो। अर्को चरण मेरो पेजमा हेर्नुहोस्।"),
        "rejected": ("[Haken Work] आवेदनको नतिजा", "नमस्ते {name},\n\n\"{job}\" मा आवेदन दिनुभएकोमा धन्यवाद। यसपटक तपाईं छनोट हुनुभएन। अरू कामहरू हेर्नुहोस्।"),
    },
    "bn": {
        "applied": ("[Haken Work] আপনার আবেদন পাওয়া গেছে", "হ্যালো {name},\n\n\"{job}\"-এর জন্য আপনার আবেদন পাওয়া গেছে। অগ্রগতি আমার পাতায় দেখতে পারবেন।"),
        "reviewing": ("[Haken Work] আপনার আবেদন যাচাই করা হচ্ছে", "হ্যালো {name},\n\n\"{job}\"-এর জন্য আপনার আবেদন যাচাই শুরু হয়েছে।"),
        "interview": ("[Haken Work] সাক্ষাৎকারের আমন্ত্রণ", "হ্যালো {name},\n\n\"{job}\"-এর জন্য আপনাকে সাক্ষাৎকারে আমন্ত্রণ জানানো হচ্ছে। বিস্তারিত আমার পাতায় দেখুন।"),
        "accepted": ("[Haken Work] অভিনন্দন, আপনি নিয়োগ পেয়েছেন!", "হ্যালো {name},\n\nঅভিনন্দন! \"{job}\"-এ আপনি নিয়োগ পেয়েছেন। পরবর্তী ধাপ আমার পাতায় দেখুন।"),
        "rejected": ("[Haken Work] আবেদনের ফলাফল", "হ্যালো {name},\n\n\"{job}\"-এ আবেদন করার জন্য ধন্যবাদ। এবার আপনি নির্বাচিত হননি। অন্য চাকরিগুলো দেখুন।"),
    },
}
_FOOTER = {
    "ja": "\n\nマイページ: {url}\n\n※このメールは送信専用です。",
    "en": "\n\nYour page: {url}\n\nThis is an automated message; please do not reply.",
    "vi": "\n\nTrang của tôi: {url}\n\nĐây là email tự động, vui lòng không trả lời.",
    "my": "\n\n{url}\n\nဤအီးမေးလ်သည် အလိုအလျောက်ပို့ခြင်းဖြစ်သည်။",
    "ne": "\n\n{url}\n\nयो स्वचालित इमेल हो, जवाफ नदिनुहोस्।",
    "bn": "\n\n{url}\n\nএটি একটি স্বয়ংক্রিয় ইমেইল, উত্তর দেবেন না।",
}
_NOREPLY = {
    "ja": "\n\n※このメールは送信専用です。",
    "en": "\n\nThis is an automated message; please do not reply.",
    "vi": "\n\nĐây là email tự động, vui lòng không trả lời.",
    "my": "\n\nဤအီးမေးလ်သည် အလိုအလျောက်ပို့ခြင်းဖြစ်သည်။",
    "ne": "\n\nयो स्वचालित इमेल हो, जवाफ नदिनुहोस्।",
    "bn": "\n\nএটি একটি স্বয়ংক্রিয় ইমেইল, উত্তর দেবেন না।",
}

# Account templates: {name}, {url}, {hours}, {minutes}, {email}
_A: dict[str, dict[str, tuple[str, str]]] = {
    "ja": {
        "verify_email": ("【ハケンワーク】メールアドレスの確認", "{name} 様\n\nハケンワークにご登録いただきありがとうございます。\n下のリンクを開いて、メールアドレスの確認を完了してください（{hours}時間有効）。\n\n{url}\n\nお心当たりのない場合は、このメールを破棄してください。"),
        "password_reset": ("【ハケンワーク】パスワード再設定のご案内", "{name} 様\n\nパスワード再設定のリクエストを受け付けました。\n下のリンクから新しいパスワードを設定してください（{minutes}分間有効）。\n\n{url}\n\nお心当たりのない場合は、このメールを破棄してください。パスワードは変更されません。"),
        "password_changed": ("【ハケンワーク】パスワードが変更されました", "{name} 様\n\nアカウントのパスワードが変更され、すべての端末からログアウトしました。\nお心当たりのない場合は、すぐに下のリンクからパスワードを再設定してください。\n\n{url}"),
        "email_change": ("【ハケンワーク】新しいメールアドレスの確認", "{name} 様\n\nメールアドレスを {email} に変更するリクエストを受け付けました。\n下のリンクを開くと変更が完了します（{hours}時間有効）。\n\n{url}\n\nお心当たりのない場合は、このメールを破棄してください。"),
        "email_changed": ("【ハケンワーク】メールアドレスが変更されました", "{name} 様\n\nアカウントのメールアドレスが {email} に変更されました。\nお心当たりのない場合は、すぐに下のリンクからパスワードを再設定してください。\n\n{url}"),
        "account_deleted": ("【ハケンワーク】退会手続きが完了しました", "{name} 様\n\nアカウントと、登録されていたプロフィール・CV・応募情報をすべて削除しました。\nこれまでご利用いただき、ありがとうございました。"),
    },
    "en": {
        "verify_email": ("[Haken Work] Please confirm your email address", "Hello {name},\n\nThank you for signing up for Haken Work.\nOpen the link below to confirm your email address (valid for {hours} hours).\n\n{url}\n\nIf you did not sign up, you can ignore this email."),
        "password_reset": ("[Haken Work] Reset your password", "Hello {name},\n\nWe received a request to reset your password.\nSet a new password with the link below (valid for {minutes} minutes).\n\n{url}\n\nIf you did not ask for this, ignore this email. Your password will not change."),
        "password_changed": ("[Haken Work] Your password was changed", "Hello {name},\n\nYour password was changed and you were signed out on every device.\nIf this was not you, reset your password now:\n\n{url}"),
        "email_change": ("[Haken Work] Confirm your new email address", "Hello {name},\n\nWe received a request to change your email address to {email}.\nOpen the link below to complete the change (valid for {hours} hours).\n\n{url}\n\nIf you did not ask for this, ignore this email."),
        "email_changed": ("[Haken Work] Your email address was changed", "Hello {name},\n\nThe email address of your account was changed to {email}.\nIf this was not you, reset your password now:\n\n{url}"),
        "account_deleted": ("[Haken Work] Your account has been deleted", "Hello {name},\n\nYour account, profile, CVs and applications have been deleted.\nThank you for using Haken Work."),
    },
    "vi": {
        "verify_email": ("[Haken Work] Xác nhận địa chỉ email", "Xin chào {name},\n\nCảm ơn bạn đã đăng ký Haken Work.\nHãy mở liên kết dưới đây để xác nhận địa chỉ email (hiệu lực {hours} giờ).\n\n{url}\n\nNếu bạn không đăng ký, hãy bỏ qua email này."),
        "password_reset": ("[Haken Work] Đặt lại mật khẩu", "Xin chào {name},\n\nChúng tôi nhận được yêu cầu đặt lại mật khẩu của bạn.\nHãy đặt mật khẩu mới bằng liên kết dưới đây (hiệu lực {minutes} phút).\n\n{url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này. Mật khẩu của bạn sẽ không thay đổi."),
        "password_changed": ("[Haken Work] Mật khẩu đã được thay đổi", "Xin chào {name},\n\nMật khẩu tài khoản của bạn đã được thay đổi và bạn đã được đăng xuất khỏi mọi thiết bị.\nNếu không phải bạn, hãy đặt lại mật khẩu ngay:\n\n{url}"),
        "email_change": ("[Haken Work] Xác nhận địa chỉ email mới", "Xin chào {name},\n\nChúng tôi nhận được yêu cầu đổi địa chỉ email thành {email}.\nHãy mở liên kết dưới đây để hoàn tất (hiệu lực {hours} giờ).\n\n{url}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này."),
        "email_changed": ("[Haken Work] Địa chỉ email đã được thay đổi", "Xin chào {name},\n\nĐịa chỉ email của tài khoản đã được đổi thành {email}.\nNếu không phải bạn, hãy đặt lại mật khẩu ngay:\n\n{url}"),
        "account_deleted": ("[Haken Work] Tài khoản đã được xóa", "Xin chào {name},\n\nTài khoản, hồ sơ, CV và các đơn ứng tuyển của bạn đã được xóa.\nCảm ơn bạn đã sử dụng Haken Work."),
    },
    "my": {
        "verify_email": ("[Haken Work] အီးမေးလ်လိပ်စာကို အတည်ပြုပါ", "မင်္ဂလာပါ {name}၊\n\nHaken Work တွင် စာရင်းသွင်းသည့်အတွက် ကျေးဇူးတင်ပါသည်။\nအီးမေးလ်လိပ်စာ အတည်ပြုရန် အောက်ပါလင့်ခ်ကို ဖွင့်ပါ ({hours} နာရီ အကျုံးဝင်သည်)။\n\n{url}\n\nသင် စာရင်းမသွင်းခဲ့ပါက ဤအီးမေးလ်ကို လျစ်လျူရှုပါ။"),
        "password_reset": ("[Haken Work] စကားဝှက် ပြန်လည်သတ်မှတ်ရန်", "မင်္ဂလာပါ {name}၊\n\nစကားဝှက် ပြန်လည်သတ်မှတ်ရန် တောင်းဆိုမှု ရရှိပါသည်။\nအောက်ပါလင့်ခ်ဖြင့် စကားဝှက်အသစ် သတ်မှတ်ပါ ({minutes} မိနစ် အကျုံးဝင်သည်)။\n\n{url}\n\nသင် မတောင်းဆိုခဲ့ပါက ဤအီးမေးလ်ကို လျစ်လျူရှုပါ။"),
        "password_changed": ("[Haken Work] စကားဝှက် ပြောင်းလဲပြီးပါပြီ", "မင်္ဂလာပါ {name}၊\n\nသင့်စကားဝှက် ပြောင်းလဲပြီး စက်အားလုံးမှ ထွက်ပြီးပါပြီ။\nသင် မဟုတ်ပါက ယခုပင် စကားဝှက်ကို ပြန်လည်သတ်မှတ်ပါ:\n\n{url}"),
        "email_change": ("[Haken Work] အီးမေးလ်လိပ်စာအသစ်ကို အတည်ပြုပါ", "မင်္ဂလာပါ {name}၊\n\nအီးမေးလ်လိပ်စာကို {email} သို့ ပြောင်းရန် တောင်းဆိုမှု ရရှိပါသည်။\nပြီးဆုံးရန် အောက်ပါလင့်ခ်ကို ဖွင့်ပါ ({hours} နာရီ အကျုံးဝင်သည်)။\n\n{url}\n\nသင် မတောင်းဆိုခဲ့ပါက ဤအီးမေးလ်ကို လျစ်လျူရှုပါ။"),
        "email_changed": ("[Haken Work] အီးမေးလ်လိပ်စာ ပြောင်းလဲပြီးပါပြီ", "မင်္ဂလာပါ {name}၊\n\nသင့်အကောင့်၏ အီးမေးလ်လိပ်စာကို {email} သို့ ပြောင်းလဲပြီးပါပြီ။\nသင် မဟုတ်ပါက ယခုပင် စကားဝှက်ကို ပြန်လည်သတ်မှတ်ပါ:\n\n{url}"),
        "account_deleted": ("[Haken Work] အကောင့်ကို ဖျက်ပြီးပါပြီ", "မင်္ဂလာပါ {name}၊\n\nသင့်အကောင့်၊ ပရိုဖိုင်၊ CV နှင့် လျှောက်လွှာများကို ဖျက်ပြီးပါပြီ။\nHaken Work ကို အသုံးပြုသည့်အတွက် ကျေးဇူးတင်ပါသည်။"),
    },
    "ne": {
        "verify_email": ("[Haken Work] इमेल ठेगाना पुष्टि गर्नुहोस्", "नमस्ते {name},\n\nHaken Work मा दर्ता गर्नुभएकोमा धन्यवाद।\nइमेल ठेगाना पुष्टि गर्न तलको लिङ्क खोल्नुहोस् ({hours} घण्टासम्म मान्य)।\n\n{url}\n\nतपाईंले दर्ता गर्नुभएको होइन भने यो इमेल बेवास्ता गर्नुहोस्।"),
        "password_reset": ("[Haken Work] पासवर्ड रिसेट गर्नुहोस्", "नमस्ते {name},\n\nपासवर्ड रिसेट गर्ने अनुरोध प्राप्त भयो।\nतलको लिङ्कबाट नयाँ पासवर्ड राख्नुहोस् ({minutes} मिनेटसम्म मान्य)।\n\n{url}\n\nतपाईंले अनुरोध गर्नुभएको होइन भने यो इमेल बेवास्ता गर्नुहोस्।"),
        "password_changed": ("[Haken Work] पासवर्ड परिवर्तन भयो", "नमस्ते {name},\n\nतपाईंको पासवर्ड परिवर्तन भयो र सबै उपकरणबाट लगआउट गरियो।\nयो तपाईं होइन भने अहिले नै पासवर्ड रिसेट गर्नुहोस्:\n\n{url}"),
        "email_change": ("[Haken Work] नयाँ इमेल ठेगाना पुष्टि गर्नुहोस्", "नमस्ते {name},\n\nइमेल ठेगाना {email} मा परिवर्तन गर्ने अनुरोध प्राप्त भयो।\nपूरा गर्न तलको लिङ्क खोल्नुहोस् ({hours} घण्टासम्म मान्य)।\n\n{url}\n\nतपाईंले अनुरोध गर्नुभएको होइन भने यो इमेल बेवास्ता गर्नुहोस्।"),
        "email_changed": ("[Haken Work] इमेल ठेगाना परिवर्तन भयो", "नमस्ते {name},\n\nतपाईंको खाताको इमेल ठेगाना {email} मा परिवर्तन भयो।\nयो तपाईं होइन भने अहिले नै पासवर्ड रिसेट गर्नुहोस्:\n\n{url}"),
        "account_deleted": ("[Haken Work] खाता मेटाइयो", "नमस्ते {name},\n\nतपाईंको खाता, प्रोफाइल, CV र आवेदनहरू मेटाइयो।\nHaken Work प्रयोग गर्नुभएकोमा धन्यवाद।"),
    },
    "bn": {
        "verify_email": ("[Haken Work] ইমেইল ঠিকানা নিশ্চিত করুন", "হ্যালো {name},\n\nHaken Work-এ নিবন্ধনের জন্য ধন্যবাদ।\nইমেইল ঠিকানা নিশ্চিত করতে নিচের লিংকটি খুলুন ({hours} ঘণ্টা বৈধ)।\n\n{url}\n\nআপনি নিবন্ধন না করে থাকলে এই ইমেইলটি উপেক্ষা করুন।"),
        "password_reset": ("[Haken Work] পাসওয়ার্ড রিসেট করুন", "হ্যালো {name},\n\nপাসওয়ার্ড রিসেটের অনুরোধ পাওয়া গেছে।\nনিচের লিংক থেকে নতুন পাসওয়ার্ড দিন ({minutes} মিনিট বৈধ)।\n\n{url}\n\nআপনি অনুরোধ না করে থাকলে এই ইমেইলটি উপেক্ষা করুন।"),
        "password_changed": ("[Haken Work] পাসওয়ার্ড পরিবর্তন হয়েছে", "হ্যালো {name},\n\nআপনার পাসওয়ার্ড পরিবর্তন হয়েছে এবং সব ডিভাইস থেকে লগআউট করা হয়েছে।\nএটি আপনি না হলে এখনই পাসওয়ার্ড রিসেট করুন:\n\n{url}"),
        "email_change": ("[Haken Work] নতুন ইমেইল ঠিকানা নিশ্চিত করুন", "হ্যালো {name},\n\nইমেইল ঠিকানা {email}-এ পরিবর্তনের অনুরোধ পাওয়া গেছে।\nসম্পূর্ণ করতে নিচের লিংকটি খুলুন ({hours} ঘণ্টা বৈধ)।\n\n{url}\n\nআপনি অনুরোধ না করে থাকলে এই ইমেইলটি উপেক্ষা করুন।"),
        "email_changed": ("[Haken Work] ইমেইল ঠিকানা পরিবর্তন হয়েছে", "হ্যালো {name},\n\nআপনার অ্যাকাউন্টের ইমেইল ঠিকানা {email}-এ পরিবর্তন হয়েছে।\nএটি আপনি না হলে এখনই পাসওয়ার্ড রিসেট করুন:\n\n{url}"),
        "account_deleted": ("[Haken Work] অ্যাকাউন্ট মুছে ফেলা হয়েছে", "হ্যালো {name},\n\nআপনার অ্যাকাউন্ট, প্রোফাইল, CV এবং আবেদন মুছে ফেলা হয়েছে।\nHaken Work ব্যবহারের জন্য ধন্যবাদ।"),
    },
}
ACCOUNT_TEMPLATES = frozenset(_A["ja"])

# Employer contact form (/employers).
# The auto-reply goes to an address typed by an anonymous visitor, so it repeats NOTHING the visitor wrote:
# the form cannot be used to send someone else a message of the sender's choosing.
_INQUIRY_REPLY: dict[str, tuple[str, str]] = {
    "ja": ("【ハケンワーク】お問い合わせを受け付けました",
           "このたびはハケンワークへお問い合わせいただき、誠にありがとうございます。\n"
           "内容を確認のうえ、担当者より2営業日以内にご連絡いたします。\n\n"
           "お心当たりのない場合は、このメールを破棄してください。"),
    "en": ("[Haken Work] We received your inquiry",
           "Thank you for contacting Haken Work.\n"
           "Our staff will review your inquiry and get back to you within 2 business days.\n\n"
           "If you did not send this inquiry, please ignore this email."),
    "vi": ("[Haken Work] Chúng tôi đã nhận được yêu cầu liên hệ",
           "Cảm ơn bạn đã liên hệ với Haken Work.\n"
           "Nhân viên phụ trách sẽ xem xét và phản hồi trong vòng 2 ngày làm việc.\n\n"
           "Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email."),
}


def build_inquiry_reply(to: str, locale: str, page: str = "employers") -> tuple[str, Mail]:
    loc = locale if locale in _INQUIRY_REPLY else "en"  # my/ne/bn: English (B2B mail, Japanese companies)
    subject, body = _INQUIRY_REPLY[loc]
    return loc, Mail(to=to, subject=subject, body=body + _NOREPLY[loc] + f"\n\n{settings.frontend_url}/{loc}/{page}")


def build_inquiry_notice(to: str, inq: EmployerInquiry, prefecture: str | None) -> Mail:
    """Internal notice (Japanese). Plain text: visitor input is shown as data, never as headers or HTML."""
    general = inq.kind == "general"
    lines = [
        "お問い合わせフォーム（/contact）から新しいお問い合わせがありました。" if general
        else "企業の方から新しいお問い合わせがありました。",
        "",
        f"会社名　　: {inq.company_name or '-'}",
        f"担当者名　: {inq.contact_name}",
        f"メール　　: {inq.email}",
        f"電話番号　: {inq.phone or '-'}",
        f"勤務地　　: {prefecture or '-'}",
        f"募集人数　: {inq.headcount or '-'}",
        f"言語　　　: {inq.locale}",
        "",
        "お問い合わせ内容:",
        inq.message,
        "",
        f"管理画面: {settings.frontend_url}/ja/admin/inquiries",
    ]
    head = f"お問い合わせ: {inq.contact_name}" if general else f"企業からのお問い合わせ: {inq.company_name}"
    return Mail(to=to, subject=_one_line(f"【ハケンワーク】{head}", 200),
                body="\n".join(lines))


def queue_mail(db: Session, mail: Mail, template: str, locale: str = "ja") -> tuple[uuid.UUID, Mail]:
    """Log + return for delivery after commit (any mail not tied to a user account)."""
    return _log(db, locale, mail, template)


def _one_line(s: str, limit: int = 120) -> str:
    return " ".join(s.split())[:limit]  # strips CR/LF/tabs: user-supplied text never shapes headers


def mask_email(email: str) -> str:
    """'taro.yamada@gmail.com' -> 'ta***@gmail.com' (enough for the owner to recognise, not to harvest)."""
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}"


def locale_of(user: User) -> str:
    return user.preferred_locale if user.preferred_locale in _T else "ja"


def display_name(user: User) -> str:
    p = user.profile
    return _one_line(f"{p.last_name} {p.first_name}" if p else "", 60) or user.email


def page_url(locale: str, path: str) -> str:
    return f"{settings.frontend_url}/{locale}/{path.lstrip('/')}"


# ------------------------------------------------------------------ builders
def build_status_mail(user: User, app_: Application, job_title: dict[str, str]) -> tuple[str, Mail]:
    locale = locale_of(user)
    subject, body = _T[locale][app_.status.value]
    job = _one_line(job_title.get(locale) or job_title.get("ja") or "", 80)
    text = body.format(name=display_name(user), job=job) + _FOOTER[locale].format(url=page_url(locale, "mypage"))
    return locale, Mail(to=user.email, subject=_one_line(subject, 200), body=text)


def build_account_mail(user: User, template: str, *, to: str | None = None, **values: object) -> tuple[str, Mail]:
    """Account email in the user's language. Values are formatted into fixed templates (no user HTML)."""
    locale = locale_of(user)
    subject, body = _A[locale][template]
    defaults = {"name": display_name(user), "url": "", "hours": "", "minutes": "", "email": ""}
    text = body.format(**{**defaults, **values}) + _NOREPLY[locale]
    return locale, Mail(to=to or user.email, subject=_one_line(subject, 200), body=text)


# ------------------------------------------------------------------ queue + deliver
def _log(db: Session, locale: str, mail: Mail, template: str, application_id: uuid.UUID | None = None) -> tuple[uuid.UUID, Mail]:
    row = EmailLog(to_email=mail.to, template=template, locale=locale, subject=mail.subject, application_id=application_id)
    db.add(row)
    db.flush()
    return row.id, mail


def queue_status_email(db: Session, user: User, app_: Application, job_title: dict[str, str]) -> tuple[uuid.UUID, Mail] | None:
    """Record the email in the caller's transaction. Returns (log_id, mail) to deliver after commit."""
    if app_.status not in NOTIFY_STATUSES:
        return None
    return queue_application_email(db, user, app_, job_title)


def queue_application_email(db: Session, user: User, app_: Application, job_title: dict[str, str]) -> tuple[uuid.UUID, Mail]:
    locale, mail = build_status_mail(user, app_, job_title)
    return _log(db, locale, mail, f"application_{app_.status.value}", app_.id)


def queue_account_email(db: Session, user: User, template: str, *, to: str | None = None,
                        **values: object) -> tuple[uuid.UUID, Mail]:
    locale, mail = build_account_mail(user, template, to=to, **values)
    return _log(db, locale, mail, template)


def _default_session() -> AbstractContextManager[Session]:
    from app.db import engine

    return Session(engine)


open_session: Callable[[], AbstractContextManager[Session]] = _default_session  # tests swap this


def deliver(log_id: uuid.UUID, mail: Mail) -> None:
    """Background task: send, then mark the log row sent/failed."""
    try:
        send(mail)
        status_, error = EmailStatus.SENT, None
    except Exception as e:  # noqa: BLE001 - recorded, never raised into the request
        log.warning("email %s failed", log_id, exc_info=True)
        status_, error = EmailStatus.FAILED, f"{type(e).__name__}: {e}"[:500]
    with open_session() as s:
        row = s.get(EmailLog, log_id)
        if row is not None:
            row.status = status_
            row.error = error
            row.sent_at = datetime.now(timezone.utc) if status_ == EmailStatus.SENT else None
            s.commit()


def deliver_unlogged(mail: Mail) -> None:
    """Background task for mail that must leave no trace (e.g. after account deletion)."""
    try:
        send(mail)
    except Exception:  # noqa: BLE001
        log.warning("unlogged email failed", exc_info=True)
