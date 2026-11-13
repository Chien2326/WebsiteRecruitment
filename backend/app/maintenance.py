"""Periodic clean-up. Run once a day (Windows Task Scheduler / cron / a k8s CronJob):

    python -m app.maintenance              # delete
    python -m app.maintenance --dry-run    # only count what would be deleted

What goes (retention can be tuned with environment variables):
  * refresh tokens that expired or were revoked more than 7 days ago (reuse detection needs them a short while)
  * one-time email links (user_tokens) that expired or were used more than 7 days ago
  * contact-form inquiries marked "closed" more than INQUIRY_RETENTION_DAYS ago (default 365) - APPI: personal
    data is not kept longer than needed; their address in email_logs is redacted the same way as a manual delete
  * email_logs older than EMAIL_LOG_RETENTION_DAYS (default 730)
Kept on purpose: resume_access_logs (audit trail) and application status history.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.envfile import database_url
from app.models import EmailLog, EmployerInquiry, RefreshToken, UserToken

GRACE = timedelta(days=7)


def _days(name: str, default: int) -> timedelta:
    return timedelta(days=int(os.environ.get(name) or default))


def run(session: Session, *, dry_run: bool = False, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    old = now - GRACE
    inquiry_cutoff = now - _days("INQUIRY_RETENTION_DAYS", 365)
    email_cutoff = now - _days("EMAIL_LOG_RETENTION_DAYS", 730)

    targets = {
        "refresh_tokens": (RefreshToken, or_(RefreshToken.expires_at < old, RefreshToken.revoked_at < old)),
        "user_tokens": (UserToken, or_(UserToken.expires_at < old, UserToken.used_at < old)),
        "inquiries_closed": (EmployerInquiry, (EmployerInquiry.status == "closed") & (EmployerInquiry.updated_at < inquiry_cutoff)),
        "email_logs": (EmailLog, EmailLog.created_at < email_cutoff),
    }
    counts = {name: session.scalar(select(func.count()).select_from(model).where(cond)) or 0
              for name, (model, cond) in targets.items()}
    if dry_run:
        return counts

    # inquiries first: redact the auto-reply address before the rows that point to it are gone
    old_inq = select(EmployerInquiry.email).where(targets["inquiries_closed"][1])
    session.execute(update(EmailLog).where(EmailLog.template == "employer_inquiry_reply", EmailLog.to_email.in_(old_inq))
                    .values(to_email="(deleted)"))
    for model, cond in targets.values():
        session.execute(delete(model).where(cond))
    session.commit()
    return counts


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    # connect_timeout: fail fast (and get logged) when the database is not running, instead of hanging.
    with Session(create_engine(database_url(), connect_args={"connect_timeout": 10})) as s:
        counts = run(s, dry_run=dry)
    verb = "would delete" if dry else "deleted"
    print(f"maintenance: {verb} " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
