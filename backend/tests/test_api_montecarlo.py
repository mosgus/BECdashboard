import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


C = prices(np.full(260, 0.001))
A = prices(np.tile([0.01, -0.01], 130))


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_montecarlo.db")
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
    _insert("C", C)


def test_montecarlo_requires_database(client):
    response = client.post("/portfolio/montecarlo", json={"tickers": ["A"], "weights": [1], "initial_value": 1000})
    assert response.status_code == 503


def test_lowercase_tickers_and_cash(client, db_mode):
    _seed()
    response = client.post("/portfolio/montecarlo", json={
        "tickers": ["c"], "weights": [1], "cash": 1, "initial_value": 1000,
        "horizon_days": 63, "num_simulations": 100, "lookback_days": 365,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["tickers"] == ["C"]
    assert body["weights"] == {"C": 0.5}
    assert body["cash_weight"] == 0.5
    assert body["model"] == "bootstrap"
    assert body["seed"] == 42
    assert len(body["paths"]) == 64
    assert body["paths"][-1]["day"] == 63
    assert body["terminal"]["median"] == pytest.approx(1031.99325, abs=1e-4)
    assert body["warnings"] == []


def test_defaults(client, db_mode):
    _seed()
    response = client.post("/portfolio/montecarlo", json={"tickers": ["A"], "weights": [1], "initial_value": 1000})
    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "bootstrap"
    assert body["horizon_days"] == 252
    assert body["num_simulations"] == 1000
    assert body["lookback_days"] == 1825
    assert body["warnings"] == [
        "The simulation uses returns from 2024-01-03 onward: A has prices only from 2024-01-02."
    ]


def test_fixed_seed_is_reproducible(client, db_mode):
    _seed()
    body = {"tickers": ["A"], "weights": [1], "initial_value": 1000, "model": "normal"}
    first = client.post("/portfolio/montecarlo", json=body)
    second = client.post("/portfolio/montecarlo", json=body)
    assert first.json() == second.json()


def test_missing_holding_is_404(client, db_mode):
    _seed()
    response = client.post("/portfolio/montecarlo", json={"tickers": ["A", "Z"], "weights": [1, 1], "initial_value": 1000})
    assert response.status_code == 404
    assert response.json()["detail"] == "No stored price history for Z"


def test_input_error_is_422(client, db_mode):
    _seed()
    response = client.post("/portfolio/montecarlo", json={"tickers": ["A"], "weights": [1], "initial_value": 1000, "horizon_days": 0})
    assert response.status_code == 422
    assert response.json()["detail"] == "horizon_days must be between 1 and 756"
