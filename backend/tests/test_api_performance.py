import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


DATES = [day.date() for day in pd.bdate_range("2024-01-02", periods=140)]
DATA = {
    "A": [100 * 1.001**index for index in range(140)],
    "B": [50 + (index % 2) for index in range(140)],
    "M": [200 + index for index in range(140)],
}


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/performance.db")
    Base.metadata.create_all(get_engine())
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate_with_source", lambda: (0.04, "live"))


@pytest.fixture
def client():
    return TestClient(app)


def seed():
    for ticker, values in DATA.items():
        with session() as db:
            for day, value in zip(DATES, values, strict=True):
                db.add(PriceBar(ticker=ticker, date=day, open=value, high=value, low=value, close=value, adj_close=value, volume=1))


def body(**more):
    return {"tickers": ["A", "B"], "weights": [1, 1], "cash": 2, "start": "2024-01-02", "end": "2024-07-15", "market_ticker": "M", **more}


def test_success(client, db_mode):
    seed()
    response = client.post("/portfolio/performance", json=body(end=DATES[-1].isoformat()))
    assert response.status_code == 200
    assert response.json()["rf"] == 0.04 and response.json()["rf_source"] == "live"
    assert response.json()["bench_metrics"] is not None
    assert len(response.json()["path"]) == response.json()["n_days"] + 1


def test_missing_end_defaults_to_latest_stored_price(client, db_mode):
    seed()
    response = client.post("/portfolio/performance", json=body(end=None))
    assert response.status_code == 200 and response.json()["n_days"] == 139


def test_short_window_returns_422(client, db_mode):
    seed()
    response = client.post("/portfolio/performance", json=body(end=DATES[10].isoformat()))
    assert response.status_code == 422 and "at least 20 trading days" in response.json()["detail"]


def test_unknown_market_returns_stress_message(client, db_mode):
    seed()
    response = client.post("/portfolio/performance", json=body(market_ticker="VT"))
    assert response.status_code == 422 and "No stored price history for market ticker" in response.json()["detail"]
