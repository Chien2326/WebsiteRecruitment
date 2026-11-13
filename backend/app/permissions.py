"""Permission-based RBAC.

Endpoints depend on *permissions*, never on role names, so a role's powers can change in one place.
Row-level scope: roles without `*.all` (the client-side recruiter) only see jobs they created and
applications to those jobs; that filter is applied inside the queries.

| permission              | super_admin | recruiter_manager | recruiter (own) | content_editor |
|-------------------------|:-----------:|:-----------------:|:---------------:|:--------------:|
| admin.access            |      x      |         x         |        x        |       x        |
| jobs.read / jobs.write  |      x      |         x         |        x        |                |
| jobs.approve            |      x      |         x         |                 |                |
| jobs.all                |      x      |         x         |                 |                |
| jobs.view_end_client    |      x      |         x         |        x        |                |
| applications.read/update|      x      |         x         |        x        |                |
| applications.all        |      x      |         x         |                 |                |
| resumes.read            |      x      |         x         |        x        |                |
| places.write / cms.write|      x      |                   |                 |       x        |
| users.manage            |      x      |                   |                 |                |
| inquiries.manage        |      x      |         x         |                 |                |

inquiries = employer contact-form leads (company + contact person): sales data, not for client recruiters.
"""

from __future__ import annotations

import enum
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.models import RoleName, User
from app.security import CurrentUser


class Perm(str, enum.Enum):
    ADMIN_ACCESS = "admin.access"
    JOBS_READ = "jobs.read"
    JOBS_WRITE = "jobs.write"
    JOBS_APPROVE = "jobs.approve"
    JOBS_ALL = "jobs.all"
    END_CLIENT_VIEW = "jobs.view_end_client"
    APPS_READ = "applications.read"
    APPS_UPDATE = "applications.update"
    APPS_ALL = "applications.all"
    RESUMES_READ = "resumes.read"
    PLACES_WRITE = "places.write"
    CMS_WRITE = "cms.write"
    USERS_MANAGE = "users.manage"
    INQUIRIES_MANAGE = "inquiries.manage"


_RECRUITING = {
    Perm.ADMIN_ACCESS, Perm.JOBS_READ, Perm.JOBS_WRITE, Perm.END_CLIENT_VIEW,
    Perm.APPS_READ, Perm.APPS_UPDATE, Perm.RESUMES_READ,
}

ROLE_PERMISSIONS: dict[RoleName, frozenset[Perm]] = {
    RoleName.SUPER_ADMIN: frozenset(Perm),
    RoleName.RECRUITER_MANAGER: frozenset(_RECRUITING | {Perm.JOBS_APPROVE, Perm.JOBS_ALL, Perm.APPS_ALL, Perm.INQUIRIES_MANAGE}),
    RoleName.RECRUITER: frozenset(_RECRUITING),
    RoleName.CONTENT_EDITOR: frozenset({Perm.ADMIN_ACCESS, Perm.PLACES_WRITE, Perm.CMS_WRITE}),
    RoleName.CANDIDATE: frozenset(),
}

STAFF_ROLES = frozenset(r for r, p in ROLE_PERMISSIONS.items() if Perm.ADMIN_ACCESS in p)


def perms_of(user: User) -> frozenset[Perm]:
    return ROLE_PERMISSIONS.get(user.role.name, frozenset())


def has(user: User, perm: Perm) -> bool:
    return perm in perms_of(user)


def require(*perms: Perm):
    """Dependency: the current user must hold ALL listed permissions (else 403)."""

    def dep(user: CurrentUser) -> User:
        if not set(perms) <= perms_of(user):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "forbidden"})
        return user

    return dep


# Ready-made dependency aliases (use as `user: JobsWriter`).
AdminAccess = Annotated[User, Depends(require(Perm.ADMIN_ACCESS))]
JobsReader = Annotated[User, Depends(require(Perm.JOBS_READ))]
JobsWriter = Annotated[User, Depends(require(Perm.JOBS_WRITE))]
AppsReader = Annotated[User, Depends(require(Perm.APPS_READ))]
AppsUpdater = Annotated[User, Depends(require(Perm.APPS_UPDATE))]
PlacesWriter = Annotated[User, Depends(require(Perm.PLACES_WRITE))]
CmsWriter = Annotated[User, Depends(require(Perm.CMS_WRITE))]
UsersManager = Annotated[User, Depends(require(Perm.USERS_MANAGE))]
InquiriesManager = Annotated[User, Depends(require(Perm.INQUIRIES_MANAGE))]
