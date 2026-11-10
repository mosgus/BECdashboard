from datetime import date

import pandas as pd
import pytest
from sqlalchemy import create_engine, delete

from app import cache
from app.db import session
from app.models import Base, PriceBar


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_adj_closes.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def _seed(ticker="AAA", adj_closes=(10.0, None, 12.0)):
    for bar_date, close, adj_close in zip(
        (date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4)),
        (10.0, 11.0, 12.0), adj_closes, strict=True,
    ):
        with session() as db:
            db.add(PriceBar(
                ticker=ticker, date=bar_date, open=close, high=close, low=close,
                close=close, adj_close=adj_close, volume=100,
            ))


def _delete_all(engine):
    with engine.begin() as connection:
        connection.execute(delete(PriceBar))


def test_loads_adjusted_closes_and_plain_date_index(db_mode):
    _seed()

    closes = cache.get_adj_closes(["AAA", "ZZZ"])

    assert list(closes) == ["AAA"]
    assert closes["AAA"].tolist() == [10.0, 12.0]
    assert closes["AAA"].index.tolist() == [date(2024, 1, 2), date(2024, 1, 4)]
    assert all(type(value) is date for value in closes["AAA"].index)


def test_hit_survives_direct_database_delete(db_mode):
    _seed()
    assert cache.get_adj_closes(["AAA"])["AAA"].tolist() == [10.0, 12.0]
    _delete_all(db_mode)

    assert cache.get_adj_closes(["AAA"])["AAA"].tolist() == [10.0, 12.0]


def test_store_invalidates_adjusted_close_cache(db_mode):
    _seed()
    cache.get_adj_closes(["AAA"])
    frame = pd.DataFrame(
        {"open": [13.0], "high": [13.0], "low": [13.0], "close": [13.0],
         "adj_close": [13.0], "volume": [100]},
        index=pd.DatetimeIndex(["2024-01-05"]),
    )
    cache.store("AAA", frame)

    assert cache.get_adj_closes(["AAA"])["AAA"].tolist() == [10.0, 12.0, 13.0]


def test_evict_invalidates_adjusted_close_cache_case_insensitively(db_mode):
    _seed()
    cache.get_adj_closes(["AAA"])
    _delete_all(db_mode)
    cache.evict("aaa")

    assert cache.get_adj_closes(["AAA"]) == {}


def test_absence_is_not_cached(db_mode):
    assert cache.get_adj_closes(["BBB"]) == {}
    _seed("BBB", (20.0, 21.0, 22.0))

    assert cache.get_adj_closes(["BBB"])["BBB"].tolist() == [20.0, 21.0, 22.0]


def test_returned_series_are_copies(db_mode):
    _seed()
    first = cache.get_adj_closes(["AAA"])
    first["AAA"].iloc[0] = -1.0

    assert cache.get_adj_closes(["AAA"])["AAA"].iloc[0] == 10.0


def test_order_and_deduplication(db_mode):
    _seed("AAA")
    _seed("BBB", (20.0, 21.0, 22.0))

    assert list(cache.get_adj_closes(["BBB", "AAA"])) == ["BBB", "AAA"]
    assert list(cache.get_adj_closes(["AAA", "AAA"])) == ["AAA"]


def test_one_session_for_misses_and_none_for_hits(db_mode, monkeypatch):
    _seed("AAA")
    _seed("BBB", (20.0, 21.0, 22.0))
    original = cache.session
    calls = []

    def counting_session(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(cache, "session", counting_session)
    cache.get_adj_closes(["AAA", "BBB"])
    assert len(calls) == 1

    calls.clear()
    cache.get_adj_closes(["AAA", "BBB"])
    assert len(calls) == 0
