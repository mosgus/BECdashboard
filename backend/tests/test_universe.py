from datetime import date, datetime, timezone

import pandas as pd
import pytest
from sqlalchemy import event, func as sa_func, select as sa_select

from app.cache import clear, get_fundamentals, store, store_fundamentals
from app.db import get_engine, session
from app.models import Base, UniverseTicker
from app.universe import (
    AlreadyPresent,
    HISTORY_START,
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


@pytest.fixture(autouse=True)
def quotes_market_closed_by_default(monkeypatch):
    """list_all() now calls refresh_quotes_if_stale, which would otherwise decide whether to
    hit the real network based on the real wall-clock's actual market-hours state — exactly
    the kind of hidden real-network call the DATABASE_URL-stripping fixture in conftest.py
    exists to prevent on the database side. Reporting the market closed by default makes every
    existing test in this file deterministic and network-free regardless of when it happens to
    run; tests that specifically exercise quote behavior override this themselves.

    Patched in both namespaces, not just app.quotes: universe.py does `from app.quotes import
    is_market_open`, which binds its own independent name at import time. Patching only
    app.quotes.is_market_open leaves universe.py's _live_quote (and therefore current_price)
    reading the real, unpatched clock — this was discovered because it made a test flake
    against the real wall-clock's actual market state rather than the state it asked for."""
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: False)
    monkeypatch.setattr("app.universe.is_market_open", lambda now_et: False)


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


def _raising_symbol_has_history(*_args, **_kwargs):
    raise AssertionError("symbol_has_history must not be called here")


def _patch_add(
    monkeypatch,
    has_history: bool = True,
    fundamentals_overrides: dict | None = None,
    fundamentals_fake=None,
    history_capture=None,
):
    """Patch the three things add() calls, in universe.py's own namespace — symbol_has_history
    included, since add() now checks it before ever reaching fetch_history/fetch_fundamentals.
    Every existing test that exercises add() needs this, not just the ones added for this
    contract: without it, a fake ticker like "AAA" hits the real network."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: has_history)
    monkeypatch.setattr(
        "app.universe.fetch_fundamentals",
        fundamentals_fake or _make_fake_fetch_fundamentals(fundamentals_overrides),
    )
    monkeypatch.setattr(
        "app.universe.fetch_history", _make_fake_fetch_history(capture=history_capture)
    )


# --- 1. add on a new ticker ----------------------------------------------------------------


def test_add_new_ticker_creates_row_and_returns_detail(db_mode, monkeypatch):
    _patch_add(monkeypatch)

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


def test_add_fetches_from_history_start(db_mode, monkeypatch):
    """add() fetches from the fixed HISTORY_START anchor, not a rolling ten-years-back
    window."""
    captured: dict = {}
    _patch_add(monkeypatch, history_capture=captured)

    add("AAPL")

    assert captured["start"] == HISTORY_START
    assert captured["end"] is None


# --- 3. add on an already-active ticker -------------------------------------------------


def test_add_already_active_raises_and_does_not_refetch(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    monkeypatch.setattr("app.universe.symbol_has_history", _raising_symbol_has_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", _raising_fetch_history)

    with pytest.raises(AlreadyPresent):
        add("AAPL")


# --- 4. add on an unknown symbol ---------------------------------------------------------


def test_add_unknown_symbol_raises_and_leaves_no_row(db_mode, monkeypatch):
    """symbol_has_history is the sole authority now — False raises UnknownSymbol before
    fetch_history or fetch_fundamentals is ever reached."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: False)
    monkeypatch.setattr("app.universe.fetch_history", _raising_fetch_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)

    with pytest.raises(UnknownSymbol):
        add("NOTREAL")

    with session() as db:
        count = db.execute(sa_select(sa_func.count()).select_from(UniverseTicker)).scalar()
    assert count == 0


