import numpy as np
import pandas as pd
import pytest

from app.calibration_run import CALIBRATION_MODELS, CalibrationInputError, run_calibration
from app.montecarlo_run import portfolio_series, run_monte_carlo


rng = np.random.default_rng(7)
IID = 0.0003 + 0.01 * rng.standard_normal(2000)
SWITCH = np.concatenate([0.005 * rng.standard_normal(1500), 0.02 * rng.standard_normal(500)])


def closes_from(returns):
    dates = pd.bdate_range("2016-01-04", periods=len(returns) + 1).date
    return {"A": pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=dates)}


def run(closes, *, lookback_days=730, model="normal"):
    return run_calibration({"A": 1.0}, 0, closes, lookback_days=lookback_days, model=model)


def test_iid_normal_is_consistent():
    result = run(closes_from(IID))
    horizon = result.horizons[0]
    assert horizon.windows == 60
    assert horizon.below_90 == 5
    assert horizon.above_90 == 5
    assert horizon.inside_90 == pytest.approx(50 / 60)
    assert horizon.range_90 == pytest.approx((49 / 60, 58 / 60))
    assert horizon.verdict_90 == "consistent"
    assert horizon.verdict_50 == "consistent"
    assert [item.horizon_days for item in result.horizons] == [21, 63]


def test_regime_flags_normal_too_narrow():
    horizon = run(closes_from(SWITCH)).horizons[0]
    assert horizon.windows == 60
    assert horizon.below_90 == 8
    assert horizon.above_90 == 7
    assert horizon.verdict_90 == "too_narrow"


def test_regime_ewma_adapts():
    horizon = run(closes_from(SWITCH), model="ewma").horizons[0]
    assert horizon.below_90 == 7
    assert horizon.above_90 == 3
    assert horizon.verdict_90 == "consistent"


def test_too_few_windows():
    result = run(closes_from(IID[:400]), lookback_days=365)
    assert result.horizons[1].windows == 5
    assert result.horizons[1].verdict_90 == "too_few"
    assert result.horizons[0].windows == 16
    assert result.horizons[0].verdict_90 != "too_few"


def test_no_lookahead(monkeypatch):
    closes = closes_from(IID)
    seen = []

    def wrapped(*args, **kwargs):
        seen.append(max(series.index[-1] for series in args[2].values()))
        return run_monte_carlo(*args, **kwargs)

    monkeypatch.setattr("app.calibration_run.run_monte_carlo", wrapped)
    run(closes)
    full = portfolio_series({"A": 1.0}, 0, closes, lookback_days=3650).returns
    assert seen[:60] == [full.index[len(full) - 1 - 21 * (step + 1)] for step in range(60)]
    assert all(value <= full.index[-22] for value in seen[:60])


def test_rejects_prophet_and_unknown():
    closes = closes_from(IID)
    with pytest.raises(CalibrationInputError, match="^Calibration does not cover Prophet, which is untested by design\\.$"):
        run(closes, model="prophet")
    with pytest.raises(CalibrationInputError, match='^model must be one of "bootstrap", "normal", "ewma", "garch", "arima" or "ensemble"$'):
        run(closes, model="unknown")


@pytest.mark.parametrize("model", CALIBRATION_MODELS)
def test_every_model_runs(model):
    result = run(closes_from(IID), model=model)
    assert all(horizon.windows > 0 for horizon in result.horizons)
    for horizon in result.horizons:
        for share in (horizon.inside_90, horizon.inside_50):
            if share is not None:
                assert 0 <= share <= 1
