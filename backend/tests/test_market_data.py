from datetime import date, datetime, timezone

import pandas as pd
import pandas.testing as pd_testing
import pytest
from sqlalchemy import func as sa_func, select as sa_select

from app.cache import clear, get_cached, get_fundamentals, store, store_fundamentals
from app.db import get_engine, session as db_session
from app.market_data import (
    _download_history,
    extract_fundamentals,
    fetch_fundamentals,
    fetch_history,
    is_valid_symbol,
    normalize_history,
    symbol_has_history,
)
from app.models import Base, TickerFundamentals
from tests.fixtures.yf_samples import (
    AAPL_HISTORY_RAW,
    AAPL_INFO,
    INVALID_INFO,
    SPY_INFO,
    TSLA_INFO,
)


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    """Isolated SQLite file per test, as in test_cache_backend.py."""
    url = f"sqlite:///{tmp_path}/test_market_data.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def degraded_mode(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    yield


# --- 1 & 2. normalize_history ------------------------------------------------------------


def test_normalize_history_flattens_multiindex_and_maps_adj_close():
    result = normalize_history(AAPL_HISTORY_RAW)
    assert list(result.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert result.index.name == "date"
    assert str(result.index.dtype) == "datetime64[us]"
    assert result["adj_close"].tolist() == AAPL_HISTORY_RAW[("Adj Close", "AAPL")].tolist()
    assert result["close"].tolist() == AAPL_HISTORY_RAW[("Close", "AAPL")].tolist()
    assert result["volume"].dtype == "Int64"


def test_normalize_history_empty_input_has_canonical_columns():
    result = normalize_history(pd.DataFrame())
    assert list(result.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert len(result) == 0


# --- 3-6. extract_fundamentals ------------------------------------------------------------


def test_extract_fundamentals_maps_every_column_for_aapl():
    fetched_at = datetime(2026, 9, 13, tzinfo=timezone.utc)
    result = extract_fundamentals("aapl", AAPL_INFO, fetched_at)
    assert result == {
        "ticker": "AAPL",
        "short_name": "Apple Inc.",
        "long_name": "Apple Inc.",
        "sector": "Technology",
        "industry": "Consumer Electronics",
        "currency": "USD",
        "exchange": "NMS",
        "quote_type": "EQUITY",
        "regular_market_price": 332.27,
        "previous_close": 326.57,
        "market_cap": 4849207869440,
        "trailing_pe": 38.148106,
        "forward_pe": 34.703167,
        "dividend_yield": 0.33,
        "fifty_two_week_high": 344.57,
        "fifty_two_week_low": 235.03,
        "beta": 1.085,
        "average_volume": 54055456,
        "fetched_at": fetched_at,
    }


def test_extract_fundamentals_etf_missing_fields_are_none_trap1():
    """Trap 1: regular_market_price must come from regularMarketPrice, not currentPrice
    (absent for ETFs) — this is the test that proves it's handled."""
    result = extract_fundamentals("SPY", SPY_INFO, datetime.now(timezone.utc))
    assert result["sector"] is None
    assert result["industry"] is None
    assert result["market_cap"] is None
    assert result["beta"] is None
    assert result["regular_market_price"] == 764.29


def test_extract_fundamentals_tsla_dividend_yield_is_none_not_zero_trap3():
    """Trap 3: a non-payer omits dividendYield entirely; must extract as None, not 0 —
    asserted with `is None` explicitly, since `assert not x` passes for both."""
    result = extract_fundamentals("TSLA", TSLA_INFO, datetime.now(timezone.utc))
    assert result["dividend_yield"] is None


def test_extract_fundamentals_dividend_yield_not_rescaled_trap2():
    """Trap 2: dividendYield is already in percent units. AAPL's 0.33 must stay 0.33 —
    not 33.0 (accidentally multiplied) and not 0.0033 (accidentally divided)."""
    result = extract_fundamentals("AAPL", AAPL_INFO, datetime.now(timezone.utc))
    assert result["dividend_yield"] == 0.33


# --- 7. is_valid_symbol --------------------------------------------------------------------


def test_is_valid_symbol():
    assert is_valid_symbol(INVALID_INFO) is False
    assert is_valid_symbol(AAPL_INFO) is True
    assert is_valid_symbol(SPY_INFO) is True


# --- 8. store_fundamentals -> get_fundamentals round-trips, including ETF Nones -----------


def test_store_get_fundamentals_round_trip_etf_nones(db_mode):
    fetched_at = datetime(2026, 9, 13, tzinfo=timezone.utc)
    data = extract_fundamentals("SPY", SPY_INFO, fetched_at)
    store_fundamentals("SPY", data)

    result = get_fundamentals("spy")  # case-insensitive read
    assert result is not None
    assert result["ticker"] == "SPY"
    assert result["sector"] is None
    assert result["industry"] is None
    assert result["market_cap"] is None
    assert result["beta"] is None
    assert result["regular_market_price"] == 764.29


# --- 9. store_fundamentals twice leaves exactly one row, second write's values ------------


def test_store_fundamentals_upsert_keeps_second_write(db_mode):
    fetched_at_1 = datetime(2026, 9, 1, tzinfo=timezone.utc)
    fetched_at_2 = datetime(2026, 9, 13, tzinfo=timezone.utc)

    store_fundamentals("AAPL", extract_fundamentals("AAPL", AAPL_INFO, fetched_at_1))
    updated_info = {**AAPL_INFO, "regularMarketPrice": 400.0}
    store_fundamentals("AAPL", extract_fundamentals("AAPL", updated_info, fetched_at_2))

    result = get_fundamentals("AAPL")
    assert result["regular_market_price"] == 400.0
    # SQLite has no native tz-aware timestamp type, so it round-trips fetched_at naive
    # (Postgres, via DateTime(timezone=True), does not have this limitation) — compare
    # with tzinfo stripped so this test reflects that, rather than a bug in the code.
    assert result["fetched_at"] == fetched_at_2.replace(tzinfo=None)

    with db_session() as db:
        count = db.execute(
            sa_select(sa_func.count())
            .select_from(TickerFundamentals)
            .where(TickerFundamentals.ticker == "AAPL")
        ).scalar()
    assert count == 1


# --- contract 0051: store_fundamentals(partial=True) never nulls a good stored value -------
#
# The regression this guards against: cache.store_fundamentals upserted every column
# unconditionally. A partial write through that path would blank AAPL's market_cap,
# trailing_pe and dividend_yield the next time a crumb-free tier ran instead of `.info` —
# silently destroying every one of the 22 good rows this app already has.


def test_store_fundamentals_partial_does_not_null_existing_crumb_gated_fields(db_mode):
    store_fundamentals("AAPL", extract_fundamentals("AAPL", AAPL_INFO, datetime(2026, 9, 1, tzinfo=timezone.utc)))
    assert get_fundamentals("AAPL")["market_cap"] == 4849207869440

    # A tier-1/tier-2 style partial payload: only a handful of keys, the crumb-gated ones
    # entirely absent (not even present as None) — the exact shape fetch_fundamentals's merge
    # produces when `.info` fails but the chart endpoint and search both succeed.
    partial_payload = {
        "ticker": "AAPL",
        "short_name": "Apple Inc. (renamed)",
        "sector": "Technology",
        "fetched_at": datetime(2026, 9, 18, tzinfo=timezone.utc),
    }
    store_fundamentals("AAPL", partial_payload, partial=True)

    result = get_fundamentals("AAPL")
    assert result["short_name"] == "Apple Inc. (renamed)"  # the incoming non-null value landed
    assert result["market_cap"] == 4849207869440  # untouched
    assert result["trailing_pe"] == 38.148106  # untouched
    assert result["dividend_yield"] == 0.33  # untouched
    assert result["fetched_at"] == datetime(2026, 9, 18)  # always written


def test_store_fundamentals_non_partial_does_overwrite_crumb_gated_fields(db_mode):
    store_fundamentals("AAPL", extract_fundamentals("AAPL", AAPL_INFO, datetime(2026, 9, 1, tzinfo=timezone.utc)))
    assert get_fundamentals("AAPL")["market_cap"] == 4849207869440

    # partial=False (the default) is today's behaviour: an authoritative .info response that
    # genuinely has no market cap this time really does clear it.
    bare_payload = {
        "ticker": "AAPL",
        "short_name": "Apple Inc.",
        "fetched_at": datetime(2026, 9, 18, tzinfo=timezone.utc),
    }
    store_fundamentals("AAPL", bare_payload)

    result = get_fundamentals("AAPL")
    assert result["market_cap"] is None
    assert result["trailing_pe"] is None
    assert result["dividend_yield"] is None


def test_store_fundamentals_partial_inserts_a_brand_new_row_with_nulls(db_mode):
    """A brand-new ticker with no row at all still gets one inserted under partial=True, with
    the crumb-gated columns left NULL — the same shape an ETF's row already has for
    genuinely-absent fields."""
    partial_payload = {
        "ticker": "PBR",
        "short_name": "Petroleo Brasileiro S.A. Petrob",
        "quote_type": "EQUITY",
        "fetched_at": datetime(2026, 9, 18, tzinfo=timezone.utc),
    }
    store_fundamentals("PBR", partial_payload, partial=True)

    result = get_fundamentals("PBR")
    assert result is not None
    assert result["short_name"] == "Petroleo Brasileiro S.A. Petrob"
    assert result["market_cap"] is None
    assert result["trailing_pe"] is None
    assert result["dividend_yield"] is None


# --- 10. clear() leaves fundamentals rows intact in the database --------------------------


def test_clear_leaves_fundamentals_intact(db_mode):
    store_fundamentals("AAPL", extract_fundamentals("AAPL", AAPL_INFO, datetime.now(timezone.utc)))
    clear()
    result = get_fundamentals("AAPL")
    assert result is not None
    assert result["short_name"] == "Apple Inc."


# --- 11. degraded mode: store_fundamentals is a no-op, does not raise ---------------------


def test_store_fundamentals_degraded_mode_is_noop(degraded_mode):
    store_fundamentals("AAPL", extract_fundamentals("AAPL", AAPL_INFO, datetime.now(timezone.utc)))
    assert get_fundamentals("AAPL") is None


# --- 0013 case 1: symbol_has_history is the crumb-free existence check --------------------


def test_symbol_has_history_true_when_bars_present(monkeypatch):
    monkeypatch.setattr(
        "app.market_data._download_history", lambda ticker, start, end: AAPL_HISTORY_RAW
    )
    assert symbol_has_history("AAPL") is True


def test_symbol_has_history_false_for_empty_frame(monkeypatch):
    monkeypatch.setattr(
        "app.market_data._download_history", lambda ticker, start, end: pd.DataFrame()
    )
    assert symbol_has_history("NOTAREAL") is False


def test_symbol_has_history_uses_short_window_not_ten_years(monkeypatch):
    captured = {}

    def fake_download(ticker, start, end):
        captured["start"] = start
        captured["end"] = end
        return AAPL_HISTORY_RAW

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    symbol_has_history("AAPL")

    assert captured["start"] is not None
    assert captured["end"] is not None
    span_days = (captured["end"] - captured["start"]).days
    assert 0 < span_days <= 14  # "roughly the last 10 days", not ten years


def test_symbol_has_history_raises_upstream_unavailable_on_request_failure(monkeypatch):
    from app.market_data import UpstreamUnavailable
    from yfinance.exceptions import YFRateLimitError

    def fake_download(ticker, start, end):
        raise YFRateLimitError()

    monkeypatch.setattr("app.market_data._download_history", fake_download)

    with pytest.raises(UpstreamUnavailable):
        symbol_has_history("AAPL")


# --- 0013 cases 6-7: fetch_fundamentals returns None (never raises) on a bad-looking dict --
#
# Contract 0006 had fetch_fundamentals raise ValueError here, gating symbol existence on
# fundamentals. Production proved that wrong: Yahoo's crumb handshake can fail for a
# perfectly valid symbol (SPY), producing this exact same empty-dict shape with no
# distinguishing exception. fetch_fundamentals no longer decides existence at all —
# symbol_has_history does (see test_universe.py) — so this is now a plain "couldn't fetch,
# not an error" case.
#
# Contract 0051: an invalid-looking `.info` no longer means "give up" — it falls through to
# the crumb-free tiers, so these three now also mock those two calls to fail, to exercise the
# genuinely-unreachable case (every tier fails) rather than accidentally hitting the network.


def test_fetch_fundamentals_returns_none_for_invalid_looking_dict(monkeypatch, db_mode):
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: INVALID_INFO)
    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: {})
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: [])
    result = fetch_fundamentals("NOTAREAL")
    assert result is None


