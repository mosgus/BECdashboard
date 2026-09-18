from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest
from sqlalchemy import event, func as sa_func, select as sa_select

from app.cache import clear, get_cached, get_fundamentals, store, store_fundamentals
from app.db import get_engine, session
from app.models import AppState, Base, NewsArticle, PriceBar, TickerFundamentals, TickerQuote, UniverseTicker
from app.universe import (
    AlreadyPresent,
    HISTORY_START,
    HistoryUnavailable,
    NotInUniverse,
    UnknownSymbol,
    _fundamentals_incomplete,
    add,
    get_one,
    list_all,
    refresh,
    remove,
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


def _raising_refresh_ticker(*_args, **_kwargs):
    raise AssertionError("refresh_ticker must not be called here")


def _empty_fetch_history(ticker: str, start=None, end=None) -> pd.DataFrame:
    """Simulates a transient Yahoo hiccup: the symbol validates, but the history fetch itself
    comes back with no rows. Stores the empty frame, exactly like the real fetch_history does
    unconditionally — this is what makes cache.evict load-bearing in add()."""
    df = _history([])
    store(ticker, df)
    return df


def _noop_refresh_ticker(ticker, force=False, history_start=None):
    return {
        "ticker": ticker,
        "action": "none",
        "last_session": None,
        "bars_before": 0,
        "bars_after": 0,
        "drift_detected": False,
    }


def _patch_add(
    monkeypatch,
    has_history: bool = True,
    fundamentals_overrides: dict | None = None,
    fundamentals_fake=None,
    history_capture=None,
    refresh_ticker_fake=None,
):
    """Patch the four things add() calls, in universe.py's own namespace — symbol_has_history
    included, since add() now checks it before ever reaching fetch_history/fetch_fundamentals,
    and refresh_ticker included since contract 0042 has add() call it (to catch a
    post-16:00-ET add up to the current session) before writing the membership row. Every
    existing test that exercises add() needs this, not just the ones added for this contract:
    without it, a fake ticker like "AAA" hits the real network."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: has_history)
    monkeypatch.setattr(
        "app.universe.fetch_fundamentals",
        fundamentals_fake or _make_fake_fetch_fundamentals(fundamentals_overrides),
    )
    monkeypatch.setattr(
        "app.universe.fetch_history", _make_fake_fetch_history(capture=history_capture)
    )
    monkeypatch.setattr(
        "app.universe.refresh_ticker", refresh_ticker_fake or _noop_refresh_ticker
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
    monkeypatch.setattr("app.universe.last_completed_session", lambda: date(2026, 9, 17))

    add("AAPL")

    assert captured["start"] == HISTORY_START
    assert captured["end"] == date(2026, 9, 17)


def test_add_passes_end_equal_to_last_completed_session(db_mode, monkeypatch):
    """Contract 0053: end is bounded to the last completed session, never None — an
    unbounded fetch during market hours would store today's in-progress bar as though it
    were a finished session."""
    captured: dict = {}
    _patch_add(monkeypatch, history_capture=captured)
    monkeypatch.setattr("app.universe.last_completed_session", lambda: date(2026, 3, 3))

    add("AAPL")

    assert captured["end"] == date(2026, 3, 3)


def test_add_falls_back_to_yesterday_when_last_completed_session_is_none(db_mode, monkeypatch):
    """When the reference fetch behind last_completed_session fails and returns None, the
    fallback is yesterday, never today — falling back to end=None would reintroduce the exact
    bug this contract removes."""
    captured: dict = {}
    _patch_add(monkeypatch, history_capture=captured)
    monkeypatch.setattr("app.universe.last_completed_session", lambda: None)

    add("AAPL")

    assert captured["end"] is not None
    assert captured["end"] == date.today() - timedelta(days=1)


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


# --- add refuses a zero-bar fetch (contract 0042) ------------------------------------------


def test_add_raises_history_unavailable_and_leaves_no_row_when_fetch_returns_empty(
    db_mode, monkeypatch
):
    """The central test: symbol_has_history says the symbol is real, but fetch_history comes
    back empty — one transient Yahoo hiccup is enough. add() must refuse rather than write a
    membership row nothing could ever repair, and must never reach fetch_fundamentals or
    refresh_ticker once it has."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: True)
    monkeypatch.setattr("app.universe.fetch_history", _empty_fetch_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)
    monkeypatch.setattr("app.universe.refresh_ticker", _raising_refresh_ticker)

    with pytest.raises(HistoryUnavailable):
        add("GHOST")

    with session() as db:
        count = db.execute(sa_select(sa_func.count()).select_from(UniverseTicker)).scalar()
    assert count == 0


def test_add_evicts_the_cache_when_fetch_history_returns_empty(db_mode, monkeypatch):
    """Without this, fetch_history's unconditional store() leaves the empty frame in the
    24-hour TTL cache — a same-day retry would be served that cached empty frame, and the
    repair path in refresh() could never see real data either."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: True)
    monkeypatch.setattr("app.universe.fetch_history", _empty_fetch_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)
    monkeypatch.setattr("app.universe.refresh_ticker", _raising_refresh_ticker)

    evicted = []
    monkeypatch.setattr("app.universe.evict", lambda ticker: evicted.append(ticker))

    with pytest.raises(HistoryUnavailable):
        add("GHOST")

    assert evicted == ["GHOST"]


def test_add_calls_refresh_ticker_with_history_start(db_mode, monkeypatch):
    """Contract 0042 part 3: a ticker added after the 16:00 ET cutoff must not sit a session
    behind the rest of the universe. add() reuses refresh_ticker's own cutoff logic rather than
    recomputing it, so this only needs to prove the call happens with the right anchor."""
    calls = []

    def fake_refresh_ticker(ticker, **kwargs):
        calls.append((ticker, kwargs))
        return _noop_refresh_ticker(ticker, **kwargs)

    _patch_add(monkeypatch, refresh_ticker_fake=fake_refresh_ticker)

    add("AAPL")

    assert calls == [("AAPL", {"history_start": HISTORY_START})]


# --- contract 0054: add() gives the new ticker a live quote immediately --------------------


def test_add_calls_refresh_quote_for_with_the_added_ticker(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    calls = []
    monkeypatch.setattr("app.universe.refresh_quote_for", lambda ticker: calls.append(ticker))

    add("aapl")

    assert calls == ["AAPL"]


def test_add_succeeds_even_when_refresh_quote_for_raises(db_mode, monkeypatch):
    """A quote-fetch failure must never fail the add() itself — the ticker still joins the
    universe, it just keeps showing 0.00% change until the next batch refresh picks it up."""
    _patch_add(monkeypatch)

    def _raising(ticker):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.universe.refresh_quote_for", _raising)

    result = add("AAPL")

    assert result["ticker"] == "AAPL"
    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        assert row is not None
        assert row.active is True


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


# --- refresh heals a member with no stored history (contract 0042) -------------------------


def test_refresh_first_fetches_when_a_member_has_no_stored_history(db_mode, monkeypatch):
    """Must fail against the code before this contract: refresh() never first-fetched, so a
    zero-bar member — e.g. one that slipped in before add() refused those — could never
    recover. missing_range(None, ...) returns None by design ("a first fetch is the caller's
    job"), so without this heal call refresh_ticker's own no-op branch would fire forever."""
    with session() as db:
        db.add(UniverseTicker(ticker="TSLA", active=True))

    called = []

    def fake_fetch_history(ticker, start=None, end=None):
        called.append((ticker, start, end))
        df = _history(["2016-01-04"])
        store(ticker, df)
        return df

    monkeypatch.setattr("app.universe.fetch_history", fake_fetch_history)
    monkeypatch.setattr("app.universe.refresh_ticker", _noop_refresh_ticker)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr("app.universe.last_completed_session", lambda: date(2026, 9, 17))

    refresh("TSLA")

    assert called == [("TSLA", HISTORY_START, date(2026, 9, 17))]


def test_refresh_does_not_raise_when_the_heal_fetch_also_returns_empty(db_mode, monkeypatch):
    """Honest zero beats an exception: refresh() is called from the auto-refresh sweep, which
    already catches and logs per-ticker exceptions without fixing anything, so raising here
    would just add log noise instead of surfacing a real bars_after: 0."""
    with session() as db:
        db.add(UniverseTicker(ticker="TSLA", active=True))

    monkeypatch.setattr("app.universe.fetch_history", _empty_fetch_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", _make_fake_fetch_fundamentals())
    monkeypatch.setattr(
        "app.universe.refresh_ticker",
        lambda ticker, force=False, history_start=None: {
            "ticker": ticker,
            "action": "none",
            "last_session": None,
            "bars_before": 0,
            "bars_after": 0,
            "drift_detected": False,
        },
    )

    result = refresh("TSLA")  # must not raise

    assert result["bars_after"] == 0


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
    from app.quotes import QUOTE_ATTEMPT_KEY

    now = datetime.now(timezone.utc)
    store_quotes({"AAPL": (123.45, now)}, now)
    # Contract 0051: the refresh gate is a claim on the *attempt*, not MAX(fetched_at) over
    # quote rows — storing a fresh quote row alone no longer prevents a refetch, so the claim
    # itself must be seeded fresh too.
    with session() as db:
        db.add(AppState(key=QUOTE_ATTEMPT_KEY, value_at=now))

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


# --- contract 0055: prior completed-session close -------------------------------------------


def test_list_all_prior_close_uses_second_most_recent_non_null_close(db_mode):
    """A null close on the newest row must not displace the prior real close."""
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=True))
        db.add_all(
            [
                PriceBar(ticker="AAPL", date=date(2026, 9, 16), close=330.0),
                PriceBar(ticker="AAPL", date=date(2026, 9, 17), close=337.0),
                PriceBar(ticker="AAPL", date=date(2026, 9, 18), close=None),
            ]
        )

    entry = list_all()[0]

    assert entry["last_close"] == 337.0
    assert entry["prior_close"] == 330.0


def test_prior_close_is_none_with_one_bar_and_get_one_agrees_with_list_all(db_mode):
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=True))
        db.add(PriceBar(ticker="AAPL", date=date(2026, 9, 17), close=337.0))

    listed = list_all()[0]
    detail = get_one("AAPL")

    assert listed["last_close"] == 337.0
    assert listed["prior_close"] is None
    assert detail["last_close"] == listed["last_close"]
    assert detail["prior_close"] == listed["prior_close"]


