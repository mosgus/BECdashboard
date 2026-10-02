import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]
C = pd.Series(100 * np.concatenate([[1], np.cumprod(np.full(260, 1.001))]), index=DATES)


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_forecast.db")
    Base.metadata.create_all(get_engine())


@pytest.fixture
def client():
    return TestClient(app)


def _insert():
    with session() as db:
        for bar_date, value in C.items():
            db.add(PriceBar(ticker="C", date=bar_date, open=value, high=value, low=value, close=value, adj_close=value, volume=100))


def test_forecast_api(client, db_mode):
    _insert()
    body = {"tickers": ["C"], "weights": [1], "initial_value": 1000, "model": "ewma", "lookback_days": 365}
    response = client.post("/portfolio/forecast", json=body)
    assert response.status_code == 200
    assert {"paths", "terminal", "vol_forecast", "vol_history", "history", "params", "members", "member_medians"} <= response.json().keys()
    body.update({"model": "prophet", "lookback_days": 730})
    response = client.post("/portfolio/forecast", json=body)
    assert response.status_code == 200
    assert response.json()["current_vol"] == 0
    assert any(warning.startswith("Prophet is unstable and untested here.") for warning in response.json()["warnings"])
    body["model"] = "nope"
    response = client.post("/portfolio/forecast", json=body)
    assert response.status_code == 422
    assert response.json()["detail"] == 'model must be one of "ewma", "garch", "arima", "ensemble" or "prophet"'
