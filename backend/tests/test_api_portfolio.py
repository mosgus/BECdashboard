from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_portfolio.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _insert_bars(ticker, adj_closes, dates=(date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4))):
    with session() as db:
        for bar_date, adj_close in zip(dates, adj_closes, strict=True):
            db.add(PriceBar(
                ticker=ticker, date=bar_date, open=adj_close * 2, high=adj_close * 2,
                low=adj_close * 2, close=adj_close * 2, adj_close=adj_close, volume=100,
            ))


def _seed_case_a():
    _insert_bars("AAA", [10, 11, 12])
    _insert_bars("BBB", [20, 20, 25])


def test_series_uses_adjusted_closes_and_reports_holdings(client, db_mode):
    _seed_case_a()

    response = client.get("/portfolio/series?tickers=AAA,BBB&weights=60,40")

    assert response.status_code == 200
    body = response.json()
    assert body["value"] == pytest.approx([82, 87, 100], abs=0.01)
    assert body["cash_value"] == 0
    assert body["holdings"] == [
        {"ticker": "AAA", "weight": 60, "first_bar": "2024-01-02", "last_close": 12},
        {"ticker": "BBB", "weight": 40, "first_bar": "2024-01-02", "last_close": 25},
    ]


def test_close_only_indicator_series(client, db_mode):
    _seed_case_a()

    body = client.get("/portfolio/series?tickers=AAA,BBB&weights=60,40&include=sma,rsi,macd").json()

    assert [series["key"] for series in body["series"]] == [
        "sma_fast", "sma_slow", "rsi", "macd_line", "macd_signal", "macd_histogram",
    ]
    assert all(len(series["points"]) == len(body["dates"]) for series in body["series"])


@pytest.mark.parametrize("include", ["donchian", "obv"])
def test_non_close_indicator_is_rejected(client, db_mode, include):
    _seed_case_a()

    response = client.get(f"/portfolio/series?tickers=AAA,BBB&weights=60,40&include={include}")

    assert response.status_code == 400


def test_unstored_ticker_is_not_found(client, db_mode):
    response = client.get("/portfolio/series?tickers=MISS&weights=100")

    assert response.status_code == 404
    assert response.json()["detail"] == "No stored price history for MISS"


def test_duplicate_ticker_is_rejected(client, db_mode):
    response = client.get("/portfolio/series?tickers=AAA,AAA&weights=50,50")

    assert response.status_code == 400
    assert response.json()["detail"] == "Duplicate ticker: AAA"


def test_weights_count_must_match_tickers(client, db_mode):
    response = client.get("/portfolio/series?tickers=AAA,BBB&weights=100")

    assert response.status_code == 400
    assert response.json()["detail"] == "weights must be one number per ticker"


def test_cash_must_be_nonnegative(client, db_mode):
    response = client.get("/portfolio/series?tickers=AAA&weights=100&cash=-1")

    assert response.status_code == 400
    assert response.json()["detail"] == "cash must be zero or positive"


def test_signals_have_the_three_expected_kinds(client, db_mode):
    _seed_case_a()

    response = client.get("/portfolio/series?tickers=AAA,BBB&weights=60,40")

    assert [signal["signal"] for signal in response.json()["signals"]] == [
        "sma_cross", "rsi_threshold", "macd_cross"
    ]