def test_fetch_fundamentals_returns_none_for_empty_dict(monkeypatch, db_mode):
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: {})
    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: {})
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: [])
    result = fetch_fundamentals("SPY")
    assert result is None


def test_fetch_fundamentals_none_writes_no_row(monkeypatch, db_mode):
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: INVALID_INFO)
    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: {})
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: [])
    fetch_fundamentals("NOTAREAL")
    assert get_fundamentals("NOTAREAL") is None


# --- composition: fetch_fundamentals / fetch_history happy paths, still no network --------


def test_fetch_fundamentals_valid_symbol_stores_and_returns(monkeypatch, db_mode):
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: AAPL_INFO)
    result = fetch_fundamentals("aapl")
    assert result["ticker"] == "AAPL"
    assert result["regular_market_price"] == 332.27
    assert get_fundamentals("AAPL") is not None


# --- contract 0051: the tiered fetch --------------------------------------------------------


CHART_META_PBR = {
    "shortName": "Petroleo Brasileiro S.A. Petrob",
    "longName": "Petróleo Brasileiro S.A. - Petrobras",
    "instrumentType": "EQUITY",
    "currency": "USD",
    "exchangeName": "NYQ",
    "regularMarketPrice": 20.895,
    "chartPreviousClose": 21.2,
    "fiftyTwoWeekHigh": 22.24,
    "fiftyTwoWeekLow": 11.43,
}

