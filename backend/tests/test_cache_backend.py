import pandas as pd
import pandas.testing as pd_testing
import pytest

from app.cache import clear, get_cached, store
from app.db import get_engine, is_enabled, normalize_database_url
from app.models import Base


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    """Point DATABASE_URL at a fresh, isolated SQLite file and create its schema.
    A distinct tmp_path per test forces app.db to build a brand-new engine, so tests
    never share database state."""
    url = f"sqlite:///{tmp_path}/test_cache_backend.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def degraded_mode(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    yield


def _ohlcv_df(dates, opens, highs, lows, closes, volumes, adj_closes=None):
    """Six-column canonical shape. adj_closes defaults to all-NaN, matching what
    _normalize_ohlcv produces for a caller that never supplies it."""
    index = pd.to_datetime(list(dates))
    index.name = "date"
    if adj_closes is None:
        adj_closes = [float("nan")] * len(dates)
    return pd.DataFrame(
        {
            "open": pd.array(opens, dtype="float64"),
            "high": pd.array(highs, dtype="float64"),
            "low": pd.array(lows, dtype="float64"),
            "close": pd.array(closes, dtype="float64"),
            "adj_close": pd.array(adj_closes, dtype="float64"),
            "volume": pd.array(volumes, dtype="Int64"),
        },
        index=index,
    )


# --- 1. get_cached returns None for an unknown ticker, both modes -------------------


def test_get_cached_none_for_unknown_ticker_degraded(degraded_mode):
    assert get_cached("NOPE") is None


def test_get_cached_none_for_unknown_ticker_database(db_mode):
    assert get_cached("NOPE") is None


# --- 2. store -> get_cached round-trips a DataFrame intact, database mode ----------


def test_store_get_cached_round_trips_database(db_mode):
    df = _ohlcv_df(
        ["2024-01-02", "2024-01-03"],
        [100.0, 101.0],
        [101.5, 102.0],
        [99.5, 100.5],
        [101.0, 101.5],
        [1_000_000, 1_100_000],
    )
    store("AAPL", df)
    clear()  # defeat the TTL cache so get_cached is forced to read from the database
    result = get_cached("AAPL")
    pd_testing.assert_frame_equal(result, df)


# --- store() must normalize once, so TTL and database reads are structurally identical --
# (yfinance-shaped input: index named Date at datetime64[s], columns Capitalized, volume
# int64 — not the already-canonical shape _ohlcv_df produces. A round-trip test whose input
# shape already equals its output shape cannot catch a store()-side normalization bug.)


def test_ttl_and_database_reads_are_structurally_identical(db_mode):
    index = pd.to_datetime(["2024-01-02", "2024-01-03"]).astype("datetime64[s]")
    index.name = "Date"
    yfinance_shaped = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [101.5, 102.0],
            "Low": [99.5, 100.5],
            "Close": [101.0, 101.5],
            "Volume": pd.array([1_000_000, 1_100_000], dtype="int64"),
        },
        index=index,
    )

    store("NFLX", yfinance_shaped)
    from_ttl = get_cached("NFLX")

    clear()
    from_db = get_cached("NFLX")

    pd_testing.assert_frame_equal(from_ttl, from_db)


# --- 0005 criterion 3: shape consistency for a frame that never supplies adj_close -----


