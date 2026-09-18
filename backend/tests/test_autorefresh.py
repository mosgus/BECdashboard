from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.autorefresh import (
    AUTO_REFRESH_KEY,
    _LOCK,
    active_universe_tickers,
    run_auto_refresh_if_due,
)
from app.db import get_engine, session
from app.models import AppState, Base, JobRun, UniverseTicker
from sqlalchemy import func, select

ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_autorefresh.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _add_ticker(ticker: str, active: bool = True) -> None:
    with session() as db:
        db.add(UniverseTicker(ticker=ticker, active=active))


def _state_value_at() -> datetime | None:
    """SQLite hands DateTime(timezone=True) back naive; relabel as UTC the same way
    app.autorefresh._get_state does, since value_at is always written as a UTC value."""
    with session() as db:
        row = db.get(AppState, AUTO_REFRESH_KEY)
        if row is None:
            return None
        value_at = row.value_at
        return value_at if value_at.tzinfo is not None else value_at.replace(tzinfo=timezone.utc)


def _window_open_et(hour: int = 10, minute: int = 0) -> datetime:
    # 2026-09-16 is a Wednesday — inside the 09:30 window at 10:00.
    return datetime(2026, 9, 16, hour, minute, tzinfo=ET)


def _job_run_count() -> int:
    with session() as db:
        return db.execute(select(func.count()).select_from(JobRun)).scalar()


def _latest_job_run() -> JobRun | None:
    with session() as db:
        row = db.execute(select(JobRun).order_by(JobRun.id.desc()).limit(1)).scalars().first()
        if row is None:
            return None
        return {col.name: getattr(row, col.name) for col in JobRun.__table__.columns}


# --- active_universe_tickers -----------------------------------------------------------------


def test_active_universe_tickers_excludes_inactive(db_mode):
    _add_ticker("AAPL", active=True)
    _add_ticker("OLD", active=False)
    assert active_universe_tickers() == ["AAPL"]


def test_active_universe_tickers_empty_when_no_database():
    assert active_universe_tickers() == []


# --- run_auto_refresh_if_due: no-op paths ------------------------------------------------------


def test_run_auto_refresh_noop_when_no_database():
    # No db_mode fixture — DATABASE_URL is whatever conftest.py leaves it as (unset).
    run_auto_refresh_if_due(datetime.now(timezone.utc), datetime.now(ET))  # must not raise


def test_run_auto_refresh_noop_outside_a_window(db_mode, monkeypatch):
    _add_ticker("AAPL")

    def _fail_if_called(ticker, *a, **k):
        raise AssertionError("refresh must not be called outside a window")

    monkeypatch.setattr("app.autorefresh.refresh", _fail_if_called)

    now_et = datetime(2026, 9, 16, 8, 0, tzinfo=ET)  # before 09:30
    run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    assert _state_value_at() is None
    assert _job_run_count() == 0


def test_run_auto_refresh_noop_when_already_claimed_this_window(db_mode, monkeypatch):
    now_et = _window_open_et()
    now_utc = now_et.astimezone(timezone.utc)

    with session() as db:
        db.add(AppState(key=AUTO_REFRESH_KEY, value_at=now_utc))

    def _fail_if_called(ticker, *a, **k):
        raise AssertionError("refresh must not be called when the window is already claimed")

    monkeypatch.setattr("app.autorefresh.refresh", _fail_if_called)
    monkeypatch.setattr(
        "app.autorefresh.refresh_quotes_if_stale",
        lambda tickers: (_ for _ in ()).throw(AssertionError("must not run either")),
    )

    _add_ticker("AAPL")
    run_auto_refresh_if_due(now_utc, now_et + timedelta(minutes=5))

    assert _job_run_count() == 0


# --- claim-first: the timestamp is written before the sweep, not after ------------------------


def test_timestamp_is_written_before_the_sweep_even_if_the_first_ticker_raises(db_mode, monkeypatch):
    """Assert on stored state, not on source order: a refresh stub that raises on the very
    first ticker must still leave app_state holding the new timestamp — proving the claim was
    written before the sweep ran, not after it completed."""
    _add_ticker("AAPL")
    _add_ticker("MSFT")

    def _raise(ticker, *a, **k):
        raise RuntimeError(f"boom: {ticker}")

    monkeypatch.setattr("app.autorefresh.refresh", _raise)
    monkeypatch.setattr("app.autorefresh.refresh_quotes_if_stale", lambda tickers: None)

    now_et = _window_open_et()
    now_utc = now_et.astimezone(timezone.utc)
    run_auto_refresh_if_due(now_utc, now_et)

    assert _state_value_at() == now_utc