# --- contract 0038: remove --------------------------------------------------------------------


def test_remove_deletes_rows_from_all_four_tables_and_get_one_then_raises(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    with session() as db:
        db.add(
            TickerQuote(
                ticker="AAPL",
                price=150.0,
                as_of=datetime(2026, 9, 17, tzinfo=timezone.utc),
                fetched_at=datetime(2026, 9, 17, tzinfo=timezone.utc),
            )
        )

    result = remove("AAPL")

    assert result == {
        "ticker": "AAPL",
        "bars_deleted": 2,
        "fundamentals_deleted": 1,
        "quotes_deleted": 1,
    }

    with session() as db:
        assert db.get(UniverseTicker, "AAPL") is None
        bar_count = db.execute(
            sa_select(sa_func.count()).select_from(PriceBar).where(PriceBar.ticker == "AAPL")
        ).scalar()
        fundamentals = db.get(TickerFundamentals, "AAPL")
        quote = db.get(TickerQuote, "AAPL")
    assert bar_count == 0
    assert fundamentals is None
    assert quote is None

    with pytest.raises(NotInUniverse):
        get_one("AAPL")


def test_remove_evicts_the_ttl_cache_so_a_same_day_readd_would_refetch(db_mode, monkeypatch):
    """The bug this contract exists to prevent: without cache eviction, get_cached would keep
    serving the old in-memory frame after a same-day delete, is_stale would say False against
    it, and re-adding the ticker would silently resurrect its pre-deletion history with no
    fetch and no error anywhere. This is the criterion that matters most in this contract."""
    _patch_add(monkeypatch)
    add("AAPL")
    assert get_cached("AAPL") is not None

    remove("AAPL")

    assert get_cached("AAPL") is None


def test_remove_unknown_ticker_raises_and_deletes_nothing(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    with pytest.raises(NotInUniverse):
        remove("NOPE")

    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        assert row is not None
        assert row.active is True
        bar_count = db.execute(
            sa_select(sa_func.count()).select_from(PriceBar).where(PriceBar.ticker == "AAPL")
        ).scalar()
    assert bar_count == 2


def test_remove_already_inactive_ticker_raises_and_deletes_nothing(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")
    with session() as db:
        row = db.get(UniverseTicker, "AAPL")
        row.active = False

    with pytest.raises(NotInUniverse):
        remove("AAPL")

    with session() as db:
        bar_count = db.execute(
            sa_select(sa_func.count()).select_from(PriceBar).where(PriceBar.ticker == "AAPL")
        ).scalar()
    assert bar_count == 2  # untouched — remove() raised before deleting anything


def test_remove_does_not_touch_news_articles(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")

    with session() as db:
        db.add(
            NewsArticle(
                id="a1",
                title="Some story",
                source_ticker="AAPL",
                fetched_at=datetime(2026, 9, 17, tzinfo=timezone.utc),
            )
        )

    remove("AAPL")

    with session() as db:
        article = db.get(NewsArticle, "a1")
        assert article is not None
        assert article.source_ticker == "AAPL"


# --- contract 0051: _fundamentals_incomplete -------------------------------------------------


def test_fundamentals_incomplete_true_when_row_is_absent():
    assert _fundamentals_incomplete(None) is True


def test_fundamentals_incomplete_true_when_short_name_missing():
    row = {"short_name": None, "market_cap": 100, "trailing_pe": 20.0, "dividend_yield": 0.5}
    assert _fundamentals_incomplete(row) is True


def test_fundamentals_incomplete_true_when_all_crumb_gated_fields_are_none():
    """A row with a short_name but nothing from `.info` — exactly what a tier-1/tier-2 partial
    write leaves behind — must read as incomplete so refresh() retries `.info`."""
    row = {"short_name": "Apple Inc.", "market_cap": None, "trailing_pe": None, "dividend_yield": None}
    assert _fundamentals_incomplete(row) is True


def test_fundamentals_incomplete_false_when_market_cap_present():
    row = {"short_name": "Apple Inc.", "market_cap": 1_000_000_000, "trailing_pe": None, "dividend_yield": None}
    assert _fundamentals_incomplete(row) is False


def test_fundamentals_incomplete_false_when_trailing_pe_present():
    row = {"short_name": "Apple Inc.", "market_cap": None, "trailing_pe": 20.0, "dividend_yield": None}
    assert _fundamentals_incomplete(row) is False


def test_fundamentals_incomplete_false_when_dividend_yield_present():
    row = {"short_name": "Apple Inc.", "market_cap": None, "trailing_pe": None, "dividend_yield": 0.33}
    assert _fundamentals_incomplete(row) is False


# --- contract 0051: refresh() retries incomplete rows and reports which path ran -------------


def test_refresh_retries_fundamentals_when_row_is_incomplete_partial(db_mode, monkeypatch):
    """A partial row (short_name but no crumb-gated fields — exactly what a tier-1/tier-2
    write leaves) must not be treated as done; refresh() retries .info via fetch_fundamentals."""
    _patch_add(monkeypatch)
    add("AAPL")
    with session() as db:
        row = db.get(TickerFundamentals, "AAPL")
        row.market_cap = None
        row.trailing_pe = None
        row.dividend_yield = None

    called = []

    def fake_fetch_fundamentals(ticker):
        called.append(ticker)
        data = _fundamentals(ticker)
        store_fundamentals(ticker, data)
        return data

    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.refresh_ticker", _noop_refresh_ticker)

    result = refresh("AAPL")

    assert called == ["AAPL"]
    assert result["fundamentals"] == "info"


def test_refresh_reports_fundamentals_none_when_incomplete_and_fetch_fails(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")
    with session() as db:
        row = db.get(TickerFundamentals, "AAPL")
        row.market_cap = None
        row.trailing_pe = None
        row.dividend_yield = None

    monkeypatch.setattr("app.universe.fetch_fundamentals", lambda ticker: None)
    monkeypatch.setattr("app.universe.refresh_ticker", _noop_refresh_ticker)

    result = refresh("AAPL")

    assert result["fundamentals"] == "none"


def test_refresh_reports_fundamentals_partial_when_a_crumb_free_tier_succeeds(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")
    with session() as db:
        row = db.get(TickerFundamentals, "AAPL")
        row.market_cap = None
        row.trailing_pe = None
        row.dividend_yield = None

    def fake_partial_fetch(ticker):
        # No crumb-gated key at all — the shape fetch_fundamentals's own partial merge
        # produces, as distinct from extract_fundamentals's always-full dict.
        data = {"ticker": ticker, "short_name": "Apple Inc.", "fetched_at": datetime.now(timezone.utc)}
        store_fundamentals(ticker, data, partial=True)
        return data

    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_partial_fetch)
    monkeypatch.setattr("app.universe.refresh_ticker", _noop_refresh_ticker)

    result = refresh("AAPL")

    assert result["fundamentals"] == "partial"


def test_refresh_reports_fundamentals_skipped_when_row_already_complete(db_mode, monkeypatch):
    _patch_add(monkeypatch)
    add("AAPL")  # _fundamentals() default already sets market_cap/trailing_pe/dividend_yield

    monkeypatch.setattr("app.universe.fetch_fundamentals", _raising_fetch_fundamentals)
    monkeypatch.setattr("app.universe.refresh_ticker", _noop_refresh_ticker)

    result = refresh("AAPL")

    assert result["fundamentals"] == "skipped"
