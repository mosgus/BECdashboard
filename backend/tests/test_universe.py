from datetime import date, datetime, timezone

import pandas as pd
import pytest
from sqlalchemy import event, func as sa_func, select as sa_select

from app.cache import clear, store, store_fundamentals
from app.db import get_engine, session
from app.models import Base, UniverseTicker
from app.universe import (
    AlreadyPresent,
    HISTORY_YEARS,
    NotInUniverse,
    UnknownSymbol,
    add,
    get_one,
    list_all,
    refresh,
)


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_universe.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _fundamentals(ticker: str, **overrides) -> dict:
    base = {
        "ticker": ticker.upper(),
        "short_name": f"{ticker.upper()} Inc.",
        "long_name": f"{ticker.upper()} Incorporated",
        "sector": "Technology",
        "industry": "Software",
        "currency": "USD",
        "exchange": "NMS",
        "quote_type": "EQUITY",
        "regular_market_price": 100.0,
        "previous_close": 99.0,
        "market_cap": 1_000_000_000,
        "trailing_pe": 20.0,
        "forward_pe": 18.0,
        "dividend_yield": 0.33,
        "fifty_two_week_high": 120.0,
        "fifty_two_week_low": 80.0,
        "beta": 1.1,
        "average_volume": 1_000_000,
        "fetched_at": datetime(2026, 9, 13, tzinfo=timezone.utc),
    }
    base.update(overrides)
    return base


def _history(dates, adj_closes=None) -> pd.DataFrame:
    n = len(dates)
    index = pd.to_datetime(list(dates))
    index.name = "date"
    if adj_closes is None:
        adj_closes = [100.0 + i for i in range(n)]
    return pd.DataFrame(
        {
            "open": pd.array(adj_closes, dtype="float64"),
            "high": pd.array(adj_closes, dtype="float64"),
            "low": pd.array(adj_closes, dtype="float64"),
            "close": pd.array(adj_closes, dtype="float64"),
            "adj_close": pd.array(adj_closes, dtype="float64"),
            "volume": pd.array([1_000_000] * n, dtype="Int64"),
        },
        index=index,
    )


def _make_fake_fetch_fundamentals(overrides: dict | None = None, capture: list | None = None):
    def fake(ticker: str) -> dict:
        if capture is not None:
            capture.append(ticker)
        data = _fundamentals(ticker, **(overrides or {}))
        store_fundamentals(ticker, data)
        return data

    return fake


def _make_fake_fetch_history(
    dates=None, adj_closes=None, capture: dict | list | None = None
):
    dates = dates or ["2016-01-04", "2016-01-05"]

    def fake(ticker: str, start=None, end=None) -> pd.DataFrame:
        if isinstance(capture, list):
            capture.append((ticker, start, end))
        elif isinstance(capture, dict):
            capture["ticker"] = ticker
            capture["start"] = start
            capture["end"] = end
        df = _history(dates, adj_closes)
        store(ticker, df)
        return df

    return fake


def _raising_fetch_history(*_args, **_kwargs):
    raise AssertionError("fetch_history must not be called here")


def _raising_fetch_fundamentals(*_args, **_kwargs):
    raise AssertionError("fetch_fundamentals must not be called here")


# --- 1. add on a new ticker ----------------------------------------------------------------


def test_add_new_ticker_creates_row_and_returns_detail(db_mode, monkeypatch):
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    result = add("aapl")

    assert result["ticker"] == "AAPL"
    assert result["short_name"] == "AAPL Inc."
    assert result["bar_count"] == 2
    assert result["first_bar"] == date(2016, 1, 4)
    assert result["last_bar"] == date(2016, 1, 5)

    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        assert row is not None
        assert row.active is True


# --- 2. add fetches ten years of history, not the ~22-bar default --------------------------


def test_add_fetches_ten_years_of_history(db_mode, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr(
        "app.universe.fetch_history", _make_fake_fetch_history(capture=captured)
    )

    add("AAPL")

    assert captured["start"] is not None
    assert captured["end"] is None
    today = date.today()
    expected_start = today.replace(year=today.year - HISTORY_YEARS)
    assert captured["start"] == expected_start
    # ~10 years, not a bare-default ~22-bar window
    assert (today - captured["start"]).days > 3000


# --- 3. add on an already-active ticker -------------------------------------------------


def test_add_already_active_raises_and_does_not_refetch(db_mode, monkeypatch):
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())
    add("AAPL")

    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", _raising_fetch_history)

    with pytest.raises(AlreadyPresent):
        add("AAPL")


# --- 4. add on an unknown symbol ---------------------------------------------------------


def test_add_unknown_symbol_raises_and_leaves_no_row(db_mode, monkeypatch):
    def fake_fetch_fundamentals(ticker: str) -> dict:
        raise ValueError(f"Unknown symbol: {ticker}")

    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", _raising_fetch_history)

    with pytest.raises(UnknownSymbol):
        add("NOTREAL")

    with session() as db:
        count = db.execute(sa_select(sa_func.count()).select_from(UniverseTicker)).scalar()
    assert count == 0


