from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.autorefresh import (
    AUTO_REFRESH_KEY,
    MANUAL_JOB_NAME,
    _LOCK,
    is_sweep_active,
    run_manual_refresh,
    try_begin_manual_refresh,
)
from app.db import get_engine, session
from app.models import AppState, Base, JobRun, UniverseTicker

ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_autorefresh_manual.db")
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _add_ticker(ticker: str) -> None:
    with session() as db:
        db.add(UniverseTicker(ticker=ticker, active=True))


def _now() -> tuple[datetime, datetime]:
    now_et = datetime(2026, 9, 16, 10, 0, tzinfo=ET)
    return now_et.astimezone(timezone.utc), now_et


def _state() -> datetime | None:
    with session() as db:
        row = db.get(AppState, AUTO_REFRESH_KEY)
        if row is None:
            return None
        return row.value_at if row.value_at.tzinfo is not None else row.value_at.replace(tzinfo=timezone.utc)


def _latest_run() -> dict:
    with session() as db:
        row = db.execute(select(JobRun).order_by(JobRun.id.desc())).scalars().first()
        return {column.name: getattr(row, column.name) for column in JobRun.__table__.columns}


def _begin() -> None:
    assert try_begin_manual_refresh() is True


def test_try_begin_manual_refresh_returns_false_while_the_lock_is_held():
    _begin()
    try:
        assert try_begin_manual_refresh() is False
    finally:
        _LOCK.release()


def test_manual_refresh_releases_lock_after_normal_run(db_mode, monkeypatch):
    _add_ticker("AAPL")
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: None)
    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: {"action": "none"})
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: {})
    now_utc, now_et = _now()

    _begin()
    run_manual_refresh(now_utc, now_et)

    assert _LOCK.locked() is False


def test_manual_refresh_releases_lock_after_a_ticker_error(db_mode, monkeypatch):
    _add_ticker("AAPL")
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: None)
    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: {})
    now_utc, now_et = _now()

    _begin()
    run_manual_refresh(now_utc, now_et)

    assert _LOCK.locked() is False


def test_manual_refresh_releases_lock_after_a_quote_error(db_mode, monkeypatch):
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: None)
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: (_ for _ in ()).throw(RuntimeError("boom")))
    now_utc, now_et = _now()

    _begin()
    with pytest.raises(RuntimeError, match="boom"):
        run_manual_refresh(now_utc, now_et)

    assert _LOCK.locked() is False


def test_manual_refresh_without_database_releases_lock():
    now_utc, now_et = _now()
    _begin()
    run_manual_refresh(now_utc, now_et)
    assert _LOCK.locked() is False


def test_manual_refresh_clears_session_cache_refreshes_tickers_and_forces_quotes(db_mode, monkeypatch):
    _add_ticker("AAPL")
    _add_ticker("MSFT")
    cleared = []
    refreshed = []
    quote_calls = []
    stored = []
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: cleared.append(True))
    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: refreshed.append(ticker) or {"action": "none"})
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: quote_calls.append(tickers) or {"AAPL": {}})
    monkeypatch.setattr("app.autorefresh.store_quotes", lambda quotes, now: stored.append((quotes, now)))
    monkeypatch.setattr(
        "app.autorefresh.refresh_quotes_if_stale",
        lambda tickers: (_ for _ in ()).throw(AssertionError("manual refresh must force quotes")),
    )
    now_utc, now_et = _now()

    _begin()
    run_manual_refresh(now_utc, now_et)

    assert cleared == [True]
    assert refreshed == ["AAPL", "MSFT"]
    assert quote_calls == [["AAPL", "MSFT"]]
    assert stored == [({"AAPL": {}}, now_utc)]
    run = _latest_run()
    assert run["job_name"] == MANUAL_JOB_NAME
    assert run["detail"]["quotes"] == 1


def test_manual_refresh_claims_a_due_window(db_mode, monkeypatch):
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: None)
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: {})
    now_utc, now_et = _now()

    _begin()
    run_manual_refresh(now_utc, now_et)

    assert _state() == now_utc


def test_manual_refresh_keeps_an_existing_window_claim(db_mode, monkeypatch):
    _add_ticker("AAPL")
    now_utc, now_et = _now()
    claimed_at = datetime(2026, 9, 16, 14, 15, tzinfo=timezone.utc)
    refreshed = []
    with session() as db:
        db.add(AppState(key=AUTO_REFRESH_KEY, value_at=claimed_at))
    monkeypatch.setattr("app.autorefresh.clear_last_session_cache", lambda: None)
    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: refreshed.append(ticker) or {"action": "none"})
    monkeypatch.setattr("app.autorefresh.fetch_quotes", lambda tickers: {})

    _begin()
    run_manual_refresh(now_utc, now_et)

    assert _state() == claimed_at
    assert refreshed == ["AAPL"]
    assert _latest_run()["job_name"] == MANUAL_JOB_NAME


def test_is_sweep_active_covers_locked_due_claimed_and_disabled_states(db_mode):
    now_utc, now_et = _now()
    _begin()
    try:
        assert is_sweep_active(now_et) is True
    finally:
        _LOCK.release()

    assert is_sweep_active(now_et) is True
    with session() as db:
        db.add(AppState(key=AUTO_REFRESH_KEY, value_at=now_utc))
    assert is_sweep_active(now_et) is False


def test_is_sweep_active_is_false_without_database():
    _, now_et = _now()
    assert is_sweep_active(now_et) is False
