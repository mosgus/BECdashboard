import dataclasses
import re

import numpy as np
import pandas as pd
import pytest

from app.forecast_run import PROPHET_WARNING, ForecastFitError, ForecastInputError, ewma_variance, fit_ar1, fit_garch, run_forecast
from app.montecarlo_run import run_monte_carlo


DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


C = prices(np.full(260, 0.001))
A = prices(np.tile([0.01, -0.01], 130))
K = DATES.index(pd.Timestamp("2024-06-03").date())
Y = prices(np.tile([0.01, -0.01], 130)[K:], index=DATES[K:], start=50.0)


def from_log(x, start="2023-01-02"):
    index = [d.date() for d in pd.bdate_range(start, periods=len(x) + 1)]
    return prices(np.expm1(x), index=index)


_r = np.random.default_rng(1)
REGIME = from_log(np.concatenate([0.005 * _r.standard_normal(500), 0.025 * _r.standard_normal(40)]))


def run(weights, cash=0, closes=None, **kwargs):
    kwargs.setdefault("lookback_days", 365)
    return run_forecast(weights, cash, {"A": A} if closes is None else closes,
                        initial_value=1000, **kwargs)


@pytest.mark.parametrize("model", ["ewma", "garch", "arima", "ensemble", "prophet"])
def test_constant_growth(model):
    result = run({"C": 1}, closes={"C": C}, model=model, horizon_days=63, num_simulations=100)
    assert result.terminal.median == pytest.approx(1064.99331, abs=1e-4)
    assert result.terminal.p5 == pytest.approx(1064.99331, abs=1e-4)
    assert result.terminal.p95 == pytest.approx(1064.99331, abs=1e-4)
    assert result.current_vol == 0
    assert all(point.vol == 0 for point in result.vol_forecast)


def test_ewma_variance_literal():
    assert ewma_variance(np.log1p(np.array([0.01, -0.02, 0.015, 0.0, -0.005, 0.03]))) == pytest.approx(0.00028392138592321, rel=1e-9)


def test_fit_recovery():
    rng = np.random.default_rng(7)
    alpha, beta, variance = 0.08, 0.90, 1e-4
    omega, s2, garch = (1 - alpha - beta) * variance, variance, []
    for _ in range(3000):
        error = np.sqrt(s2) * rng.standard_normal()
        garch.append(0.0003 + error)
        s2 = omega + alpha * error ** 2 + beta * s2
    fit = fit_garch(np.array(garch))
    assert fit.alpha == pytest.approx(alpha, abs=0.04)
    assert fit.beta == pytest.approx(beta, abs=0.05)
    rng = np.random.default_rng(3)
    ar = [0.0]
    for _ in range(1999):
        ar.append(0.0005 + 0.3 * ar[-1] + 0.01 * rng.standard_normal())
    assert fit_ar1(np.array(ar)).phi == pytest.approx(0.3, abs=0.05)


def test_regime_and_ensemble():
    options = dict(closes={"R": REGIME}, horizon_days=63, num_simulations=1000, lookback_days=800)
    ewma, garch, arima = (run({"R": 1}, model=model, **options) for model in ("ewma", "garch", "arima"))
    assert ewma.current_vol > 2 * arima.current_vol
    assert garch.current_vol > 2 * arima.current_vol
    assert all(left.vol >= right.vol - 1e-12 for left, right in zip(garch.vol_forecast, garch.vol_forecast[1:]))
    assert garch.vol_forecast[-1].vol < garch.current_vol
    assert garch.vol_forecast[-1].vol > garch.lookback_vol
    assert ewma.terminal.p95 - ewma.terminal.p5 > arima.terminal.p95 - arima.terminal.p5
    ensemble = run({"R": 1}, model="ensemble", **options)
    assert ensemble.members == ["ewma", "garch", "arima"]
    assert len(ensemble.member_medians) == 3
    assert abs(arima.lookback_vol - 0.144) < 0.005
    assert min(ensemble.member_medians.values()) - 5 <= ensemble.terminal.median <= max(ensemble.member_medians.values()) + 5


