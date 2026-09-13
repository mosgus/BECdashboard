import pandas as pd
import pandas.testing as pd_testing
from app.cache import get_cached, store, clear


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
