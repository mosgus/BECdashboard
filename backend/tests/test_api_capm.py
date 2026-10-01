from datetime import date

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


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


M = prices(m)
A = prices(1.5 * m + e1)
B = prices(0.5 * m + e2)


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_capm.db")
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _insert(ticker, values):
    with session() as db:
        for bar_date, value in values.items():
            db.add(PriceBar(ticker=ticker, date=bar_date, open=value, high=value, low=value,
                            close=value, adj_close=value, volume=100))


def _seed():
    _insert("A", A)
    _insert("B", B)
    _insert("M", M)


def test_capm_requires_database(client):
    assert client.post("/portfolio/capm", json={"tickers": ["A", "B"], "weights": [1, 1]}).status_code == 503


def test_manual_rf_and_lowercase_inputs(client, db_mode):
    _seed()
    response = client.post("/portfolio/capm", json={"tickers": ["a", "b"], "weights": [1, 1], "lookback_days": 365, "rf": 0.04, "mrp": 0.05, "market_ticker": "m", "configs": {"a": {"view": -0.2}}})
    assert response.status_code == 200
    body = response.json()
    assert body["rf_source"] == "manual"
    assert body["rf"] == 0.04
    assert body["target_weights"]["A"] == pytest.approx(0.657895, abs=1e-4)
    assert body["market_ticker"] == "M"
    assert body["holdings"][0]["ticker"] == "A"
    assert set(body["var_95"]) == {"daily", "weekly", "monthly", "quarterly", "annual"}
    assert set(body["current_metrics"]) == {"expected_return", "expected_vol", "expected_sharpe", "portfolio_beta"}


def test_live_rf_when_rf_omitted(client, db_mode, monkeypatch):
    _seed()
    calls = []
    def rate():
        calls.append(None)
        return 0.04, "live"
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate_with_source", rate)
    live = client.post("/portfolio/capm", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365, "market_ticker": "M"})
    manual = client.post("/portfolio/capm", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365, "market_ticker": "M", "rf": 0.04})
    assert live.json()["rf_source"] == "live"
    assert live.json()["target_weights"]["A"] == pytest.approx(0.75, abs=1e-4)
    assert manual.status_code == 200
    assert len(calls) == 1


def test_missing_market_ticker_is_422(client, db_mode):
    _seed()
    response = client.post("/portfolio/capm", json={"tickers": ["A", "B"], "weights": [1, 1], "market_ticker": "VT", "rf": 0.04})
    assert response.status_code == 422
    assert response.json()["detail"] == "No stored price history for market ticker VT. Add it to the Universe first."


def test_missing_holding_is_404(client, db_mode):
    _seed()
    response = client.post("/portfolio/capm", json={"tickers": ["A", "Z"], "weights": [1, 1], "rf": 0.04})
    assert response.status_code == 404
    assert response.json()["detail"] == "No stored price history for Z"


def test_input_error_is_422(client, db_mode):
    _seed()
    response = client.post("/portfolio/capm", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 27, "market_ticker": "M", "rf": 0.04})
    assert response.status_code == 422
    assert response.json()["detail"] == "lookback_days must be between 28 and 3650"