SEARCH_QUOTES_PBR = [
    {"symbol": "PBR", "sector": "Energy", "industry": "Oil & Gas Integrated", "quoteType": "EQUITY"},
    {"symbol": "PBR-A", "sector": "Energy", "industry": "Oil & Gas Integrated", "quoteType": "EQUITY"},
]


def test_fetch_search_profile_returns_none_when_symbol_differs(monkeypatch):
    """The PBR -> PBR-A case: yf.Search("PBR").quotes returns PBR-A second (and sometimes
    first-ish depending on ranking) — taking quotes[0] blindly would eventually write one
    company's sector onto another's row, so a search whose *only* match is a different symbol
    must return None, not that other symbol's data."""
    from app.market_data import fetch_search_profile

    quotes_missing_pbr = [
        {"symbol": "PBR-A", "sector": "Energy", "industry": "Oil & Gas Integrated"},
        {"symbol": "PBRX.JK", "sector": "Consumer Cyclical", "industry": "Apparel Manufacturing"},
    ]
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: quotes_missing_pbr)
    assert fetch_search_profile("PBR") is None


def test_fetch_search_profile_matches_exact_symbol_case_insensitively(monkeypatch):
    from app.market_data import fetch_search_profile

    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: SEARCH_QUOTES_PBR)
    result = fetch_search_profile("pbr")
    assert result == {"sector": "Energy", "industry": "Oil & Gas Integrated"}