def test_add_unknown_symbol_overrides_a_populated_fundamentals_response(db_mode, monkeypatch):
    """History is the authority even when fundamentals would have looked fine — a case
    contract 0006's design couldn't distinguish, since it gated on fundamentals alone."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: False)
    monkeypatch.setattr("app.universe.fetch_history", _raising_fetch_history)
    monkeypatch.setattr(
        "app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals()
    )  # would happily "succeed" if ever called — it must not be

    with pytest.raises(UnknownSymbol):
        add("GHOST")


# --- 5. add on an inactive ticker reactivates it ----------------------------------------


def test_add_reactivates_inactive_ticker(db_mode, monkeypatch):
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=False))

    _patch_add(monkeypatch)

    result = add("aapl")
    assert result["ticker"] == "AAPL"

    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        assert row.active is True
        count = db.execute(sa_select(sa_func.count()).select_from(UniverseTicker)).scalar()
    assert count == 1  # reactivated in place, not duplicated


# --- 6 & 7. list_all: active only, ordered; empty universe returns [] ---------------------


def test_list_all_returns_only_active_ordered(db_mode, monkeypatch):
    _patch_add(monkeypatch)

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
    _patch_add(monkeypatch)

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
    # universe_tickers + ticker_fundamentals + price_bars aggregate + latest-non-null-close +
    # quotes.refresh_quotes_if_stale's own newest-fetched-at read + get_quotes — contract 0024
    # raised this bound from 3: "three is acceptable; per-ticker is not." What matters is the
    # equality assertion above, not this specific number.
    assert count_at_2 <= 6


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
    _patch_add(monkeypatch)
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
        "app.universe.refresh_ticker", lambda ticker, force=False, history_start=None: fake_summary
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

    _patch_add(monkeypatch, fundamentals_fake=fake_fetch_fundamentals)

    result = add("SPY")

    assert result["sector"] is None
    assert result["industry"] is None
    assert result["market_cap"] is None
    assert result["beta"] is None
    assert result["forward_pe"] is None
    assert result["regular_market_price"] == 650.0
    # Absent fields and an absent fundamentals row are different things — this ETF has both
    # real absent fields *and* a row (it was fetched successfully).
    assert result["has_fundamentals"] is True


# --- 13. dividend_yield passes through unscaled -------------------------------------------


def test_dividend_yield_passes_through_unscaled(db_mode, monkeypatch):
    data = _fundamentals("AAPL", dividend_yield=0.33)

    def fake_fetch_fundamentals(ticker: str) -> dict:
        store_fundamentals(ticker, data)
        return data

    _patch_add(monkeypatch, fundamentals_fake=fake_fetch_fundamentals)

    result = add("AAPL")

    assert result["dividend_yield"] == 0.33


# --- 14. list_all returns three new fields for an equity with real values -----------------


def test_list_all_returns_market_cap_trailing_pe_dividend_yield(db_mode, monkeypatch):
    _patch_add(monkeypatch)

    add("MSFT")

    entries = list_all()
    assert len(entries) == 1
    entry = entries[0]

    assert entry["market_cap"] == 1_000_000_000
    assert entry["trailing_pe"] == 20.0
    assert entry["dividend_yield"] == 0.33


# --- 15. list_all returns market_cap as None for ETF ------------------------------------


def test_list_all_etf_market_cap_is_none(db_mode, monkeypatch):
    etf_data = _fundamentals(
        "QQQ",
        market_cap=None,
        regular_market_price=350.0,
    )

    def fake_fetch_fundamentals(ticker: str) -> dict:
        store_fundamentals(ticker, etf_data)
        return etf_data

    _patch_add(monkeypatch, fundamentals_fake=fake_fetch_fundamentals)

    add("QQQ")

    entries = list_all()
    assert len(entries) == 1
    entry = entries[0]

    assert entry["market_cap"] is None
    assert entry["regular_market_price"] == 350.0


# --- 2. add succeeds when fetch_fundamentals returns None (best-effort) ------------------


def test_add_succeeds_when_fundamentals_unavailable(db_mode, monkeypatch):
    """The production bug this contract fixes: Yahoo's fundamentals endpoint can fail
    (crumb/401) while price history still works. add() must not treat that as a reason to
    reject the ticker — a membership row and price history are created; no fundamentals row
    is written, and none of that is an error."""
    _patch_add(monkeypatch, fundamentals_fake=lambda ticker: None)

    result = add("SPY")

    assert result["ticker"] == "SPY"
    assert result["bar_count"] == 2
    assert result["has_fundamentals"] is False
    assert result["short_name"] is None

    with session() as db:
        row = db.get(UniverseTicker, "SPY")
        assert row is not None
        assert row.active is True

    assert get_fundamentals("SPY") is None


# --- 8. list_all reports has_fundamentals accurately --------------------------------------


def test_list_all_reports_has_fundamentals(db_mode, monkeypatch):
    _patch_add(monkeypatch, fundamentals_fake=lambda ticker: None)
    add("SPY")  # fundamentals unavailable

    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: True)
    monkeypatch.setattr("app.universe.fetch_history", _make_fake_fetch_history())
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    add("AAPL")  # fundamentals available

    entries = {e["ticker"]: e for e in list_all()}
    assert entries["SPY"]["has_fundamentals"] is False
    assert entries["AAPL"]["has_fundamentals"] is True


# --- 9. refresh backfills fundamentals when absent, never refetches when present ---------


def test_refresh_backfills_fundamentals_when_absent(db_mode, monkeypatch):
    _patch_add(monkeypatch, fundamentals_fake=lambda ticker: None)
    add("SPY")
    assert get_fundamentals("SPY") is None

    monkeypatch.setattr(
        "app.universe.refresh_ticker",
        lambda ticker, force=False, history_start=None: {
            "ticker": "SPY",
            "action": "none",
            "last_session": None,
            "bars_before": 2,
            "bars_after": 2,
            "drift_detected": False,
        },
    )
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())

    result = refresh("SPY")

    assert get_fundamentals("SPY") is not None
    assert result["detail"]["has_fundamentals"] is True


def test_refresh_does_not_refetch_fundamentals_when_present(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")
    assert get_fundamentals("AAPL") is not None

    monkeypatch.setattr(
        "app.universe.refresh_ticker",
        lambda ticker, force=False, history_start=None: {
            "ticker": "AAPL",
            "action": "none",
            "last_session": None,
            "bars_before": 2,
            "bars_after": 2,
            "drift_detected": False,
        },
    )
    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)

    result = refresh("AAPL")  # must not raise — fetch_fundamentals must not be called

    assert result["detail"]["has_fundamentals"] is True


# --- 11. list_all includes current_price and last_close ------------------------------------


def test_list_all_current_price_populated_when_quote_fresh_and_market_open(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    def _raising_download_quotes(_tickers):
        raise AssertionError("a fresh quote must not trigger another fetch")

    # Both namespaces: universe.py's `from app.quotes import is_market_open` binds its own
    # name at import time, so app.universe.is_market_open is what _live_quote actually reads.
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)
    monkeypatch.setattr("app.universe.is_market_open", lambda now_et: True)
    monkeypatch.setattr("app.quotes._download_quotes", _raising_download_quotes)

    from app.cache import store_quotes

    now = datetime.now(timezone.utc)
    store_quotes({"AAPL": (123.45, now)}, now)

    entries = {e["ticker"]: e for e in list_all()}
    assert entries["AAPL"]["current_price"] == 123.45
    assert entries["AAPL"]["last_close"] == 101.0  # the newer of _history's default two bars
    assert entries["AAPL"]["quote_fetched_at"] == now


def test_list_all_current_price_null_when_quote_older_than_ttl(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: True)
    monkeypatch.setattr("app.universe.is_market_open", lambda now_et: True)
    monkeypatch.setattr("app.quotes._download_quotes", lambda tickers: pd.DataFrame())

    from datetime import timedelta

    from app.cache import store_quotes

    stale_fetch = datetime.now(timezone.utc) - timedelta(minutes=11)
    store_quotes({"AAPL": (123.45, stale_fetch)}, stale_fetch)

    entries = {e["ticker"]: e for e in list_all()}
    assert entries["AAPL"]["current_price"] is None
    assert entries["AAPL"]["last_close"] == 101.0
    # 6. quote_fetched_at agrees with current_price — null whenever current_price is null, even
    # though a quote row genuinely exists (it's just stale). A timestamp beside a price that
    # isn't a live quote would be a lie about what's on screen.
    assert entries["AAPL"]["quote_fetched_at"] is None


def test_list_all_quote_fetched_at_null_when_market_closed_even_with_fresh_quote(db_mode, monkeypatch):
    """The more common real-world case than staleness: outside market hours, a perfectly fresh
    quote still must not be shown as current — quote_fetched_at must agree and stay null too."""
    _patch_add(monkeypatch)
    add("AAPL")
    # Market closed by default via the autouse fixture — no override here.

    from app.cache import store_quotes

    now = datetime.now(timezone.utc)
    store_quotes({"AAPL": (123.45, now)}, now)

    entries = {e["ticker"]: e for e in list_all()}
    assert entries["AAPL"]["current_price"] is None
    assert entries["AAPL"]["quote_fetched_at"] is None
