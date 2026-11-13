from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)


def get_db() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


DB = Annotated[Session, Depends(get_db)]
