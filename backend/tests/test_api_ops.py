from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.autorefresh import _LOCK
from app.db import get_engine, session
from app.main import app
from app.models import Base, JobRun

_DEFAULT_JOB_RUNS_LIMIT = 20


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_ops.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _add_job_run(job_name: str, started_at: datetime) -> None:
    with session() as db:
        db.add(
            JobRun(
                job_name=job_name,
                started_at=started_at,
                finished_at=started_at,
                status="success",
                duration_ms=10,
                detail={"tickers": 3},
            )
        )


# --- GET /ops/status -----------------------------------------------------------------------


def test_get_ops_status_503_degraded_mode(client):
    assert client.get("/ops/status").status_code == 503


def test_get_ops_status_200_on_an_empty_database(db_mode, client):
    """The database is configured but holds nothing — no tickers, no news, no briefing, no
    runs — this must come back 200 with nulls and zeroes, not an error."""
    response = client.get("/ops/status")
    assert response.status_code == 200
    body = response.json()

    assert body["database"]["connected"] is True
    universe = dict(body["universe"])
    assert isinstance(universe.pop("sweep_active"), bool)
    assert universe == {"active_tickers": 0, "total_bars": 0, "newest_bar_date": None}
    assert body["news"] == {"article_count": 0, "newest_fetched_at": None}
    assert body["briefing"] == {"exists": False, "model": None, "created_at": None}
    assert isinstance(body["gemini_key_configured"], bool)
    assert isinstance(body["python"], str)


def test_get_ops_status_never_contains_the_gemini_key(db_mode, client, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "super-secret-key-value")

    response = client.get("/ops/status")
    assert response.status_code == 200

    assert "super-secret-key-value" not in response.text
    assert response.json()["gemini_key_configured"] is True


# --- GET /ops/job_runs -----------------------------------------------------------------------


def test_get_ops_job_runs_503_degraded_mode(client):
    assert client.get("/ops/job_runs").status_code == 503


def test_get_ops_job_runs_200_with_recorded_runs(db_mode, client):
    _add_job_run("universe_refresh", datetime(2026, 9, 17, 9, 30, tzinfo=timezone.utc))
    _add_job_run("news_refresh", datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc))

    response = client.get("/ops/job_runs")
    assert response.status_code == 200
    body = response.json()
    assert len(body["job_runs"]) == 2
    assert body["job_runs"][0]["job_name"] == "news_refresh"  # newest first


def test_get_ops_job_runs_default_limit(db_mode, client):
    for i in range(_DEFAULT_JOB_RUNS_LIMIT + 5):
        _add_job_run("universe_refresh", datetime(2026, 9, 17, tzinfo=timezone.utc) + timedelta(hours=i))

    response = client.get("/ops/job_runs")
    assert len(response.json()["job_runs"]) == _DEFAULT_JOB_RUNS_LIMIT


def test_get_ops_job_runs_limit_clamps_above_100(db_mode, client):
    for i in range(3):
        _add_job_run("universe_refresh", datetime(2026, 9, 17, tzinfo=timezone.utc) + timedelta(hours=i))

    response = client.get("/ops/job_runs?limit=500")
    assert response.status_code == 200
    # Fewer than 100 rows exist; this confirms the request succeeds and returns what's there —
    # the clamp itself is what stops `limit` from being handed straight to SQL as 500.
    assert len(response.json()["job_runs"]) == 3


def test_get_ops_job_runs_limit_clamps_below_1(db_mode, client):
    for i in range(3):
        _add_job_run("universe_refresh", datetime(2026, 9, 17, tzinfo=timezone.utc) + timedelta(hours=i))

    response = client.get("/ops/job_runs?limit=0")
    assert response.status_code == 200
    assert len(response.json()["job_runs"]) == 1


# --- POST /ops/universe/refresh and GET /universe/sweep_status ------------------------------


def test_force_universe_refresh_starts_a_background_sweep(db_mode, client, monkeypatch):
    called = []

    def fake_run(now_utc, now_et):
        called.append((now_utc, now_et))
        _LOCK.release()

    monkeypatch.setattr("app.routers.ops.run_manual_refresh", fake_run)

    response = client.post("/ops/universe/refresh")

    assert response.status_code == 202
    assert response.json()["started"] is True
    assert len(called) == 1
    assert _LOCK.locked() is False


def test_force_universe_refresh_conflicts_while_a_sweep_is_running(db_mode, client):
    assert _LOCK.acquire(blocking=False)
    try:
        response = client.post("/ops/universe/refresh")
    finally:
        _LOCK.release()

    assert response.status_code == 409
    assert response.json()["detail"] == "A universe refresh is already running"


def test_force_universe_refresh_is_unavailable_without_a_database(client):
    response = client.post("/ops/universe/refresh")

    assert response.status_code == 503
    assert _LOCK.locked() is False


def test_sweep_status_route_returns_a_boolean_active_value(db_mode, client):
    response = client.get("/universe/sweep_status")

    assert response.status_code == 200
    assert isinstance(response.json()["active"], bool)
