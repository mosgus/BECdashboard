from datetime import date, datetime
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from app.cache import clear, get_cached, store
from app.freshness import (
    DRIFT_TOLERANCE,
    detect_drift,
    is_stale,
    last_completed_session,
    missing_range,
    pick_drift_anchors,
)
from app.market_data import _last_session_cache, refresh_ticker


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    _last_session_cache.clear()
    yield
    clear()
    _last_session_cache.clear()


def _bars(dates, adj_closes=None, closes=None, volumes=None) -> pd.DataFrame:
    """A minimal canonical-shaped OHLCV frame — DatetimeIndex named 'date', all six columns
    present — for exercising freshness.py's pure functions directly."""
    n = len(dates)
    index = pd.to_datetime(list(dates))
    index.name = "date"
    if adj_closes is None:
        adj_closes = [100.0 + i for i in range(n)]
    if closes is None:
        closes = adj_closes
    if volumes is None:
        volumes = [1_000_000] * n
    return pd.DataFrame(
        {
            "open": pd.array(closes, dtype="float64"),
            "high": pd.array(closes, dtype="float64"),
            "low": pd.array(closes, dtype="float64"),
            "close": pd.array(closes, dtype="float64"),
            "adj_close": pd.array(adj_closes, dtype="float64"),
            "volume": pd.array(volumes, dtype="Int64"),
        },
        index=index,
    )


# --- 1-5. last_completed_session -----------------------------------------------------------


def test_last_completed_session_before_16_excludes_today():
    ref = _bars(["2026-09-09", "2026-09-10"])
    result = last_completed_session(date(2026, 9, 10), 10, ref)
    assert result == date(2026, 9, 9)


def test_last_completed_session_at_or_after_16_includes_today():
    ref = _bars(["2026-09-09", "2026-09-10"])
    result = last_completed_session(date(2026, 9, 10), 17, ref)
    assert result == date(2026, 9, 10)


def test_last_completed_session_across_weekend_is_friday():
    ref = _bars(["2026-09-10", "2026-09-11"])  # Thu, Fri — no weekend bars exist
    result = last_completed_session(date(2026, 9, 13), 10, ref)  # asked on a Sunday
    assert result == date(2026, 9, 11)


def test_last_completed_session_across_holiday_gap_is_session_before_gap():
    """Real dates: Labor Day 2026-09-07 has no bar. Asked on the holiday itself, the answer
    must be the session before the gap (09-04), not the later bar (09-08) that happens to
    already be in the frame."""
    ref = _bars(["2026-09-04", "2026-09-08"])
    result = last_completed_session(date(2026, 9, 7), 10, ref)
    assert result == date(2026, 9, 4)


def test_last_completed_session_empty_reference_bars_is_none():
    empty = _bars([]) if False else pd.DataFrame()
    result = last_completed_session(date(2026, 9, 10), 17, empty)
    assert result is None


# --- 6. is_stale -----------------------------------------------------------------------------


def test_is_stale_false_when_newest_equals_last_session():
    stored = _bars(["2026-09-08", "2026-09-09"])
    assert is_stale(stored, date(2026, 9, 9)) is False


def test_is_stale_true_when_newest_is_earlier():
    stored = _bars(["2026-09-08", "2026-09-09"])
    assert is_stale(stored, date(2026, 9, 10)) is True


def test_is_stale_true_for_none_and_empty():
    assert is_stale(None, date(2026, 9, 10)) is True
    assert is_stale(pd.DataFrame(), date(2026, 9, 10)) is True


# --- 7. pick_drift_anchors ---------------------------------------------------------------------


def test_pick_drift_anchors_long_series_three_distinct():
    stored = _bars([f"2026-01-{d:02d}" for d in range(1, 11)])  # 10 dates
    anchors = pick_drift_anchors(stored)
    assert len(anchors) == 3
    assert len(set(anchors)) == 3
    assert anchors[0] == date(2026, 1, 1)
    assert anchors[-1] == date(2026, 1, 10)


def test_pick_drift_anchors_short_series_fewer():
    stored = _bars(["2026-01-01", "2026-01-02"])
    anchors = pick_drift_anchors(stored)
    assert len(anchors) <= 2
    assert len(set(anchors)) == len(anchors)


def test_pick_drift_anchors_empty_is_empty_list():
    assert pick_drift_anchors(pd.DataFrame()) == []
    assert pick_drift_anchors(None) == []


# --- 8-12. detect_drift --------------------------------------------------------------------


def test_detect_drift_false_for_identical_adj_close():
    stored = _bars(["2026-01-01", "2026-01-05", "2026-01-10"], adj_closes=[100.0, 105.0, 110.0])
    fresh = _bars(["2026-01-01", "2026-01-05", "2026-01-10"], adj_closes=[100.0, 105.0, 110.0])
    anchors = pick_drift_anchors(stored)
    assert detect_drift(stored, fresh, anchors) is False