def test_fetch_chart_meta_maps_tier_one_fields(monkeypatch):
    from app.market_data import fetch_chart_meta

    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: CHART_META_PBR)
    result = fetch_chart_meta("PBR")
    assert result == {
        "short_name": "Petroleo Brasileiro S.A. Petrob",
        "long_name": "Petróleo Brasileiro S.A. - Petrobras",
        "quote_type": "EQUITY",
        "currency": "USD",
        "exchange": "NYQ",
        "regular_market_price": 20.895,
        "previous_close": 21.2,
        "fifty_two_week_high": 22.24,
        "fifty_two_week_low": 11.43,
    }


def test_fetch_chart_meta_returns_none_for_invalid_symbol(monkeypatch):
    """An invalid symbol doesn't raise from get_history_metadata() — it comes back a
    near-empty dict, the same trap is_valid_symbol already exists to catch for `.info`."""
    from app.market_data import fetch_chart_meta

    monkeypatch.setattr(
        "app.market_data._download_chart_meta",
        lambda ticker: {"YF repair?": False, "tradingPeriods": "<lazy-loaded>"},
    )
    assert fetch_chart_meta("NOTAREALTICKERXYZ") is None


def test_fetch_fundamentals_returns_none_when_all_three_tiers_fail(monkeypatch, db_mode):
    """Acceptance criterion 6: every tier fails -> None, and nothing is written."""
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: INVALID_INFO)
    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: {})
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: [])

    result = fetch_fundamentals("NOTAREAL")

    assert result is None
    assert get_fundamentals("NOTAREAL") is None


