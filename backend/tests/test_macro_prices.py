import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytest

from app.db import get_engine, session
from app.macro_prices import PriceCoverage, load_prices, price_coverage, prices_version, store_series
from app.models import Base, MacroPriceSeries

UTC = timezone.utc
NAN = float("nan")
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_macro_prices.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _series(values, dates) -> pd.Series:
    return pd.Series(values, index=pd.to_datetime(dates))


def _ns(*dates: str) -> pd.DatetimeIndex:
    return pd.DatetimeIndex(pd.to_datetime(list(dates)).as_unit("ns"))


def test_nan_closes_are_dropped_and_an_all_nan_ticker_is_skipped(db_mode):
    written = store_series(
        {
            "AAA": _series([1.0, NAN, 3.0], ["2026-01-02", "2026-01-05", "2026-01-06"]),
            "BBB": _series([NAN], ["2026-01-02"]),
        },
        datetime(2026, 11, 9, 21, 0, tzinfo=UTC),
    )

    assert written == 1
    prices = load_prices()
    assert list(prices.columns) == ["AAA"]
    assert prices.index.equals(_ns("2026-01-02", "2026-01-06"))
    assert prices["AAA"].tolist() == [1.0, 3.0]
    assert prices.index.dtype == "datetime64[ns]" and prices["AAA"].dtype == "float64"


def test_infinite_closes_are_dropped_like_nan(db_mode):
    written = store_series(
        {
            "AAA": _series([1.0, float("inf"), 3.0, float("-inf")],
                           ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"]),
            "BBB": _series([float("inf"), float("-inf"), NAN], ["2026-01-02", "2026-01-05", "2026-01-06"]),
        },
        datetime(2026, 11, 9, 21, 0, tzinfo=UTC),
    )

    assert written == 1  # BBB has nothing finite, so it is skipped like an all-NaN series
    with session() as db:
        assert db.get(MacroPriceSeries, "AAA").closes == [1.0, 3.0]
        assert db.get(MacroPriceSeries, "BBB") is None
    prices = load_prices()
    assert prices.index.equals(_ns("2026-01-02", "2026-01-06"))
    assert prices.index.dtype == "datetime64[ns]"
    assert prices["AAA"].tolist() == [1.0, 3.0]


def test_tickers_with_different_dates_load_into_the_union_index(db_mode):
    store_series(
        {
            "ZZZ": _series([10.0, 11.0], ["2026-01-05", "2026-01-07"]),
            "AAA": _series([1.0, 2.0, 3.0], ["2026-01-02", "2026-01-05", "2026-01-06"]),
        },
        datetime(2026, 11, 9, 21, 0, tzinfo=UTC),
    )

    expected = pd.DataFrame(
        {
            "AAA": [1.0, 2.0, 3.0, NAN],
            "ZZZ": [NAN, 10.0, NAN, 11.0],
        },
        index=_ns("2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"),
    )
    pd.testing.assert_frame_equal(load_prices(), expected)


def test_series_are_sorted_by_date_before_they_are_stored(db_mode):
    store_series({"AAA": _series([3.0, 1.0, 2.0], ["2026-01-06", "2026-01-02", "2026-01-05"])},
                 datetime(2026, 11, 9, 21, 0, tzinfo=UTC))

    with session() as db:
        row = db.get(MacroPriceSeries, "AAA")
        assert row.days == sorted(row.days)
        assert row.closes == [1.0, 2.0, 3.0]
        assert all(type(day) is int for day in row.days)


def test_storing_a_ticker_again_replaces_it_and_an_all_nan_series_leaves_it_alone(db_mode):
    when = datetime(2026, 11, 9, 21, 0, tzinfo=UTC)
    store_series({"AAA": _series([1.0, 2.0], ["2026-01-02", "2026-01-05"])}, when)

    store_series({"AAA": _series([7.0, 8.0, 9.0], ["2026-02-02", "2026-02-03", "2026-02-04"])}, when)
    replaced = load_prices()
    assert replaced.index.equals(_ns("2026-02-02", "2026-02-03", "2026-02-04"))
    assert replaced["AAA"].tolist() == [7.0, 8.0, 9.0]

    assert store_series({"AAA": _series([NAN, NAN], ["2026-03-02", "2026-03-03"])}, when) == 0
    pd.testing.assert_frame_equal(load_prices(), replaced)


def test_floats_round_trip_exactly(db_mode):
    values = [0.1 + 0.2, 1 / 3, 123456.789012345678]
    store_series({"AAA": _series(values, ["2026-01-02", "2026-01-05", "2026-01-06"])},
                 datetime(2026, 11, 9, 21, 0, tzinfo=UTC))
    assert load_prices()["AAA"].tolist() == values


def test_an_empty_table_gives_an_empty_frame_and_no_version(db_mode):
    prices = load_prices()
    assert prices.empty and isinstance(prices.index, pd.DatetimeIndex)
    assert prices_version() is None
    assert price_coverage() == PriceCoverage(0, None, None)


def test_prices_version_is_the_newest_fetched_at(db_mode):
    older = datetime(2026, 11, 9, 21, 0, tzinfo=UTC)
    newer = datetime(2026, 11, 10, 21, 30, tzinfo=UTC)
    store_series({"AAA": _series([1.0], ["2026-01-02"])}, older)
    assert prices_version() == older.isoformat()

    store_series({"BBB": _series([2.0], ["2026-01-02"])}, newer)
    assert prices_version() == newer.isoformat()
    assert price_coverage() == PriceCoverage(2, older, newer)


def test_a_non_utc_fetched_at_is_stored_as_the_same_instant(db_mode):
    eastern = datetime.fromisoformat("2026-11-09T16:00:00-05:00")
    store_series({"AAA": _series([1.0], ["2026-01-02"])}, eastern)
    assert price_coverage().newest_fetched_at == datetime(2026, 11, 9, 21, 0, tzinfo=UTC)


def test_more_tickers_than_one_insert_batch_all_land(db_mode):
    tickers = {f"T{i:04d}": _series([float(i)], ["2026-01-02"]) for i in range(250)}
    assert store_series(tickers, datetime(2026, 11, 9, 21, 0, tzinfo=UTC)) == 250
    prices = load_prices()
    assert list(prices.columns) == sorted(tickers)
    assert prices.iloc[0].tolist() == [float(i) for i in range(250)]


def test_the_seed_script_refuses_to_run_without_a_database():
    env = {**os.environ, "DATABASE_URL": ""}
    result = subprocess.run(
        [sys.executable, "hard_data/seed_macro_prices.py", "/nonexistent/prices_cache.pkl"],
        cwd=BACKEND, env=env, capture_output=True, text=True,
    )
    assert result.returncode != 0
    assert "DATABASE_URL" in result.stderr
