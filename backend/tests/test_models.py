from datetime import date, datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.models import Base, PriceBar, TickerFundamentals


@pytest.fixture
def engine(tmp_path):
    eng = create_engine(f"sqlite:///{tmp_path}/test_models.db")
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db_session(engine):
    factory = sessionmaker(bind=engine)
    s = factory()
    yield s
    s.close()


def test_schema_creates_both_tables(engine):
    """Base.metadata.create_all produces both price_bars and ticker_fundamentals."""
    table_names = set(inspect(engine).get_table_names())
    assert {"price_bars", "ticker_fundamentals"} <= table_names


def test_price_bars_has_date_index(engine):
    """price_bars.date is indexed, per the contract's explicit requirement."""
    indexes = inspect(engine).get_indexes("price_bars")
    indexed_columns = {col for index in indexes for col in index["column_names"]}
    assert "date" in indexed_columns


def test_price_bars_round_trip(db_session):
    """A plain PriceBar row can be inserted and read back with matching values."""
    bar = PriceBar(
        ticker="AAPL",
        date=date(2024, 1, 2),
        open=100.0,
        high=101.5,
        low=99.5,
        close=101.0,
        volume=1_000_000,
    )
    db_session.add(bar)
    db_session.commit()

    fetched = db_session.get(PriceBar, ("AAPL", date(2024, 1, 2)))
    assert fetched is not None
    assert fetched.open == 100.0
    assert fetched.close == 101.0
    assert fetched.volume == 1_000_000


def test_price_bars_adj_close_round_trip(db_session):
    """adj_close persists alongside raw OHLC and independently of it — the restatement-
    prone value contract 0006's drift detection compares against a fresh fetch. Deliberately
    different from close here to prove the two columns aren't conflated."""
    bar = PriceBar(
        ticker="AAPL",
        date=date(2024, 1, 3),
        open=100.0,
        high=101.0,
        low=99.0,
        close=101.0,
        adj_close=25.25,
        volume=1_000_000,
    )
    db_session.add(bar)
    db_session.commit()

    fetched = db_session.get(PriceBar, ("AAPL", date(2024, 1, 3)))
    assert fetched is not None
    assert fetched.adj_close == 25.25
    assert fetched.close == 101.0


def test_price_bars_adj_close_is_nullable(db_session):
    """A row stored without adj_close (nothing has fetched it yet) must not raise."""
    bar = PriceBar(
        ticker="MSFT",
        date=date(2024, 1, 3),
        open=100.0,
        high=101.0,
        low=99.0,
        close=101.0,
        volume=1_000_000,
    )
    db_session.add(bar)
    db_session.commit()

    fetched = db_session.get(PriceBar, ("MSFT", date(2024, 1, 3)))
    assert fetched.adj_close is None


def test_ticker_fundamentals_etf_shaped_row(db_session):
    """ETFs genuinely lack sector, industry, market_cap, and beta — a NOT NULL on any of
    these would make SPY unstorable. All must accept None."""
    spy = TickerFundamentals(
        ticker="SPY",
        short_name="SPDR S&P 500 ETF Trust",
        long_name=None,
        sector=None,
        industry=None,
        currency="USD",
        exchange="PCX",
        quote_type="ETF",
        regular_market_price=500.0,
        previous_close=498.0,
        market_cap=None,
        trailing_pe=None,
        forward_pe=None,
        dividend_yield=1.3,
        fifty_two_week_high=520.0,
        fifty_two_week_low=410.0,
        beta=None,
        average_volume=70_000_000,
        fetched_at=datetime.now(timezone.utc),
    )
    db_session.add(spy)
    db_session.commit()

    fetched = db_session.get(TickerFundamentals, "SPY")
    assert fetched is not None
    assert fetched.sector is None
    assert fetched.industry is None
    assert fetched.market_cap is None
    assert fetched.beta is None
    assert fetched.quote_type == "ETF"


def test_price_bars_has_no_foreign_keys(engine):
    """Cached market data must not depend on a curated-ticker table existing."""
    fks = inspect(engine).get_foreign_keys("price_bars")
    assert fks == []
