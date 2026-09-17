import pandas as pd
import pandas.testing as pd_testing
from app.cache import evict, get_cached, store, clear


def test_get_cached_returns_none_for_missing_ticker():
    """get_cached returns None for a ticker never stored"""
    clear()
    result = get_cached("MISSING")
    assert result is None


def test_store_and_get_round_trips_dataframe():
    """store then get_cached round-trips a DataFrame intact"""
    clear()
    df = pd.DataFrame({"date": ["2024-01-01", "2024-01-02"], "price": [100.0, 101.0]})
    store("AAPL", df)
    result = get_cached("AAPL")
    pd_testing.assert_frame_equal(result, df)


def test_lookup_is_case_insensitive():
    """lookup is case-insensitive: store("aapl", df) then get_cached("AAPL") returns df"""
    clear()
    df = pd.DataFrame({"date": ["2024-01-01"], "price": [100.0]})
    store("aapl", df)
    result = get_cached("AAPL")
    pd_testing.assert_frame_equal(result, df)


def test_clear_empties_cache():
    """clear() empties the cache"""
    clear()
    df = pd.DataFrame({"date": ["2024-01-01"], "price": [100.0]})
    store("MSFT", df)
    assert get_cached("MSFT") is not None
    clear()
    assert get_cached("MSFT") is None


# --- contract 0024: a row with no close is never stored -------------------------------------
#
# tests/test_cache.py has been untouchable since contract 0004; these three cases are added
# here because the contract explicitly names this file as the exception, for exactly this
# guard. No existing test above was changed.


def _ohlcv_frame(dates, closes) -> pd.DataFrame:
    """An OHLCV-shaped frame with open/high/low/volume always present, closes possibly null —
    the exact shape of the real AAPL bug: an in-progress intraday bar fetched before the
    session's close was published."""
    n = len(dates)
    index = pd.to_datetime(list(dates)).astype("datetime64[us]")
    index.name = "date"
    return pd.DataFrame(
        {
            "open": pd.array([100.0 + i for i in range(n)], dtype="float64"),
            "high": pd.array([101.0 + i for i in range(n)], dtype="float64"),
            "low": pd.array([99.0 + i for i in range(n)], dtype="float64"),
            "close": pd.array(closes, dtype="float64"),
            "adj_close": pd.array(closes, dtype="float64"),
            "volume": pd.array([1_000_000 + i for i in range(n)], dtype="Int64"),
        },
        index=index,
    )


def test_store_drops_the_row_whose_close_is_null():
    """The AAPL bug, reproduced: storing a frame whose newest row has a null close drops
    that row — the stored bar count is one less, and the newest remaining bar is the
    previous date."""
    clear()
    df = _ohlcv_frame(["2016-09-12", "2016-09-13", "2016-09-14"], [330.0, 334.83, None])
    store("AAPL", df)

    result = get_cached("AAPL")
    assert len(result) == 2
    assert result.index.max().date().isoformat() == "2016-09-13"


def test_store_null_close_row_ttl_cache_and_database_agree(tmp_path, monkeypatch):
    """After a write that drops a null-close row, get_cached() returns the same filtered
    frame the database holds — the TTL cache and the database must never disagree about
    which rows exist (contract 0004's audit found them diverge once already)."""
    from app.db import get_engine
    from app.models import Base

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_cache_null_close.db")
    engine = get_engine()
    Base.metadata.create_all(engine)
    clear()

    df = _ohlcv_frame(["2016-09-13", "2016-09-14"], [334.83, None])
    store("AAPL", df)

    from_cache = get_cached("AAPL")
    clear()  # force the next get_cached to reconstruct from the database, not the TTL cache
    from_db = get_cached("AAPL")

    pd_testing.assert_frame_equal(from_cache, from_db)
    assert len(from_cache) == 1
    assert from_cache.index.max().date().isoformat() == "2016-09-13"


def test_store_entirely_null_close_frame_is_noop_not_error():
    """A frame that is entirely null-close writes nothing and does not raise."""
    clear()
    df = _ohlcv_frame(["2016-09-13", "2016-09-14"], [None, None])
    store("AAPL", df)  # must not raise

    result = get_cached("AAPL")
    assert result is not None
    assert len(result) == 0


# --- contract 0038: evict --------------------------------------------------------------------


def test_evict_drops_the_ticker_from_the_in_process_cache():
    clear()
    df = pd.DataFrame({"date": ["2024-01-01"], "price": [100.0]})
    store("AAPL", df)
    assert get_cached("AAPL") is not None

    evict("AAPL")

    assert get_cached("AAPL") is None


def test_evict_is_case_insensitive():
    clear()
    df = pd.DataFrame({"date": ["2024-01-01"], "price": [100.0]})
    store("aapl", df)

    evict("AAPL")

    assert get_cached("aapl") is None


def test_evict_is_a_noop_for_a_ticker_never_cached():
    clear()
    evict("NEVERCACHED")  # must not raise


def test_evict_does_not_affect_other_tickers():
    clear()
    store("AAPL", pd.DataFrame({"date": ["2024-01-01"], "price": [100.0]}))
    store("MSFT", pd.DataFrame({"date": ["2024-01-01"], "price": [200.0]}))

    evict("AAPL")

    assert get_cached("AAPL") is None
    assert get_cached("MSFT") is not None
