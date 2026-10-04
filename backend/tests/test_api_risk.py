import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar

DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]
m = np.tile([0.01, -0.01, 0.01, -0.01], 65)
e1 = np.tile([0.01, 0.01, -0.01, -0.01], 65)
e2 = np.tile([0.01, -0.01, -0.01, 0.01], 65)


def prices(returns): return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=DATES)


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_risk.db")
    Base.metadata.create_all(get_engine())


@pytest.fixture
def client(): return TestClient(app)


def seed():
    for ticker, values in {"A": prices(1.5 * m + e1), "B": prices(.5 * m + e2), "M": prices(m)}.items():
        with session() as db:
            for day, value in values.items(): db.add(PriceBar(ticker=ticker, date=day, open=value, high=value, low=value, close=value, adj_close=value, volume=100))


def test_success(client, db_mode):
    seed()
    response = client.post("/portfolio/risk", json={"tickers": ["a", "B"], "weights": [1, 1], "cash": 0, "lookback_days": 365, "market_ticker": "m"})
    assert response.status_code == 200
    body = response.json()
    assert (body["tickers"], body["market_ticker"]) == (["A", "B"], "M")
    assert [holding["risk_share"] for holding in body["holdings"]] == pytest.approx((2 / 3, 1 / 3), abs=1e-9)


def test_unknown_market_ticker(client, db_mode):
    seed()
    response = client.post("/portfolio/risk", json={"tickers": ["A", "B"], "weights": [1, 1], "market_ticker": "VT"})
    assert response.status_code == 422 and "No stored price history for market ticker" in response.json()["detail"]


def test_short_lookback(client, db_mode):
    seed()
    assert client.post("/portfolio/risk", json={"tickers": ["A", "B"], "weights": [1, 1], "market_ticker": "M", "lookback_days": 10}).status_code == 422