def test_detect_drift_true_when_anchor_differs_beyond_tolerance_simulated_split():
    """Simulate a 4:1 split by dividing historical adj_close by 4 in a *separate* frame —
    not by calling any helper the implementation itself uses to build fixtures."""
    stored = _bars(
        ["2026-01-01", "2026-01-05", "2026-01-10"], adj_closes=[100.0, 105.0, 110.0]
    )
    fresh = stored.copy()
    fresh["adj_close"] = fresh["adj_close"] / 4
    anchors = pick_drift_anchors(stored)
    assert detect_drift(stored, fresh, anchors) is True


def test_detect_drift_false_when_only_raw_close_differs():
    stored = _bars(["2026-01-01", "2026-01-05"], adj_closes=[100.0, 105.0], closes=[100.0, 105.0])
    fresh = _bars(["2026-01-01", "2026-01-05"], adj_closes=[100.0, 105.0], closes=[999.0, 998.0])
    anchors = pick_drift_anchors(stored)
    assert detect_drift(stored, fresh, anchors) is False


def test_detect_drift_ignores_anchors_missing_from_fresh():
    stored = _bars(["2026-01-01", "2026-01-05", "2026-01-10"], adj_closes=[100.0, 105.0, 110.0])
    # fresh covers a totally different date — none of stored's anchors are present in it
    fresh = _bars(["2026-02-01"], adj_closes=[9999.0])
    anchors = pick_drift_anchors(stored)
    assert detect_drift(stored, fresh, anchors) is False


def test_detect_drift_false_below_tolerance():
    stored = _bars(["2026-01-01", "2026-01-05"], adj_closes=[100.0, 105.0])
    fresh = _bars(["2026-01-01", "2026-01-05"], adj_closes=[100.0 + 1e-9, 105.0])
    anchors = pick_drift_anchors(stored)
    assert detect_drift(stored, fresh, anchors) is False
    assert DRIFT_TOLERANCE == 1e-6  # sanity: the constant the contract names


# --- 13-14. missing_range -----------------------------------------------------------------


def test_missing_range_starts_at_newest_stored_date_not_the_day_after():
    stored = _bars(["2026-09-08", "2026-09-09"])
    result = missing_range(stored, date(2026, 9, 11))
    assert result == (date(2026, 9, 9), date(2026, 9, 11))


def test_missing_range_none_when_current_or_empty():
    stored = _bars(["2026-09-08", "2026-09-09"])
    assert missing_range(stored, date(2026, 9, 9)) is None  # already current
    assert missing_range(pd.DataFrame(), date(2026, 9, 9)) is None
    assert missing_range(None, date(2026, 9, 9)) is None


# --- 15-18. refresh_ticker -----------------------------------------------------------------


def _patch_now(monkeypatch, when: datetime) -> None:
    monkeypatch.setattr("app.market_data._now_et", lambda: when)


def test_refresh_ticker_fresh_data_returns_none_and_does_not_download_ticker(monkeypatch):
    stored = _bars(["2026-09-08", "2026-09-09"], adj_closes=[100.0, 101.0])
    store("AAPL", stored)

    reference_bars = _bars(["2026-09-08", "2026-09-09"])
    calls = []

    def fake_download(ticker, start, end):
        calls.append(ticker)
        if ticker == "SPY":
            return reference_bars
        raise AssertionError(f"unexpected download for {ticker}")

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    _patch_now(monkeypatch, datetime(2026, 9, 9, 17, tzinfo=ZoneInfo("America/New_York")))

    result = refresh_ticker("AAPL")

    assert result["action"] == "none"
    assert result["last_session"] == date(2026, 9, 9)
    assert calls == ["SPY"]  # session derivation happened; AAPL was never fetched


def test_refresh_ticker_stale_no_drift_appends(monkeypatch):
    stored = _bars(["2026-09-08", "2026-09-09"], adj_closes=[100.0, 101.0])
    store("AAPL", stored)

    reference_bars = _bars(["2026-09-08", "2026-09-09", "2026-09-10"])
    # AAPL's "fresh" range: re-fetch of 09-09 (partial-bar guard) plus new 09-10 bar, same values
    aapl_fresh = _bars(["2026-09-09", "2026-09-10"], adj_closes=[101.0, 102.0])

    def fake_download(ticker, start, end):
        if ticker == "SPY":
            return reference_bars
        assert ticker == "AAPL"
        assert (start, end) == (date(2026, 9, 9), date(2026, 9, 10))
        return aapl_fresh

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    _patch_now(monkeypatch, datetime(2026, 9, 10, 17, tzinfo=ZoneInfo("America/New_York")))

    result = refresh_ticker("AAPL")

    assert result["action"] == "appended"
    assert result["drift_detected"] is False
    assert result["bars_before"] == 2
    assert result["bars_after"] == 3

    stored_after = get_cached("AAPL")
    assert len(stored_after) == 3
    assert stored_after.loc["2026-09-10", "adj_close"] == 102.0


