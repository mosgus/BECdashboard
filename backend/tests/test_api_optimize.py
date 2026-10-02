from datetime import date

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


DATES = [d.date() for d in pd.bdate_range("2024-01-02", "2024-12-31")]
A_RETURNS = np.tile([0.01, -0.01, 0.01, -0.01], 65)
B_RETURNS = np.tile([0.02, 0.02, -0.02, -0.02], 65)


def _prices(returns):
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=DATES)


A, B = _prices(A_RETURNS), _prices(B_RETURNS)
Y = pd.Series(50.0, index=[day for day in DATES if day >= date(2024, 6, 3)])
SPY = A.copy()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_optimize.db")
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _insert(ticker, prices):
    with session() as db:
        for bar_date, value in prices.items():
            db.add(PriceBar(
                ticker=ticker, date=bar_date, open=value, high=value, low=value,
                close=value, adj_close=value, volume=100,
            ))


def _seed(include_y=True, include_spy=True, constant_spy=False):
    _insert("A", A)
    _insert("B", B)
    if include_y:
        _insert("Y", Y)
    if include_spy:
        _insert("SPY", pd.Series(100.0, index=DATES) if constant_spy else SPY)


def test_optimize_accepts_lowercase_tickers(client, db_mode):
    _seed()
    response = client.post("/portfolio/optimize", json={"tickers": ["a", "b"], "weights": [1, 1], "lookback_days": 365})
    assert response.status_code == 200
    body = response.json()
    assert body["target_weights"] == pytest.approx({"A": 0.8, "B": 0.2}, abs=0.01)
    assert body["pinned"] == []
    assert body["curves"]["benchmark"][0] == pytest.approx(100)
    assert body["fit_start"] == "2024-01-03"
    assert {"points", "current", "optimized", "min_variance", "max_sharpe", "tickers", "excluded"} <= body["frontier"].keys()
    assert {"vol", "ret"} <= body["frontier"]["points"][0].keys()
    assert isinstance(body["frontier"]["cloud"], list)


def test_optimize_pins_young_holding(client, db_mode):
    _seed()
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "lookback_days": 365})
    body = response.json()
    assert response.status_code == 200
    assert body["target_weights"] == pytest.approx({"A": 0.4, "B": 0.1, "Y": 0.5}, abs=0.01)
    assert body["pinned"] == [{"ticker": "Y", "first_bar": "2024-06-03", "weight": pytest.approx(0.5), "exceeds_max": False}]
    assert body["score_limited_by"] == "Y"


def test_rate_and_short_cap_round_trip(client, db_mode, monkeypatch):
    _seed()
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate_with_source", lambda: (0.04, "live"))
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365, "allow_short": True, "max_short": .1})
    assert response.status_code == 200
    body = response.json()
    assert body["rf"] == .04
    assert body["rf_source"] == "live"
    assert sum(max(-weight, 0) for weight in body["target_weights"].values()) <= .1 + 1e-6


def test_rate_fallback_is_reported(client, db_mode, monkeypatch):
    _seed()
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate_with_source", lambda: (0.0427, "fallback"))
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365})
    assert response.status_code == 200
    assert response.json()["rf_source"] == "fallback"


def test_missing_spy_is_optional(client, db_mode):
    _seed(include_y=False, include_spy=False)
    ordinary = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365})
    assert ordinary.status_code == 200
    assert ordinary.json()["curves"]["benchmark"] is None
    assert any("SPY is not stored" in warning for warning in ordinary.json()["warnings"])
    assert "beta" not in ordinary.json()["metrics"]["current"]


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"tickers": ["MISS"], "weights": [1]}, 404),
        ({"tickers": ["A", "a"], "weights": [1, 1]}, 400),
        ({"tickers": ["A", "B"], "weights": [1]}, 400),
        ({"tickers": ["A", "B"], "weights": [0, 1]}, 400),
        ({"tickers": ["A", "B"], "weights": [1, 1], "mode": "nope"}, 422),
        ({"tickers": ["A", "B"], "weights": [1, 1], "mode": "max_sharpe_capm"}, 422),
        ({"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 27}, 422),
        ({"tickers": ["A", "B"], "weights": [1, 1], "rebalance": "weekly"}, 422),
        ({"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "lookback_days": 365, "max_weight": 0.2}, 422),
        ({"tickers": ["A", "Y"], "weights": [1, 1], "lookback_days": 365}, 422),
    ],
)
def test_optimize_errors(client, db_mode, payload, status):
    _seed()
    assert client.post("/portfolio/optimize", json=payload).status_code == status


def test_optimize_returns_json_safe_nan_metrics(client, db_mode):
    _seed(constant_spy=True)
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365})
    assert response.status_code == 200
    assert response.json()["metrics"]["current"]["beta"] is None


def test_optimize_requires_database(client):
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1]})
    assert response.status_code == 503