def test_fetch_fundamentals_merges_partial_tiers_when_info_fails(monkeypatch, db_mode):
    monkeypatch.setattr("app.market_data._download_info", lambda ticker: INVALID_INFO)
    monkeypatch.setattr("app.market_data._download_chart_meta", lambda ticker: CHART_META_PBR)
    monkeypatch.setattr("app.market_data._download_search_quotes", lambda ticker: SEARCH_QUOTES_PBR)

    result = fetch_fundamentals("PBR")

    assert result is not None
    assert result["short_name"] == "Petroleo Brasileiro S.A. Petrob"
    assert result["sector"] == "Energy"
    assert result["industry"] == "Oil & Gas Integrated"
    assert "market_cap" not in result  # never invented from crumb-free data

    stored = get_fundamentals("PBR")
    assert stored["short_name"] == "Petroleo Brasileiro S.A. Petrob"
    assert stored["sector"] == "Energy"
    assert stored["market_cap"] is None  # not fabricated; genuinely not fetched


def test_fetch_fundamentals_does_not_call_crumb_free_tiers_when_info_succeeds(monkeypatch, db_mode):
    """Acceptance criterion 7: when `.info` succeeds, tier 1 and tier 2 are not called at all —
    one request, as today."""

    def _raising_chart_meta(ticker):
        raise AssertionError("fetch_chart_meta must not be called when .info succeeds")

    def _raising_search_quotes(ticker):
        raise AssertionError("fetch_search_profile must not be called when .info succeeds")

    monkeypatch.setattr("app.market_data._download_info", lambda ticker: AAPL_INFO)
    monkeypatch.setattr("app.market_data._download_chart_meta", _raising_chart_meta)
    monkeypatch.setattr("app.market_data._download_search_quotes", _raising_search_quotes)

    result = fetch_fundamentals("AAPL")

    assert result["ticker"] == "AAPL"
    assert result["market_cap"] == 4849207869440


def test_fetch_history_stores_and_returns_normalized_frame(monkeypatch, db_mode):
    monkeypatch.setattr(
        "app.market_data._download_history", lambda ticker, start, end: AAPL_HISTORY_RAW
    )
    result = fetch_history("AAPL")
    assert list(result.columns) == ["open", "high", "low", "close", "adj_close", "volume"]

    clear()
    from_db = get_cached("AAPL")
    pd_testing.assert_frame_equal(result, from_db)


