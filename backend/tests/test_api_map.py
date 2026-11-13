"""API tests for the map / search endpoints (Phase 3), against the real DB inside a rolled-back transaction."""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.main import app, get_db
from app.models import Job, JobStatus, Role, RoleName, SalaryType, User

engine = create_engine(os.environ["DATABASE_URL"])


@pytest.fixture()
def ctx():
    conn = engine.connect()
    tx = conn.begin()
    s = Session(bind=conn, join_transaction_mode="create_savepoint")
    # Start every test from an empty jobs table (inside the transaction only).
    s.execute(text("DELETE FROM applications; DELETE FROM job_visa_types; DELETE FROM job_end_clients; DELETE FROM jobs"))
    rid = s.scalar(select(Role.id).where(Role.name == RoleName.RECRUITER))
    owner = User(email=f"{uuid.uuid4().hex[:8]}@example.com", role_id=rid)
    s.add(owner)
    s.flush()

    def add(pref: int, title: dict[str, str], status: JobStatus = JobStatus.PUBLISHED) -> Job:
        j = Job(job_code=f"T-{uuid.uuid4().hex[:10]}", title=title, description={"ja": "d"},
                salary_type=SalaryType.HOURLY, salary_min=1200, prefecture_id=pref,
                status=status, created_by=owner.id)
        s.add(j)
        s.flush()
        return j

    app.dependency_overrides[get_db] = lambda: s
    yield TestClient(app), add
    app.dependency_overrides.clear()
    s.close()
    tx.rollback()
    conn.close()


def test_counts_only_published_and_grouped(ctx):
    client, add = ctx
    add(13, {"ja": "東京A"}); add(13, {"ja": "東京B"}); add(27, {"ja": "大阪"})
    add(13, {"ja": "下書き"}, JobStatus.DRAFT); add(1, {"ja": "終了"}, JobStatus.ARCHIVED)
    r = client.get("/api/v1/stats/jobs-by-prefecture")
    assert r.status_code == 200
    assert r.json() == {"counts": {"13": 2, "27": 1}, "total": 3}
    assert "max-age=60" in r.headers["cache-control"]


def test_filter_by_prefecture_and_region(ctx):
    client, add = ctx
    add(13, {"ja": "東京"}); add(14, {"ja": "神奈川"}); add(27, {"ja": "大阪"})
    assert len(client.get("/api/v1/jobs?prefecture_id=13").json()) == 1
    kanto = client.get("/api/v1/jobs?region=kanto").json()
    assert sorted(j["prefecture"]["id"] for j in kanto) == [13, 14]
    assert client.get("/api/v1/jobs?region=hokkaido").json() == []


def test_keyword_matches_any_language(ctx):
    client, add = ctx
    add(13, {"ja": "倉庫内作業", "en": "Warehouse work", "vi": "Làm kho"})
    add(13, {"ja": "ホテル清掃", "en": "Hotel cleaning"})
    assert len(client.get("/api/v1/jobs", params={"q": "倉庫"}).json()) == 1
    assert len(client.get("/api/v1/jobs", params={"q": "warehouse"}).json()) == 1  # case-insensitive
    assert len(client.get("/api/v1/jobs", params={"q": "kho"}).json()) == 1


def test_like_wildcards_are_literal(ctx):
    client, add = ctx
    add(13, {"ja": "倉庫"}); add(13, {"ja": "ホテル"})
    # '%' or '_' must not turn into "match everything"
    assert client.get("/api/v1/jobs", params={"q": "%"}).json() == []
    assert client.get("/api/v1/jobs", params={"q": "_"}).json() == []
    # SQL-injection-looking input is just a literal string
    assert client.get("/api/v1/jobs", params={"q": "' OR 1=1 --"}).json() == []


@pytest.mark.parametrize("qs", ["prefecture_id=0", "prefecture_id=48", "region=KANTO", "region=x;drop",
                                "limit=500", "q=" + "a" * 101])
def test_invalid_params_rejected(ctx, qs):
    client, _ = ctx
    assert client.get(f"/api/v1/jobs?{qs}").status_code == 422