def test_refresh_ticker_stale_with_drift_refetches_full_span(monkeypatch):
    stored = _bars(
        ["2026-09-01", "2026-09-08", "2026-09-09"], adj_closes=[400.0, 404.0, 404.0]
    )
    store("AAPL", stored)

    reference_bars = _bars(["2026-09-08", "2026-09-09", "2026-09-10"])
    # Narrow "fresh" range shows the split's effect on the most recent stored bar (09-09):
    # a 4:1 split has restated it from 404.0 to 101.0.
    aapl_narrow_fresh = _bars(["2026-09-09", "2026-09-10"], adj_closes=[101.0, 102.0])
    # Full-span refetch, post-split, covering everything from 09-01 (stored's oldest) onward.
    aapl_full_fresh = _bars(
        ["2026-09-01", "2026-09-08", "2026-09-09", "2026-09-10"],
        adj_closes=[100.0, 101.0, 101.0, 102.0],
    )

    calls = []

    def fake_download(ticker, start, end):
        calls.append((ticker, start, end))
        if ticker == "SPY":
            return reference_bars
        if (start, end) == (date(2026, 9, 9), date(2026, 9, 10)):
            return aapl_narrow_fresh
        if (start, end) == (date(2026, 9, 1), date(2026, 9, 10)):
            return aapl_full_fresh
        raise AssertionError(f"unexpected range {start}..{end}")

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    _patch_now(monkeypatch, datetime(2026, 9, 10, 17, tzinfo=ZoneInfo("America/New_York")))

    result = refresh_ticker("AAPL")

    assert result["action"] == "refetched"
    assert result["drift_detected"] is True
    assert result["bars_after"] == 4

    # Confirm the full stored span was actually refetched, not just the missing range.
    aapl_calls = [c for c in calls if c[0] == "AAPL"]
    assert (
        "AAPL",
        date(2026, 9, 1),
        date(2026, 9, 10),
    ) in aapl_calls


def test_refresh_ticker_force_true_fetches_even_when_fresh(monkeypatch):
    stored = _bars(["2026-09-08", "2026-09-09"], adj_closes=[100.0, 101.0])
    store("AAPL", stored)

    reference_bars = _bars(["2026-09-08", "2026-09-09"])
    aapl_recheck = _bars(["2026-09-09"], adj_closes=[101.0])
    calls = []

    def fake_download(ticker, start, end):
        calls.append(ticker)
        if ticker == "SPY":
            return reference_bars
        assert ticker == "AAPL"
        return aapl_recheck

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    _patch_now(monkeypatch, datetime(2026, 9, 9, 17, tzinfo=ZoneInfo("America/New_York")))

    result = refresh_ticker("AAPL", force=True)

    assert "AAPL" in calls  # fetched despite already being fresh
    assert result["action"] != "none"


# --- fix: reference-ticker session derivation must be cached across tickers --------------


def test_refresh_ticker_caches_reference_session_across_tickers(monkeypatch):
    """REBUILD.md: the derived last_session 'changes once a day' and should be cached, so
    refreshing N tickers costs one SPY fetch, not N. Both tickers here are already fresh, so
    a call counter on the SPY branch isolates exactly what's being tested — neither ticker's
    own history should be fetched at all, and SPY should be fetched exactly once, not twice."""
    store("AAPL", _bars(["2026-09-08", "2026-09-09"], adj_closes=[100.0, 101.0]))
    store("MSFT", _bars(["2026-09-08", "2026-09-09"], adj_closes=[200.0, 201.0]))

    reference_bars = _bars(["2026-09-08", "2026-09-09"])
    spy_call_count = 0

    def fake_download(ticker, start, end):
        nonlocal spy_call_count
        if ticker == "SPY":
            spy_call_count += 1
            return reference_bars
        raise AssertionError(f"unexpected download for {ticker}")

    monkeypatch.setattr("app.market_data._download_history", fake_download)
    _patch_now(monkeypatch, datetime(2026, 9, 9, 17, tzinfo=ZoneInfo("America/New_York")))

    result_aapl = refresh_ticker("AAPL")
    result_msft = refresh_ticker("MSFT")

    assert result_aapl["action"] == "none"
    assert result_msft["action"] == "none"
    assert spy_call_count == 1