# --- 13-16. yfinance's end is exclusive; _download_history adds one day ----


def test_download_history_adds_one_day_to_end(monkeypatch):
    """_download_history adds one day to the end parameter before calling yfinance."""
    seen = {}

    def fake_yf_download(ticker, **kwargs):
        seen.update(kwargs)
        return pd.DataFrame()

    monkeypatch.setattr("app.market_data.yf.download", fake_yf_download)
    _download_history("X", date(2026, 9, 11), date(2026, 9, 14))

    assert seen["start"] == date(2026, 9, 11)
    assert seen["end"] == date(2026, 9, 15)


def test_download_history_end_none_stays_none(monkeypatch):
    """When end is None, it stays None — no crash from None + timedelta."""
    seen = {}

    def fake_yf_download(ticker, **kwargs):
        seen.update(kwargs)
        return pd.DataFrame()

    monkeypatch.setattr("app.market_data.yf.download", fake_yf_download)
    _download_history("X", None, None)

    assert seen["start"] is None
    assert seen["end"] is None


def test_download_history_start_with_end_none(monkeypatch):
    """When start is provided but end is None, start is unchanged and end stays None."""
    seen = {}

    def fake_yf_download(ticker, **kwargs):
        seen.update(kwargs)
        return pd.DataFrame()

    monkeypatch.setattr("app.market_data.yf.download", fake_yf_download)
    _download_history("X", date(2026, 1, 1), None)

    assert seen["start"] == date(2026, 1, 1)
    assert seen["end"] is None


def test_download_history_start_never_modified(monkeypatch):
    """Start is never modified — only end."""
    seen = {}

    def fake_yf_download(ticker, **kwargs):
        seen.update(kwargs)
        return pd.DataFrame()

    monkeypatch.setattr("app.market_data.yf.download", fake_yf_download)
    _download_history("X", date(2026, 9, 11), date(2026, 9, 14))

    assert seen["start"] == date(2026, 9, 11)
    assert seen["end"] == date(2026, 9, 15)
    # Verify start was not changed by the conversion
    assert seen["start"] != date(2026, 9, 12)


def test_refresh_idempotence_missing_range_unchanged(db_mode):
    """Verify that missing_range semantics are unchanged — it still returns
    (newest_stored, last_session), both inclusive dates. This ensures the fix
    (adding 1 day to yfinance's end) is localized to _download_history."""
    from app.freshness import missing_range

    # Create stored frame with bars through 2026-09-11
    stored = pd.DataFrame(
        {
            "open": [100.0, 101.0],
            "high": [101.0, 102.0],
            "low": [100.0, 101.0],
            "close": [100.5, 101.5],
            "adj_close": [100.5, 101.5],
            "volume": pd.array([1_000_000, 1_000_000], dtype="Int64"),
        },
        index=pd.to_datetime(["2026-09-10", "2026-09-11"]),
    )
    stored.index.name = "date"
    store("MSFT", stored)

    # missing_range should return the inclusive range to fetch
    result = missing_range(stored, date(2026, 9, 14))
    assert result == (date(2026, 9, 11), date(2026, 9, 14))

    # After fetching bars through last_session, missing_range returns None
    stored_current = pd.DataFrame(
        {
            "open": [100.0, 101.0, 102.0, 103.0],
            "high": [101.0, 102.0, 103.0, 104.0],
            "low": [100.0, 101.0, 102.0, 103.0],
            "close": [100.5, 101.5, 102.5, 103.5],
            "adj_close": [100.5, 101.5, 102.5, 103.5],
            "volume": pd.array([1_000_000, 1_000_000, 1_000_000, 1_000_000], dtype="Int64"),
        },
        index=pd.to_datetime(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-14"]),
    )
    stored_current.index.name = "date"
    store("MSFT", stored_current)

    result_current = missing_range(stored_current, date(2026, 9, 14))
    assert result_current is None  # Now current, missing_range returns None
