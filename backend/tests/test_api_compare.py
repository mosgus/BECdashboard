import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar

DATES = [d.date() for d in pd.bdate_range("2023-01-02", "2024-12-31")]


def _prices(pattern):
    returns = np.resize(np.asarray(pattern, dtype=float), len(DATES) - 1)
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=DATES)


A = _prices([0.01, -0.01, 0.01, -0.01])
B = _prices([0.02, 0.02, -0.02, -0.02])
C = _prices([0.005, 0.003, -0.004, 0.001, -0.002])


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_compare.db")
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate_with_source", lambda: (0.0427, "fallback"))
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


def _seed():
    for ticker, series in (("A", A), ("B", B), ("C", C), ("SPY", A)):
        _insert(ticker, series)


def test_compare_response_shape(client, db_mode):
    _seed()
    response = client.post(
        "/portfolio/compare", json={"tickers": ["A", "B", "C"], "weights": [1, 1, 1], "lookback_days": 365}
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["modes"]) == 8
    assert body["holdout"] is not None
    assert body["correlation"] is not None
    assert body["frontier"] is not None
    assert len(body["folds"]) == 4
    keys = {"fold", "cut", "score_end", "fit_start", "fit_end", "score_start", "tickers", "excluded",
            "vol_target", "unavailable", "current", "modes"}
    for fold in body["folds"]:
        assert keys == fold.keys()
    assert "vol_target" in body
    assert {"vol", "ret"} == body["current"]["point"].keys()
    assert {"vol", "ret"} == body["frontier"]["points"][0].keys()
    for mode in body["modes"]:
        assert {"vol", "ret"} == mode["point"].keys()


def test_compare_accepts_lowercase_tickers(client, db_mode):
    _seed()
    response = client.post(
        "/portfolio/compare", json={"tickers": ["a", "b", "c"], "weights": [1, 1, 1], "lookback_days": 365}
    )
    assert response.status_code == 200
    assert response.json()["tickers"] == ["A", "B", "C"]


def test_compare_single_ticker_is_422(client, db_mode):
    _seed()
    response = client.post("/portfolio/compare", json={"tickers": ["A"], "weights": [1], "lookback_days": 365})
    assert response.status_code == 422


def test_compare_unknown_ticker_is_404(client, db_mode):
    _seed()
    response = client.post("/portfolio/compare", json={"tickers": ["A", "MISS"], "weights": [1, 1]})
    assert response.status_code == 404


def test_compare_without_vol_target_is_200(client, db_mode):
    _seed()
    response = client.post(
        "/portfolio/compare", json={"tickers": ["A", "B", "C"], "weights": [1, 1, 1], "lookback_days": 365}
    )
    assert response.status_code == 200
    assert isinstance(response.json()["vol_target"], float)


@pytest.mark.parametrize("folds", [0, 7])
def test_compare_folds_out_of_range_is_422(client, db_mode, folds):
    _seed()
    response = client.post(
        "/portfolio/compare",
        json={"tickers": ["A", "B", "C"], "weights": [1, 1, 1], "lookback_days": 365, "folds": folds},
    )
    assert response.status_code == 422
