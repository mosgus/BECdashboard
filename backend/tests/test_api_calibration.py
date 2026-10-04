import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar


rng = np.random.default_rng(7)
IID = 0.0003 + 0.01 * rng.standard_normal(2000)


def closes_from(returns):
    dates = pd.bdate_range("2016-01-04", periods=len(returns) + 1).date
    return {"A": pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=dates)}


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_calibration.db")
    Base.metadata.create_all(get_engine())


@pytest.fixture
def client():
    return TestClient(app)


def _insert():
    with session() as db:
        for bar_date, value in closes_from(IID[:400])["A"].items():
            db.add(PriceBar(ticker="A", date=bar_date, open=value, high=value, low=value, close=value, adj_close=value, volume=100))


def test_calibration_api(client, db_mode):
    _insert()
    body = {"tickers": ["A"], "weights": [1], "lookback_days": 365, "model": "normal"}
    response = client.post("/portfolio/calibration", json=body)
    assert response.status_code == 200
    assert len(response.json()["horizons"]) == 2
    response = client.post("/portfolio/calibration", json={**body, "model": "prophet"})
    assert response.status_code == 422
    assert response.json()["detail"] == "Calibration does not cover Prophet, which is untested by design."
