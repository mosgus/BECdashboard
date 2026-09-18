from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event

from app.cache import clear
from app.db import get_engine, session
from app.models import Base, PriceBar, TickerFundamentals, TickerQuote, UniverseTicker
from app.strip import (
    bar_window_start,
    build_strip_response,
    nth_prior_close,
    pct_return,
    resolve_display_name,
    ytd_base_close,
)

ET = ZoneInfo("America/New_York")


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_strip.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _add_ticker(
    ticker: str,
    quote_type: str | None = None,
    active: bool = True,
    short_name: str | None = None,
    long_name: str | None = None,
) -> None:
    with session() as db:
        db.add(UniverseTicker(ticker=ticker, active=active))
        if quote_type is not None:
            db.add(
                TickerFundamentals(
                    ticker=ticker,
                    quote_type=quote_type,
                    short_name=short_name,
                    long_name=long_name,
                    fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                )
            )


def _add_bars(ticker: str, values: list[tuple[float, float]], start: date = date(2026, 1, 2)) -> None:
    """values: one (close, adj_close) pair per consecutive calendar day from `start`."""
    with session() as db:
        for i, (close, adj_close) in enumerate(values):
            db.add(
                PriceBar(
                    ticker=ticker,
                    date=start + timedelta(days=i),
                    close=close,
                    adj_close=adj_close,
                )
            )


def _add_quote(ticker: str, price: float, fetched_at: datetime) -> None:
    with session() as db:
        db.add(TickerQuote(ticker=ticker, price=price, as_of=fetched_at, fetched_at=fetched_at))


# --- pct_return -----------------------------------------------------------------------------


def test_pct_return_none_when_either_side_is_none():
    assert pct_return(None, 100.0) is None
    assert pct_return(100.0, None) is None


def test_pct_return_none_when_earlier_is_zero():
    assert pct_return(100.0, 0.0) is None


def test_pct_return_computes_percentage():
    assert pct_return(110.0, 100.0) == 10.0


# --- nth_prior_close --------------------------------------------------------------------------


def test_nth_prior_close_none_on_short_history():
    bars = [(date(2026, 1, 2), 100.0), (date(2026, 1, 3), 101.0)]
    assert nth_prior_close(bars, 5) is None


def test_nth_prior_close_returns_the_session_n_gaps_back():
    bars = [(date(2026, 1, 2 + i), 100.0 + i) for i in range(7)]  # values 100..106
    assert nth_prior_close(bars, 5) == 101.0  # bars[-6]


# --- ytd_base_close ---------------------------------------------------------------------------


def test_ytd_base_close_series_starting_mid_year():
    bars = [(date(2025, 6, 1), 50.0), (date(2026, 3, 1), 90.0), (date(2026, 6, 1), 100.0)]
    assert ytd_base_close(bars, 2026) == 90.0


def test_ytd_base_close_none_when_no_bar_on_or_after_cutoff():
    bars = [(date(2025, 6, 1), 50.0)]
    assert ytd_base_close(bars, 2026) is None


# --- bar_window_start: the bounded read window ---------------------------------------------
# Narrowing this fails silently — five_day/thirty_day/ytd are computed and returned but not
# rendered yet, so a too-short window drops them to None with nothing on screen to notice.


def test_bar_window_start_reaches_january_first_in_september():
    assert bar_window_start(date(2026, 9, 18), 2026) == date(2026, 1, 1)


def test_bar_window_start_reaches_back_past_new_year_in_early_january():
    """1 January alone cannot satisfy nth_prior_close(bars, 30): on 5 January only a handful of
    sessions exist in the year, so the window must reach into the previous one."""
    assert bar_window_start(date(2027, 1, 5), 2027) == date(2026, 10, 22)


@pytest.mark.parametrize(
    "today",
    [date(2026, 1, 1), date(2026, 1, 15), date(2026, 3, 1), date(2026, 7, 4), date(2026, 12, 31)],
)
def test_bar_window_start_always_satisfies_both_lower_bounds(today):
    start = bar_window_start(today, today.year)
    assert start <= date(today.year, 1, 1), "must reach 1 January for ytd_base_close"
    assert (today - start).days >= 45, "must leave room for 31 trading sessions"


# --- resolve_display_name --------------------------------------------------------------------


def test_resolve_display_name_prefers_short_name_when_not_truncated():
    assert resolve_display_name("Apple Inc.", "Apple Inc.", "AAPL") == "Apple Inc."


def test_resolve_display_name_falls_back_to_long_name_when_short_name_hits_the_31_char_cap():
    """The 30-vs-31 trap: short_name is 31 raw characters (30 after stripping trailing
    whitespace) — the length check must run before stripping or this silently keeps the
    truncated name."""
    short_name = "State Street Technology Select "
    long_name = "State Street Technology Select Sector SPDR ETF"
    assert resolve_display_name(short_name, long_name, "XLK") == long_name


def test_resolve_display_name_prefers_short_name_even_when_long_name_has_leading_space():
    assert resolve_display_name("Russell 2000", " Russell 2000 Index", "^RUT") == "Russell 2000"


def test_resolve_display_name_falls_back_to_ticker_when_both_names_are_none():
    assert resolve_display_name(None, None, "FOO") == "FOO"


# --- build_strip_response: grouping ------------------------------------------------------------


def test_empty_universe_returns_empty_groups(db_mode):
    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))
    assert result == {"groups": [], "as_of": None}