def test_prophet_on_regime():
    result = run({"R": 1}, closes={"R": REGIME}, model="prophet", lookback_days=800, horizon_days=63, num_simulations=500)
    assert result.current_vol is None
    assert result.vol_forecast == []
    assert result.members == ["prophet"]
    assert result.paths[0].p5 == result.paths[0].p25 == result.paths[0].p50 == result.paths[0].p75 == result.paths[0].p95 == 1000
    assert all(point.p5 <= point.p25 <= point.p50 <= point.p75 <= point.p95 for point in result.paths)
    assert result.paths[-1].day == 63
    assert "end_gap" in result.params
    assert PROPHET_WARNING in result.warnings
    assert result.num_simulations == 500


def test_prophet_caps_samples():
    result = run({"R": 1}, closes={"R": REGIME}, model="prophet", lookback_days=800, horizon_days=63, num_simulations=5000)
    assert result.num_simulations == 2000
    assert "Prophet draws at most 2,000 samples, so this forecast uses 2,000." in result.warnings


def test_prophet_is_deterministic():
    options = dict(closes={"R": REGIME}, model="prophet", lookback_days=800, horizon_days=63, num_simulations=500)
    assert run({"R": 1}, **options).terminal == run({"R": 1}, **options).terminal


def test_prophet_not_installed(monkeypatch):
    def missing():
        raise ForecastInputError("Prophet is not installed on this server.")
    monkeypatch.setattr("app.forecast_run._load_prophet", missing)
    with pytest.raises(ForecastInputError, match="Prophet is not installed on this server."):
        run({"R": 1}, closes={"R": REGIME}, model="prophet", lookback_days=800, num_simulations=100)
    assert run({"R": 1}, closes={"R": REGIME}, model="ewma", lookback_days=800, num_simulations=100).model == "ewma"


def test_prophet_minimum_returns():
    short = from_log(0.01 * np.random.default_rng(2).standard_normal(100))
    with pytest.raises(ForecastInputError, match=re.escape("Prophet needs at least 250 daily returns, but the holdings share only 100. Choose a longer lookback.")):
        run({"S": 1}, closes={"S": short}, model="prophet")


def test_ensemble_drops_failed_member(monkeypatch):
    def fail(_):
        raise ForecastFitError("GARCH could not be fitted")
    monkeypatch.setattr("app.forecast_run.fit_garch", fail)
    result = run({"R": 1}, closes={"R": REGIME}, model="ensemble", lookback_days=800, num_simulations=100)
    assert result.members == ["ewma", "arima"]
    assert "GARCH could not be fitted, so the ensemble uses EWMA and ARIMA only." in result.warnings
    with pytest.raises(ForecastInputError, match="GARCH could not be fitted to this lookback."):
        run({"R": 1}, closes={"R": REGIME}, model="garch", lookback_days=800, num_simulations=100)


def test_minimum_determinism_warning_validation_and_history():
    short = from_log(0.01 * np.random.default_rng(2).standard_normal(100))
    with pytest.raises(ForecastInputError, match=re.escape("GARCH needs at least 250 daily returns, but the holdings share only 100. Choose a longer lookback.")):
        run({"S": 1}, closes={"S": short}, model="garch")
    assert run({"S": 1}, closes={"S": short}, model="ewma").model == "ewma"
    options = dict(closes={"R": REGIME}, model="garch", lookback_days=800, num_simulations=100)
    assert dataclasses.asdict(run({"R": 1}, **options)) == dataclasses.asdict(run({"R": 1}, **options))
    assert run({"A": 1, "Y": 1}, closes={"A": A, "Y": Y}, model="ewma").warnings == run_monte_carlo({"A": 1, "Y": 1}, 0, {"A": A, "Y": Y}, initial_value=1000, model="normal").warnings
    result = run({"C": 1}, closes={"C": C}, model="ewma")
    assert result.history[-1].value == pytest.approx(1000)
    assert result.history[-1].date == C.index[-1]
    assert all(a.date < b.date for a, b in zip(result.history, result.history[1:]))
    assert result.history[-1].day == 0 and result.history[0].day == -259
    assert result.vol_history[-1].day == 0 and result.vol_history[0].day == -239
    assert len(result.history) <= 251
    with pytest.raises(ForecastInputError, match=re.escape('model must be one of "ewma", "garch", "arima", "ensemble" or "prophet"')):
        run({"C": 1}, closes={"C": C}, model="nope")
    with pytest.raises(ForecastInputError, match="num_simulations must be between 100 and 10000"):
        run({"C": 1}, closes={"C": C}, model="ewma", num_simulations=99)