# --- failure isolation: one ticker raising must not stop the rest -----------------------------


def test_one_ticker_raising_does_not_stop_the_next_ticker_from_running(db_mode, monkeypatch):
    _add_ticker("AAPL")
    _add_ticker("MSFT")

    called = []

    def fake_refresh(ticker):
        called.append(ticker)
        if ticker == "AAPL":
            raise RuntimeError("boom")
        return {"ticker": ticker}

    monkeypatch.setattr("app.autorefresh.refresh", fake_refresh)
    monkeypatch.setattr("app.autorefresh.refresh_quotes_if_stale", lambda tickers: None)

    now_et = _window_open_et()
    run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    assert called == ["AAPL", "MSFT"]


# --- the quote refresh at the end --------------------------------------------------------------


def test_run_auto_refresh_calls_refresh_quotes_if_stale_with_the_ticker_list(db_mode, monkeypatch):
    _add_ticker("AAPL")
    _add_ticker("MSFT")

    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: {"ticker": ticker})

    calls = []
    monkeypatch.setattr("app.autorefresh.refresh_quotes_if_stale", lambda tickers: calls.append(tickers))

    now_et = _window_open_et()
    run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    assert calls == [["AAPL", "MSFT"]]


# --- _LOCK: one sweep at a time per process -----------------------------------------------------


def test_second_call_returns_without_fetching_while_the_lock_is_held(db_mode, monkeypatch):
    _add_ticker("AAPL")

    called = []
    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: called.append(ticker))

    assert _LOCK.acquire(blocking=False)
    try:
        now_et = _window_open_et()
        run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)
    finally:
        _LOCK.release()

    assert called == []


def test_lock_is_released_after_the_body_raises(db_mode, monkeypatch):
    """Force an exception from somewhere the per-ticker try/except does not shield — the sweep
    body's failure isolation is deliberately narrow to just refresh(ticker) — and confirm the
    lock is free again afterwards, proving the finally: block ran."""
    _add_ticker("AAPL")

    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: {"ticker": ticker})
    monkeypatch.setattr(
        "app.autorefresh.refresh_quotes_if_stale",
        lambda tickers: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    now_et = _window_open_et()
    with pytest.raises(RuntimeError, match="boom"):
        run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    assert _LOCK.acquire(blocking=False)
    _LOCK.release()


# --- job_runs recording (contract 0044) ---------------------------------------------------------


def test_one_ticker_raising_records_partial_with_that_ticker_in_errors(db_mode, monkeypatch):
    _add_ticker("AAPL")
    _add_ticker("MSFT")

    called = []

    def fake_refresh(ticker):
        called.append(ticker)
        if ticker == "AAPL":
            raise RuntimeError("boom")
        return {"ticker": ticker, "action": "updated"}

    monkeypatch.setattr("app.autorefresh.refresh", fake_refresh)
    monkeypatch.setattr("app.autorefresh.refresh_quotes_if_stale", lambda tickers: None)

    now_et = _window_open_et()
    run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    assert called == ["AAPL", "MSFT"]  # the other ticker still refreshed
    run = _latest_job_run()
    assert run is not None
    assert run["job_name"] == "universe_refresh"
    assert run["status"] == "partial"
    assert run["detail"]["errors"] == ["AAPL"]
    assert run["detail"]["tickers"] == 2
    assert run["detail"]["refreshed"] == 1


def test_a_body_that_raises_records_failure_and_still_reraises(db_mode, monkeypatch):
    _add_ticker("AAPL")

    monkeypatch.setattr("app.autorefresh.refresh", lambda ticker: {"ticker": ticker, "action": "none"})
    monkeypatch.setattr(
        "app.autorefresh.refresh_quotes_if_stale",
        lambda tickers: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    now_et = _window_open_et()
    with pytest.raises(RuntimeError, match="boom"):
        run_auto_refresh_if_due(now_et.astimezone(timezone.utc), now_et)

    run = _latest_job_run()
    assert run is not None
    assert run["job_name"] == "universe_refresh"
    assert run["status"] == "failure"
    assert run["detail"]["error"]["type"] == "RuntimeError"
    assert "boom" in run["detail"]["error"]["message"]
