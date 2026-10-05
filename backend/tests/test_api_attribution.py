import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, FF3Factor, PriceBar

DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=301)]
T = np.arange(1, 301)
MKT = 0.01 * np.sin(0.7 * T)
SMB = 0.006 * np.cos(1.3 * T)
HML = 0.004 * np.sin(0.4 * T + 1)
RF = np.full(300, 0.0002)
NOISE = 0.003 * np.sin(2.9 * T)
EXACT = RF + 0.0001 + 0.9 * MKT + 0.3 * SMB - 0.2 * HML
NOISY = EXACT + NOISE


def prices(returns): return pd.Series(100 * np.concatenate([[1.0], np.cumprod(1 + returns)]), index=DATES)


FACTORS = pd.DataFrame({"mkt_rf": MKT, "smb": SMB, "hml": HML, "rf": RF}, index=DATES[1:])


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/attribution.db")
    Base.metadata.create_all(get_engine())


@pytest.fixture
def client():
    return TestClient(app)


def seed(with_factors=True):
    with session() as db:
        for ticker, series in (("A", prices(NOISY)), ("M", prices(MKT + RF))):
            for day, value in series.items():
                v = float(value)
                db.add(PriceBar(ticker=ticker, date=day, open=v, high=v, low=v, close=v, adj_close=v, volume=1))
        if with_factors:
            for day, row in FACTORS.iterrows():
                db.add(FF3Factor(date=day, mkt_rf=float(row.mkt_rf), smb=float(row.smb), hml=float(row.hml), rf=float(row.rf)))


def body(**more):
    return {"tickers": ["A"], "weights": [1], "cash": 0, "start": DATES[0].isoformat(), "end": DATES[-1].isoformat(), "market_ticker": "M", **more}


def test_success(client, db_mode):
    seed()
    response = client.post("/portfolio/attribution", json=body())
    assert response.status_code == 200
    data = response.json()
    assert data["n_obs"] == 300 and len(data["loadings"]) == 3
    assert set(data["contributions"]) == {"alpha", "market", "size", "value", "risk_free", "compounding"}
    assert sum(data["contributions"].values()) == pytest.approx(data["period_return"], abs=1e-9)
    assert data["source"].startswith("Kenneth R. French")
    assert data["market_ticker"] == "M"


def test_no_factor_rows_returns_503(client, db_mode):
    seed(with_factors=False)
    response = client.post("/portfolio/attribution", json=body())
    assert response.status_code == 503
    assert response.json()["detail"].startswith("Fama-French factor data hasn't been downloaded yet")


def test_too_short_window_returns_422(client, db_mode):
    seed()
    assert client.post("/portfolio/attribution", json=body(start=DATES[250].isoformat())).status_code == 422


def test_unknown_market_returns_422(client, db_mode):
    seed()
    assert client.post("/portfolio/attribution", json=body(market_ticker="ZZZ")).status_code == 422


def test_no_database_returns_503(client):
    assert client.post("/portfolio/attribution", json=body()).status_code == 503