def test_groups_derive_from_quote_type_and_are_ordered(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("SPY", quote_type="ETF")
    _add_ticker("^GSPC", quote_type="INDEX")
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("SPY", [(100.0, 100.0), (101.0, 101.0)])
    _add_bars("^GSPC", [(200.0, 200.0), (202.0, 202.0)])
    _add_bars("AAPL", [(50.0, 50.0), (51.0, 51.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    assert [g["label"] for g in result["groups"]] == ["Indices", "ETFs", "Equities"]


def test_group_with_no_tickers_is_omitted(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(50.0, 50.0), (51.0, 51.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    assert [g["label"] for g in result["groups"]] == ["Equities"]


def test_ticker_without_fundamentals_row_defaults_to_equities(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("ORPHAN")  # no fundamentals row at all
    _add_bars("ORPHAN", [(50.0, 50.0), (51.0, 51.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    assert result["groups"][0]["label"] == "Equities"


def test_ticker_without_fundamentals_row_uses_ticker_as_name(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("ORPHAN")
    _add_bars("ORPHAN", [(50.0, 50.0), (51.0, 51.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["name"] == "ORPHAN"
    assert today["quote_type"] is None


def test_today_entry_carries_resolved_name_and_quote_type(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY", short_name="Apple Inc.", long_name="Apple Inc.")
    _add_bars("AAPL", [(50.0, 50.0), (51.0, 51.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["name"] == "Apple Inc."
    assert today["quote_type"] == "EQUITY"


def test_flattened_groups_put_indices_first_in_ascending_ticker_order(db_mode, monkeypatch):
    """No fixed priority list — ^GSPC, ^IXIC, ^RUT sort first purely because Indices leads
    _GROUP_ORDER and ascending ticker order happens to match what was asked for."""
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    for ticker in ["^RUT", "^GSPC", "^IXIC"]:
        _add_ticker(ticker, quote_type="INDEX")
        _add_bars(ticker, [(100.0, 100.0), (101.0, 101.0)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    flattened = [q["ticker"] for group in result["groups"] for q in group["today"]]
    assert flattened[:3] == ["^GSPC", "^IXIC", "^RUT"]


# --- day change: the two cases -----------------------------------------------------------------


def test_day_change_market_closed_uses_last_two_closes(db_mode, monkeypatch):
    """Patched in app.strip's own namespace: strip.py does `from app.quotes import
    is_market_open`, which binds its own independent name at import time — patching only
    app.quotes.is_market_open would leave this read of the real, unpatched clock."""
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0, 100.0), (110.0, 110.0)])  # last_close=110, prior=100

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["price"] == 110.0
    assert today["change"] == 10.0
    assert today["pct"] == 10.0
    assert result["as_of"] is None


def test_day_change_market_open_with_fresh_quote_uses_current_price(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: True)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0, 100.0), (110.0, 110.0)])  # last_close=110

    now = datetime.now(timezone.utc)
    _add_quote("AAPL", 115.0, now)

    result = build_strip_response(now, datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["price"] == 115.0
    assert today["change"] == pytest.approx(5.0)
    assert today["pct"] == pytest.approx(5.0 / 110.0 * 100)
    assert result["as_of"] == now


def test_day_change_market_open_but_quote_stale_falls_back_to_last_close(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: True)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0, 100.0), (110.0, 110.0)])

    now = datetime.now(timezone.utc)
    stale_fetch = now - timedelta(minutes=11)
    _add_quote("AAPL", 115.0, stale_fetch)

    result = build_strip_response(now, datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["price"] == 110.0
    assert today["change"] == 10.0
    assert result["as_of"] is None


def test_day_change_single_bar_yields_null_change_but_keeps_price(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0, 100.0)])  # only one bar ever stored

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    today = result["groups"][0]["today"][0]
    assert today["price"] == 100.0
    assert today["change"] is None
    assert today["pct"] is None


# --- five_day/thirty_day/ytd omission -----------------------------------------------------------


def test_ticker_with_too_little_history_omitted_from_five_day(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0 + i, 100.0 + i) for i in range(3)])  # only 3 bars, need 6

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    group = result["groups"][0]
    assert group["five_day"] == []
    assert any(entry["ticker"] == "AAPL" for entry in group["today"])


def test_ticker_with_enough_history_appears_in_five_day(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _add_ticker("AAPL", quote_type="EQUITY")
    _add_bars("AAPL", [(100.0 + i, 100.0 + i) for i in range(7)])

    result = build_strip_response(datetime.now(timezone.utc), datetime.now(ET))

    group = result["groups"][0]
    assert len(group["five_day"]) == 1
    assert group["five_day"][0]["ticker"] == "AAPL"


# --- bounded queries --------------------------------------------------------------------------


def test_build_strip_response_query_count_does_not_scale_with_ticker_count(db_mode, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)

    def query_count() -> int:
        count = {"n": 0}

        def on_execute(conn, cursor, statement, parameters, context, executemany):
            count["n"] += 1

        event.listen(db_mode, "before_cursor_execute", on_execute)
        try:
            build_strip_response(datetime.now(timezone.utc), datetime.now(ET))
        finally:
            event.remove(db_mode, "before_cursor_execute", on_execute)
        return count["n"]

    _add_ticker("AAA", quote_type="EQUITY")
    _add_ticker("BBB", quote_type="EQUITY")
    _add_bars("AAA", [(100.0, 100.0), (101.0, 101.0)])
    _add_bars("BBB", [(100.0, 100.0), (101.0, 101.0)])
    count_at_2 = query_count()

    for i in range(8):
        _add_ticker(f"T{i}", quote_type="EQUITY")
        _add_bars(f"T{i}", [(100.0, 100.0), (101.0, 101.0)])
    count_at_10 = query_count()

    assert count_at_2 == count_at_10
