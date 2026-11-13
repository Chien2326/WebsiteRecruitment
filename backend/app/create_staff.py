"""Create (or promote) a staff account from the command line — the only way to bootstrap the first super admin.

Usage:
  python -m app.create_staff <email> <role>          # prompts for the password
  roles: super_admin | recruiter_manager | content_editor | recruiter

The password can also come from STAFF_PASSWORD (for scripts). It is never echoed or logged.
"""

from __future__ import annotations

import getpass
import os
import sys

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.envfile import database_url

from app.models import Role, RoleName, User
from app.passwords import hash_password


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {r.value for r in RoleName} - {"candidate"}:
        print(__doc__)
        return 2
    email, role = argv[0].strip().lower(), RoleName(argv[1])
    password = os.environ.get("STAFF_PASSWORD") or getpass.getpass("Password (min 12 chars): ")
    if len(password) < 12:
        print("Password too short (staff accounts need at least 12 characters).")
        return 1
    engine = create_engine(database_url())
    with Session(engine) as s, s.begin():
        role_id = s.scalar(select(Role.id).where(Role.name == role))
        user = s.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            user = User(email=email, role_id=role_id, password_hash=hash_password(password), is_email_verified=True)
            s.add(user)
            action = "created"
        else:
            user.role_id, user.password_hash, user.is_active = role_id, hash_password(password), True
            action = "updated"
    print(f"{action}: {email} as {role.value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
