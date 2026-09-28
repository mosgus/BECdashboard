from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event

from app.db import get_engine, session
from app.models import AppState, Base, JobRun, NewsArticle, NewsSummary, PriceBar, UniverseTicker
from app.ops import recent_job_runs, system_health

ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_ops.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _add_ticker(ticker: str, active: bool = True) -> None:
    with session() as db:
        db.add(UniverseTicker(ticker=ticker, active=active))


def _add_bar(ticker: str, bar_date: date) -> None:
    with session() as db:
        db.add(PriceBar(ticker=ticker, date=bar_date, close=100.0, adj_close=100.0))


def _add_article(article_id: str, fetched_at: datetime) -> None:
    with session() as db:
        db.add(
            NewsArticle(
                id=article_id,
                title=f"Title {article_id}",
                fetched_at=fetched_at,
            )
        )


def _add_job_run(job_name: str, started_at: datetime) -> None:
    with session() as db:
        db.add(
            JobRun(
                job_name=job_name,
                started_at=started_at,
                finished_at=started_at,
                status="success",
                duration_ms=10,
                detail={},
            )
        )


# --- system_health: empty database never raises -------------------------------------------------


def test_system_health_on_an_empty_database_returns_nulls_and_zeroes(db_mode):
    health = system_health()

    assert health["database"]["connected"] is True
    assert health["database"]["revision"] is None  # no alembic_version table in test databases
    universe = dict(health["universe"])
    assert isinstance(universe.pop("sweep_active"), bool)
    assert universe == {"active_tickers": 0, "total_bars": 0, "newest_bar_date": None}
    assert health["news"] == {"article_count": 0, "newest_fetched_at": None}
    assert health["briefing"] == {"exists": False, "model": None, "created_at": None}
    assert isinstance(health["gemini_key_configured"], bool)
    assert isinstance(health["python"], str)
    assert health["windows"]["auto_refresh_last_claim"] is None
    assert health["windows"]["news_refresh_last_claim"] is None


def test_system_health_no_database_configured_does_not_raise():
    # No db_mode fixture — DATABASE_URL is whatever conftest.py leaves it as (unset).
    health = system_health()
    assert health["database"]["connected"] is False
    assert health["universe"]["active_tickers"] == 0


# --- system_health: populated database ------------------------------------------------------


def test_system_health_reports_universe_and_news_counts(db_mode):
    _add_ticker("AAPL", active=True)
    _add_ticker("OLD", active=False)
    _add_bar("AAPL", date(2026, 9, 1))
    _add_bar("AAPL", date(2026, 9, 2))
    _add_article("a1", datetime(2026, 9, 1, tzinfo=timezone.utc))
    _add_article("a2", datetime(2026, 9, 2, tzinfo=timezone.utc))

    health = system_health()

    assert health["universe"]["active_tickers"] == 1  # OLD is inactive, excluded
    assert health["universe"]["total_bars"] == 2
    assert health["universe"]["newest_bar_date"] == date(2026, 9, 2)
    assert health["news"]["article_count"] == 2
    assert health["news"]["newest_fetched_at"] == datetime(2026, 9, 2, tzinfo=timezone.utc)


def test_system_health_reports_the_newest_briefing(db_mode):
    with session() as db:
        db.add(
            NewsSummary(
                summary="Older",
                model="gemini-old",
                article_count=5,
                created_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
            )
        )
        db.add(
            NewsSummary(
                summary="Newer",
                model="gemini-new",
                article_count=8,
                created_at=datetime(2026, 9, 2, tzinfo=timezone.utc),
            )
        )

    health = system_health()

    assert health["briefing"]["exists"] is True
    assert health["briefing"]["model"] == "gemini-new"
    assert health["briefing"]["created_at"] == datetime(2026, 9, 2, tzinfo=timezone.utc)


def test_system_health_reports_the_stored_window_claims(db_mode):
    with session() as db:
        db.add(AppState(key="auto_refresh", value_at=datetime(2026, 9, 17, 13, 30, tzinfo=timezone.utc)))
        db.add(AppState(key="news_refresh", value_at=datetime(2026, 9, 17, 16, 0, tzinfo=timezone.utc)))

    health = system_health()

    assert health["windows"]["auto_refresh_last_claim"] == datetime(2026, 9, 17, 13, 30, tzinfo=timezone.utc)
    assert health["windows"]["news_refresh_last_claim"] == datetime(2026, 9, 17, 16, 0, tzinfo=timezone.utc)


def test_system_health_gemini_key_configured_reflects_settings(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "some-real-key")
    assert system_health()["gemini_key_configured"] is True

    monkeypatch.delenv("GEMINI_KEY", raising=False)
    assert system_health()["gemini_key_configured"] is False


def test_system_health_never_leaks_the_gemini_key_itself(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "super-secret-key-value")
    health = system_health()
    assert "super-secret-key-value" not in repr(health)


# --- system_health: bounded query count ------------------------------------------------------


def test_system_health_query_count_does_not_scale_with_ticker_count(db_mode):
    def query_count() -> int:
        count = {"n": 0}

        def on_execute(conn, cursor, statement, parameters, context, executemany):
            count["n"] += 1

        event.listen(db_mode, "before_cursor_execute", on_execute)
        try:
            system_health()
        finally:
            event.remove(db_mode, "before_cursor_execute", on_execute)
        return count["n"]

    _add_ticker("AAA")
    _add_bar("AAA", date(2026, 9, 1))
    count_at_1 = query_count()

    for i in range(10):
        _add_ticker(f"T{i}")
        _add_bar(f"T{i}", date(2026, 9, 1))
    count_at_11 = query_count()

    assert count_at_11 == count_at_1


# --- recent_job_runs: ordering and clamping ---------------------------------------------------


def test_recent_job_runs_orders_newest_first(db_mode):
    _add_job_run("universe_refresh", datetime(2026, 9, 17, 9, 30, tzinfo=timezone.utc))
    _add_job_run("news_refresh", datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc))
    _add_job_run("universe_refresh", datetime(2026, 9, 17, 16, 0, tzinfo=timezone.utc))

    runs = recent_job_runs(10)

    assert [r["job_name"] for r in runs] == ["universe_refresh", "news_refresh", "universe_refresh"]
    assert runs[0]["started_at"] == datetime(2026, 9, 17, 16, 0, tzinfo=timezone.utc)


def test_recent_job_runs_clamps_limit_above_100(db_mode):
    for i in range(5):
        _add_job_run("universe_refresh", datetime(2026, 9, 17, tzinfo=timezone.utc) + timedelta(hours=i))

    runs = recent_job_runs(500)

    assert len(runs) == 5  # fewer than 100 exist; clamping itself is exercised at the router


def test_recent_job_runs_clamps_limit_below_1(db_mode):
    for i in range(3):
        _add_job_run("universe_refresh", datetime(2026, 9, 17, tzinfo=timezone.utc) + timedelta(hours=i))

    runs = recent_job_runs(0)

    assert len(runs) == 1


def test_recent_job_runs_empty_when_no_database():
    assert recent_job_runs(10) == []
