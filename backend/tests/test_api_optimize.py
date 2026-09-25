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


def test_optimize_pins_young_holding(client, db_mode):
    _seed()
    response = client.post("/portfolio/optimize", json={"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "lookback_days": 365})
    body = response.json()
    assert response.status_code == 200
    assert body["target_weights"] == pytest.approx({"A": 0.4, "B": 0.1, "Y": 0.5}, abs=0.01)
    assert body["pinned"] == [{"ticker": "Y", "first_bar": "2024-06-03", "weight": pytest.approx(0.5), "exceeds_max": False}]
    assert body["score_limited_by"] == "Y"


def test_capm_fetches_rate_and_non_capm_does_not(client, db_mode, monkeypatch):
    _seed()
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate", lambda: 0.04)
    capm = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "mode": "max_sharpe_capm", "lookback_days": 365})
    assert capm.status_code == 200
    assert capm.json()["capm_expected_returns"] == pytest.approx({"A": 0.09, "B": 0.04}, abs=0.01)
    assert capm.json()["target_weights"]["A"] == pytest.approx(1.0, abs=0.01)
    assert capm.json()["metrics"]["forward_looking"] is not None
    monkeypatch.setattr("app.routers.portfolio.fetch_risk_free_rate", lambda: (_ for _ in ()).throw(AssertionError("called")))
    assert client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365}).status_code == 200


def test_missing_spy_is_optional_except_for_capm(client, db_mode):
    _seed(include_y=False, include_spy=False)
    ordinary = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 365})
    assert ordinary.status_code == 200
    assert ordinary.json()["curves"]["benchmark"] is None
    assert any("SPY is not stored" in warning for warning in ordinary.json()["warnings"])
    assert "beta" not in ordinary.json()["metrics"]["current"]
    capm = client.post("/portfolio/optimize", json={"tickers": ["A", "B"], "weights": [1, 1], "mode": "max_sharpe_capm", "lookback_days": 365})
    assert capm.status_code == 422
    assert "SPY" in capm.json()["detail"]


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"tickers": ["MISS"], "weights": [1]}, 404),
        ({"tickers": ["A", "a"], "weights": [1, 1]}, 400),
        ({"tickers": ["A", "B"], "weights": [1]}, 400),
        ({"tickers": ["A", "B"], "weights": [0, 1]}, 400),
        ({"tickers": ["A", "B"], "weights": [1, 1], "mode": "nope"}, 422),
        ({"tickers": ["A", "B"], "weights": [1, 1], "lookback_days": 400}, 422),
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


def test_tilt_equal_and_current_need_no_database(client):
    equal = client.post("/portfolio/tilt", json={"tickers": ["A", "B"], "weights": [1, 1], "baseline": "equal", "conviction": {"a": 20}})
    current = client.post("/portfolio/tilt", json={"tickers": ["A", "B"], "weights": [60, 40], "baseline": "current", "conviction": {"B": -10}, "lam": 2})
    assert equal.status_code == 200
    assert equal.json()["tilt_weights"] == pytest.approx({"A": 0.6817, "B": 0.3183}, abs=0.0001)
    assert equal.json()["params"]["conviction"] == {"A": 20}
    assert current.status_code == 200
    assert current.json()["base_weights"] == pytest.approx({"A": 0.6, "B": 0.4})
    assert current.json()["tilt_weights"] == pytest.approx({"A": 0.7908, "B": 0.2092}, abs=0.0001)


def test_tilt_optimizer_uses_pinned_run_optimize(client, db_mode):
    _seed()
    response = client.post("/portfolio/tilt", json={"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "baseline": "optimizer", "lookback_days": 365})
    assert response.status_code == 200
    assert response.json()["base_weights"] == pytest.approx({"A": 0.4, "B": 0.1, "Y": 0.5}, abs=0.01)
    assert response.json()["tilt_weights"] == pytest.approx(response.json()["base_weights"])


def test_tilt_optimizer_default_lookback_requires_two_full_history_holdings(client, db_mode):
    _seed()
    response = client.post("/portfolio/tilt", json={"tickers": ["A", "B", "Y"], "weights": [1, 1, 2], "baseline": "optimizer"})
    assert response.status_code == 422
    assert "at least 2 holdings with full history" in response.json()["detail"]


def test_tilt_rejects_unknown_baselines_and_optimizer_modes(client):
    assert client.post("/portfolio/tilt", json={"tickers": ["A", "B"], "weights": [1, 1], "baseline": "nope"}).status_code == 422
    assert client.post("/portfolio/tilt", json={"tickers": ["A", "B"], "weights": [1, 1], "baseline": "optimizer", "optimizer_mode": "max_sortino"}).status_code == 422
