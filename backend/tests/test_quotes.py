from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from app.cache import store_quotes
from app.db import get_engine
from app.models import Base
from app.quotes import _LOCK, fetch_quotes, is_market_open, needs_refresh, refresh_quotes_if_stale


@pytest.fixture(autouse=True)
def isolated_from_ambient_database(monkeypatch):
    """This module exercises fetch_quotes/refresh_quotes_if_stale directly with no intent to
    touch a real database — conftest.py's own autouse fixture already strips DATABASE_URL for
    every test, this just documents why that matters here specifically."""
    monkeypatch.delenv("DATABASE_URL", raising=False)


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_quotes.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _multi_ticker_frame(closes: dict[str, list], index: pd.DatetimeIndex) -> pd.DataFrame:
    """Mimics yf.download's multi-ticker column shape: a MultiIndex with 'Close' at the top
    level and the ticker at the second, exactly what fetch_quotes reads."""
    df = pd.DataFrame({ticker: values for ticker, values in closes.items()}, index=index)
    df.columns = pd.MultiIndex.from_product([["Close"], list(closes.keys())])
    return df


# --- 1. is_market_open -----------------------------------------------------------------------


def test_is_market_open_at_various_times():
    # 2026-09-15 is a Tuesday; 2026-09-19 a Saturday; 2026-09-20 a Sunday.
    assert is_market_open(datetime(2026, 9, 15, 10, 0)) is True
    assert is_market_open(datetime(2026, 9, 15, 9, 29)) is False
    assert is_market_open(datetime(2026, 9, 15, 16, 0)) is False
    assert is_market_open(datetime(2026, 9, 15, 20, 0)) is False
    assert is_market_open(datetime(2026, 9, 19, 11, 0)) is False
    assert is_market_open(datetime(2026, 9, 20, 11, 0)) is False


# --- 2-4. needs_refresh -----------------------------------------------------------------------


def test_needs_refresh_false_outside_market_hours_even_with_no_quote(monkeypatch):
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: False)
    now_utc = datetime(2026, 9, 15, 23, 0, tzinfo=timezone.utc)
    now_et = datetime(2026, 9, 15, 19, 0)
    assert needs_refresh(None, now_utc, now_et) is False


def test_needs_refresh_true_during_hours_when_no_quote_exists(monkeypatch):
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)
    now_utc = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    now_et = datetime(2026, 9, 15, 10, 0)
    assert needs_refresh(None, now_utc, now_et) is True


def test_needs_refresh_true_at_11_minutes_false_at_9(monkeypatch):
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)
    now_utc = datetime(2026, 9, 15, 14, 0, tzinfo=timezone.utc)
    now_et = datetime(2026, 9, 15, 10, 0)
    assert needs_refresh(now_utc - timedelta(minutes=11), now_utc, now_et) is True
    assert needs_refresh(now_utc - timedelta(minutes=9), now_utc, now_et) is False


# --- 5-7. fetch_quotes -------------------------------------------------------------------------


def test_fetch_quotes_issues_exactly_one_download_call(monkeypatch):
    calls = []
    index = pd.date_range("2026-09-15 09:30", periods=2, freq="1min", tz="America/New_York")

    def fake_download(tickers):
        calls.append(list(tickers))
        return _multi_ticker_frame({"AAPL": [100.0, 100.5], "MSFT": [200.0, 200.5]}, index)

    monkeypatch.setattr("app.quotes._download_quotes", fake_download)

    result = fetch_quotes(["AAPL", "MSFT"])

    assert len(calls) == 1
    assert calls[0] == ["AAPL", "MSFT"]
    assert set(result.keys()) == {"AAPL", "MSFT"}


def test_fetch_quotes_omits_ticker_missing_from_response(monkeypatch):
    index = pd.date_range("2026-09-15 09:30", periods=2, freq="1min", tz="America/New_York")
    frame = _multi_ticker_frame({"AAPL": [100.0, 100.5]}, index)  # MSFT entirely absent
    monkeypatch.setattr("app.quotes._download_quotes", lambda tickers: frame)

    result = fetch_quotes(["AAPL", "MSFT"])

    assert "AAPL" in result
    assert "MSFT" not in result


def test_fetch_quotes_takes_last_non_null_price(monkeypatch):
    index = pd.date_range("2026-09-15 09:30", periods=3, freq="1min", tz="America/New_York")
    frame = _multi_ticker_frame({"AAPL": [100.0, 101.5, float("nan")]}, index)
    monkeypatch.setattr("app.quotes._download_quotes", lambda tickers: frame)

    result = fetch_quotes(["AAPL"])

    price, as_of = result["AAPL"]
    assert price == 101.5
    assert as_of == index[1].to_pydatetime()


# --- 13. refresh_quotes_if_stale is a no-op with no database configured ----------------------


def test_refresh_quotes_if_stale_noop_with_no_database(monkeypatch):
    def _raising_download(_tickers):
        raise AssertionError("must not fetch when no database is configured")

    monkeypatch.setattr("app.quotes._download_quotes", _raising_download)

    refresh_quotes_if_stale(["AAPL"])  # must not raise, must not fetch


# --- contract 0051: gated on a claim, not MAX(fetched_at) over ticker_quotes rows -----------


def test_refresh_fetches_when_a_new_ticker_has_no_quote_row_but_another_is_fresh(db_mode, monkeypatch):
    """The exact bug: MAX(fetched_at) over rows contributes nothing for a ticker with no row
    at all, so a batch with one fresh-quoted ticker and one brand-new one used to read as
    "not stale" and skip the new ticker until every other ticker's TTL lapsed too. The
    attempt-based claim has no such blind spot — a stale/absent attempt still triggers a
    fetch regardless of what any individual ticker's row says."""
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)

    now = datetime.now(timezone.utc)
    store_quotes({"AAPL": (100.0, now)}, now)  # AAPL already has a fresh quote row
    # MSFT has no quote row at all, and no prior refresh attempt was ever claimed.

    calls = []

    def fake_download(tickers):
        calls.append(list(tickers))
        return pd.DataFrame()

    monkeypatch.setattr("app.quotes._download_quotes", fake_download)

    refresh_quotes_if_stale(["AAPL", "MSFT"])

    assert calls == [["AAPL", "MSFT"]]


def test_refresh_two_calls_inside_one_ttl_window_produce_exactly_one_fetch(db_mode, monkeypatch):
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)

    calls = []

    def fake_download(tickers):
        calls.append(list(tickers))
        return pd.DataFrame()

    monkeypatch.setattr("app.quotes._download_quotes", fake_download)

    refresh_quotes_if_stale(["AAPL"])
    refresh_quotes_if_stale(["AAPL"])

    assert len(calls) == 1


def test_refresh_quotes_lock_prevents_concurrent_fetch(db_mode, monkeypatch):
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)

    called = []
    monkeypatch.setattr("app.quotes._download_quotes", lambda tickers: called.append(tickers) or pd.DataFrame())

    assert _LOCK.acquire(blocking=False)
    try:
        refresh_quotes_if_stale(["AAPL"])
    finally:
        _LOCK.release()

    assert called == []
