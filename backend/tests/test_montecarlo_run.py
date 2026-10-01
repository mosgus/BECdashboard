import dataclasses
import re
from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.montecarlo_run import MonteCarloInputError, run_monte_carlo


DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


C = prices(np.full(260, 0.001))
A = prices(np.tile([0.01, -0.01], 130))
K = DATES.index(date(2024, 6, 3))
Y = prices(np.tile([0.01, -0.01], 130)[K:], index=DATES[K:], start=50.0)
S = prices(np.full(39, 0.001), index=DATES[-40:])


def run(weights, cash=0, closes=None, **kwargs):
    options = {"initial_value": 1000.0, "lookback_days": 365, **kwargs}
    return run_monte_carlo(
        weights, cash, {"A": A} if closes is None else closes, **options
    )


@pytest.mark.parametrize("model", ["bootstrap", "normal"])
def test_constant_growth_is_deterministic(model):
    result = run({"C": 1}, closes={"C": C}, model=model, horizon_days=63, num_simulations=100)
    assert result.terminal.median == pytest.approx(1064.99331, abs=1e-4)
    assert result.terminal.p5 == pytest.approx(1064.99331, abs=1e-4)
    assert result.terminal.p95 == pytest.approx(1064.99331, abs=1e-4)
    assert result.terminal.prob_loss == 0.0
    assert result.daily_mean == pytest.approx(0.001, abs=1e-12)
    assert result.daily_vol == pytest.approx(0, abs=1e-12)
    assert result.fit_start == date(2024, 1, 3)
    assert result.fit_end == date(2024, 12, 31)
    assert result.n_returns == 260
    assert result.warnings == []


def test_cash_earns_nothing():
    result = run({"C": 1}, cash=1, closes={"C": C}, horizon_days=63, num_simulations=100)
    assert result.weights == {"C": 0.5}
    assert result.cash_weight == 0.5
    assert result.daily_mean == pytest.approx(0.0005, abs=1e-12)
    assert result.terminal.median == pytest.approx(1031.99325, abs=1e-4)


def test_bootstrap_draws_only_observed_returns():
    result = run({"A": 1}, model="bootstrap", horizon_days=2, num_simulations=10000)
    assert result.terminal.p5 == pytest.approx(980.1, abs=1e-6)
    assert result.terminal.median == pytest.approx(999.9, abs=1e-6)
    assert result.terminal.p95 == pytest.approx(1020.1, abs=1e-6)
    assert result.terminal.prob_loss == pytest.approx(0.75, abs=0.02)
    assert result.terminal.mean == pytest.approx(1000, abs=1.0)


def test_normal_matches_its_moments():
    result = run({"A": 1}, model="normal", horizon_days=252, num_simulations=10000)
    assert result.daily_mean == pytest.approx(0, abs=1e-12)
    assert result.daily_vol == pytest.approx(0.0100193, abs=1e-6)
    assert result.terminal.mean_return == pytest.approx(0, abs=0.01)
    assert result.terminal.median_return == pytest.approx(-0.0125, abs=0.01)
    assert result.terminal.prob_loss == pytest.approx(0.53, abs=0.03)
    assert result.terminal.p5 == pytest.approx(761, abs=15)


def test_same_seed_same_result():
    first = run({"A": 1}, model="normal", horizon_days=63, num_simulations=1000)
    second = run({"A": 1}, model="normal", horizon_days=63, num_simulations=1000)
    other = run({"A": 1}, model="normal", horizon_days=63, num_simulations=1000, seed=7)
    assert dataclasses.asdict(first) == dataclasses.asdict(second)
    assert other.terminal.mean != first.terminal.mean


@pytest.mark.parametrize("horizon_days", [63, 125, 252])
def test_path_grid(horizon_days):
    result = run({"A": 1}, horizon_days=horizon_days, num_simulations=100)
    assert len(result.paths) == 64
    assert result.paths[0].day == 0
    assert result.paths[-1].day == horizon_days
    assert all(left.day < right.day for left, right in zip(result.paths, result.paths[1:]))


def test_bands_are_ordered_and_start_at_initial_value():
    result = run({"A": 1}, model="normal", horizon_days=252, num_simulations=1000)
    assert (result.paths[0].p5, result.paths[0].p25, result.paths[0].p50, result.paths[0].p75, result.paths[0].p95) == (1000.0,) * 5
    for point in result.paths:
        assert point.p5 <= point.p25 <= point.p50 <= point.p75 <= point.p95


def test_young_holding_limits_the_window():
    result = run({"A": 1, "Y": 1}, closes={"A": A, "Y": Y}, num_simulations=100)
    assert result.fit_start == date(2024, 6, 4)
    assert result.n_returns == 151
    assert result.warnings == [
        "The simulation uses returns from 2024-06-04 onward: Y has prices only from 2024-06-03."
    ]


def test_lookback_longer_than_history_warns():
    result = run({"A": 1}, closes={"A": A}, lookback_days=1825, num_simulations=100)
    assert result.warnings == [
        "The simulation uses returns from 2024-01-03 onward: A has prices only from 2024-01-02."
    ]
    assert result.n_returns == 260


def test_too_few_returns_is_an_error():
    with pytest.raises(MonteCarloInputError, match=re.escape(
        "Need at least 60 daily returns to simulate, but the holdings share only 39."
    )):
        run({"S": 1}, closes={"S": S})


@pytest.mark.parametrize(
    ("weights", "closes", "cash", "kwargs", "message"),
    [
        ({"A": 1}, {"A": A}, 0, {"lookback_days": 27}, "lookback_days must be between 28 and 3650"),
        ({"A": 1}, {"A": A}, 0, {"model": "garch"}, 'model must be "bootstrap" or "normal"'),
        ({"A": 1}, {"A": A}, 0, {"horizon_days": 0}, "horizon_days must be between 1 and 756"),
        ({"A": 1}, {"A": A}, 0, {"horizon_days": 757}, "horizon_days must be between 1 and 756"),
        ({"A": 1}, {"A": A}, 0, {"num_simulations": 99}, "num_simulations must be between 100 and 10000"),
        ({"A": 1}, {"A": A}, 0, {"num_simulations": 10001}, "num_simulations must be between 100 and 10000"),
        ({"A": 1}, {"A": A}, 0, {"initial_value": 0.0}, "initial_value must be finite and greater than zero"),
        ({"A": 1}, {"A": A}, 0, {"initial_value": float("nan")}, "initial_value must be finite and greater than zero"),
        ({"A": 0}, {"A": A}, 0, {}, "weights must be finite and greater than zero"),
        ({"A": 1}, {"A": A}, -1, {}, "cash must be finite and zero or more"),
        ({"A": 1}, {}, 0, {}, "missing closes for weighted ticker 'A'"),
    ],
)
def test_input_errors(weights, closes, cash, kwargs, message):
    with pytest.raises(MonteCarloInputError, match=re.escape(message)):
        run(weights, cash=cash, closes=closes, **kwargs)