def test_shape_consistency_without_adj_close(db_mode):
    """A caller who never supplies adj_close still gets six identical columns, in
    canonical order, back from both the TTL cache and the database — adj_close filled
    with NA rather than dropped."""
    df = _ohlcv_df(
        ["2024-01-02", "2024-01-03"],
        [100.0, 101.0],
        [101.5, 102.0],
        [99.5, 100.5],
        [101.0, 101.5],
        [1_000_000, 1_100_000],
    )
    store("ORCL", df)
    from_ttl = get_cached("ORCL")

    clear()
    from_db = get_cached("ORCL")

    pd_testing.assert_frame_equal(from_ttl, from_db)
    assert list(from_ttl.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert from_ttl["adj_close"].isna().all()


# --- 0005 criterion 4: yfinance's literal 'Adj Close' column name is normalized --------


def test_yfinance_adj_close_column_name_normalized(db_mode):
    """Real auto_adjust=False yfinance output names the column 'Adj Close'. Normalization
    must map it to adj_close (space -> underscore), and TTL/database reads must agree."""
    index = pd.to_datetime(["2024-01-02", "2024-01-03"]).astype("datetime64[s]")
    index.name = "Date"
    yfinance_shaped = pd.DataFrame(
        {
            "Open": [100.0, 101.0],
            "High": [101.5, 102.0],
            "Low": [99.5, 100.5],
            "Close": [101.0, 101.5],
            "Adj Close": [99.0, 100.25],
            "Volume": pd.array([1_000_000, 1_100_000], dtype="int64"),
        },
        index=index,
    )

    store("IBM", yfinance_shaped)
    from_ttl = get_cached("IBM")

    clear()
    from_db = get_cached("IBM")

    pd_testing.assert_frame_equal(from_ttl, from_db)
    assert list(from_ttl.columns) == ["open", "high", "low", "close", "adj_close", "volume"]
    assert from_ttl["adj_close"].tolist() == [99.0, 100.25]


# --- 3. case-insensitivity survives the database ------------------------------------


def test_case_insensitivity_survives_database(db_mode):
    df = _ohlcv_df(["2024-01-02"], [100.0], [101.0], [99.0], [100.5], [500_000])
    store("aapl", df)
    clear()
    result = get_cached("AAPL")
    pd_testing.assert_frame_equal(result, df)


# --- 4. upsert: overlapping dates twice leaves one row per (ticker, date) -----------
#         with the second write's values. The partial-bar guard — most important test.


def test_upsert_overlapping_dates_keeps_second_write(db_mode):
    first = _ohlcv_df(
        ["2024-01-02", "2024-01-03"],
        [100.0, 101.0],
        [101.0, 102.0],
        [99.0, 100.0],
        [100.5, 101.5],
        [1_000_000, 1_000_000],
    )
    store("MSFT", first)

    second = _ohlcv_df(
        ["2024-01-03", "2024-01-04"],
        [200.0, 201.0],
        [202.0, 203.0],
        [199.0, 200.0],
        [201.5, 202.5],
        [2_000_000, 2_000_000],
    )
    store("MSFT", second)

    clear()
    result = get_cached("MSFT")

    assert len(result) == 3, "overlapping date must not duplicate — one row per (ticker, date)"

    row_02 = result.loc["2024-01-02"]
    assert row_02["close"] == 100.5

    row_03 = result.loc["2024-01-03"]
    assert row_03["open"] == 200.0
    assert row_03["close"] == 201.5
    assert row_03["volume"] == 2_000_000

    row_04 = result.loc["2024-01-04"]
    assert row_04["close"] == 202.5


# --- 5. clear() empties the in-process cache and leaves database rows intact -------


def test_clear_leaves_database_rows_intact(db_mode):
    df = _ohlcv_df(["2024-01-02"], [100.0], [101.0], [99.0], [100.5], [500_000])
    store("GOOG", df)

    clear()

    # If clear() had touched the database, this would come back None.
    result = get_cached("GOOG")
    assert result is not None
    pd_testing.assert_frame_equal(result, df)


# --- 6. degraded mode: is_enabled() False, app behaves TTL-only --------------------


def test_degraded_mode_is_enabled_false(degraded_mode):
    assert is_enabled() is False
    assert get_engine() is None


def test_degraded_mode_store_and_get_are_ttl_only(degraded_mode):
    df = pd.DataFrame({"price": [1.0, 2.0]})
    store("TSLA", df)
    result = get_cached("TSLA")
    pd_testing.assert_frame_equal(result, df)


# --- 7. a postgres:// URL is rewritten to postgresql+psycopg:// --------------------


def test_postgres_url_rewritten_for_psycopg():
    assert (
        normalize_database_url("postgres://user:pw@host:5432/db")
        == "postgresql+psycopg://user:pw@host:5432/db"
    )


def test_non_postgres_url_left_unchanged():
    url = "sqlite:///already-fine.db"
    assert normalize_database_url(url) == url