# --- 5. add on an inactive ticker reactivates it ----------------------------------------


def test_add_reactivates_inactive_ticker(db_mode, monkeypatch):
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=False))

    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    result = add("aapl")
    assert result["ticker"] == "AAPL"

    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        assert row.active is True
        count = db.execute(sa_select(sa_func.count()).select_from(UniverseTicker)).scalar()
    assert count == 1  # reactivated in place, not duplicated


# --- 6 & 7. list_all: active only, ordered; empty universe returns [] ---------------------


def test_list_all_returns_only_active_ordered(db_mode, monkeypatch):
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    add("MSFT")
    add("AAPL")
    with session() as db:
        db.add(UniverseTicker(ticker="ZZZZ", active=False))

    entries = list_all()
    assert [e["ticker"] for e in entries] == ["AAPL", "MSFT"]


def test_list_all_empty_universe_returns_empty_list(db_mode):
    assert list_all() == []


# --- 8. list_all issues a bounded number of queries, not one per ticker -------------------


def test_list_all_query_count_does_not_scale_with_ticker_count(db_mode, monkeypatch):
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    def query_count_for_list_all() -> int:
        count = {"n": 0}

        def on_execute(conn, cursor, statement, parameters, context, executemany):
            count["n"] += 1

        event.listen(db_mode, "before_cursor_execute", on_execute)
        try:
            list_all()
        finally:
            event.remove(db_mode, "before_cursor_execute", on_execute)
        return count["n"]

    add("AAA")
    add("BBB")
    count_at_2 = query_count_for_list_all()

    for i in range(8):
        add(f"T{i}")
    count_at_10 = query_count_for_list_all()

    assert count_at_2 == count_at_10
    assert count_at_2 <= 3  # universe_tickers + ticker_fundamentals + price_bars aggregate


def test_list_all_membership_without_fundamentals_row(db_mode):
    """A membership row can exist before fundamentals have ever been fetched. list_all()
    must not crash — fundamentals fields come back None, price fields reflect whatever
    price_bars actually has (nothing, here)."""
    with session() as db:
        db.add(UniverseTicker(ticker="ORPHAN", active=True))

    entries = list_all()

    assert len(entries) == 1
    assert entries[0]["ticker"] == "ORPHAN"
    assert entries[0]["short_name"] is None
    assert entries[0]["regular_market_price"] is None
    assert entries[0]["bar_count"] == 0
    assert entries[0]["first_bar"] is None


# --- 9. get_one raises NotInUniverse for absent or inactive -------------------------------


def test_get_one_raises_not_in_universe_for_absent_or_inactive(db_mode):
    with pytest.raises(NotInUniverse):
        get_one("NOPE")

    with session() as db:
        db.add(UniverseTicker(ticker="ZZZZ", active=False))

    with pytest.raises(NotInUniverse):
        get_one("ZZZZ")


# --- 10. refresh raises NotInUniverse for a ticker not in the universe --------------------


def test_refresh_raises_not_in_universe(db_mode):
    with pytest.raises(NotInUniverse):
        refresh("NOPE")


# --- 11. refresh returns refresh_ticker's action verbatim, never recomputed ---------------


def test_refresh_returns_refresh_ticker_action_verbatim(db_mode, monkeypatch):
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())
    add("AAPL")

    fake_summary = {
        "ticker": "AAPL",
        "action": "definitely-not-a-real-action-marker",
        "last_session": date(2026, 9, 9),
        "bars_before": 5,
        "bars_after": 5,
        "drift_detected": False,
    }
    monkeypatch.setattr(
        "app.universe.refresh_ticker", lambda ticker, force=False: fake_summary
    )

    result = refresh("AAPL")

    assert result["action"] == "definitely-not-a-real-action-marker"
    assert result["bars_before"] == 5
    assert result["bars_after"] == 5
    assert "detail" in result
    assert result["detail"]["ticker"] == "AAPL"


# --- 12. ETF entry round-trips with the five ETF-absent fields all None ------------------


def test_etf_entry_round_trips_with_none_fields(db_mode, monkeypatch):
    etf_data = _fundamentals(
        "SPY",
        sector=None,
        industry=None,
        market_cap=None,
        beta=None,
        forward_pe=None,
        regular_market_price=650.0,
    )

    def fake_fetch_fundamentals(ticker: str) -> dict:
        store_fundamentals(ticker, etf_data)
        return etf_data

    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    result = add("SPY")

    assert result["sector"] is None
    assert result["industry"] is None
    assert result["market_cap"] is None
    assert result["beta"] is None
    assert result["forward_pe"] is None
    assert result["regular_market_price"] == 650.0


# --- 13. dividend_yield passes through unscaled -------------------------------------------


def test_dividend_yield_passes_through_unscaled(db_mode, monkeypatch):
    data = _fundamentals("AAPL", dividend_yield=0.33)

    def fake_fetch_fundamentals(ticker: str) -> dict:
        store_fundamentals(ticker, data)
        return data

    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())

    result = add("AAPL")

    assert result["dividend_yield"] == 0.33
