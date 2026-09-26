import numpy as np
import pandas as pd
import pytest

from app.optimizer import (
    compute_betas, compute_capm_expected_returns, compute_drawdown, compute_equity_curve,
    compute_metrics, compute_portfolio_returns, compute_returns,
    compute_rolling_vol, optimize_equal_weight, optimize_max_diversification,
    optimize_max_sharpe, optimize_max_sharpe_capm, optimize_max_sortino, optimize_min_cvar,
    optimize_min_variance, optimize_risk_parity, optimize_target_volatility,
)


a, b = 0.01, 0.02
A = np.tile([a, -a, a, -a], 25)
B = np.tile([b, b, -b, -b], 25)
UNCORR = pd.DataFrame({"A": A, "B": B})
DRIFT = pd.DataFrame({"A": A + 0.001, "B": B + 0.002})
rng = np.random.default_rng(7)
SEEDED = pd.DataFrame(rng.normal([0.0005, 0.0008, 0.0003], [0.01, 0.02, 0.015], size=(500, 3)), columns=["A", "B", "C"])


def assert_weights(actual, expected, tolerance=0.01):
    assert actual.keys() == expected.keys()
    for ticker, value in expected.items():
        assert actual[ticker] == pytest.approx(value, abs=tolerance)


def test_return_helpers():
    prices = pd.DataFrame({"A": [100, 110, 99]})
    assert compute_returns(prices)["A"].tolist() == pytest.approx([0.1, -0.1])
    assert compute_portfolio_returns(pd.DataFrame({"A": [.1], "B": [.2]}), np.array([.25, .75])).iloc[0] == pytest.approx(.175)
    assert compute_rolling_vol(pd.Series([.01] * 21)).iloc[-1] == pytest.approx(0)


def test_equity_and_drawdown_helpers():
    equity = compute_equity_curve(pd.Series([.1, -.5]))
    assert equity.tolist() == pytest.approx([1.1, .55])
    assert compute_drawdown(equity).tolist() == pytest.approx([0, -.5])


def test_equal_weight():
    assert_weights(optimize_equal_weight(pd.DataFrame(columns=["A", "B", "C"])), {"A": 1 / 3, "B": 1 / 3, "C": 1 / 3})


def test_min_variance_analytic_and_bound():
    assert_weights(optimize_min_variance(UNCORR), {"A": .8, "B": .2})
    assert_weights(optimize_min_variance(UNCORR, max_weight=.6), {"A": .6, "B": .4})


def test_risk_parity_inverse_volatility():
    assert_weights(optimize_risk_parity(UNCORR), {"A": 2 / 3, "B": 1 / 3})


def test_max_diversification_analytic():
    assert_weights(optimize_max_diversification(UNCORR), {"A": 2 / 3, "B": 1 / 3})


def test_max_sharpe_analytic():
    assert_weights(optimize_max_sharpe(DRIFT), {"A": 2 / 3, "B": 1 / 3})


def test_capm_sharpe_analytic():
    assert_weights(optimize_max_sharpe_capm(UNCORR, {"A": .08, "B": .12}, rf=.04), {"A": 2 / 3, "B": 1 / 3})


def test_target_volatility_analytic_and_infeasible():
    assert_weights(optimize_target_volatility(DRIFT, vol_target=.5), {"A": 0, "B": 1})
    with pytest.raises(RuntimeError, match="Target-vol optimizer did not converge"):
        optimize_target_volatility(DRIFT, vol_target=.01)


def test_min_cvar_analytic():
    assert_weights(optimize_min_cvar(pd.DataFrame({"A": A, "Z": np.zeros(100)})), {"A": 0, "Z": 1})


def test_capm_helpers():
    assert compute_capm_expected_returns({"A": 1.2}, rf=.04, mrp=.05, views={"A": .5}) == pytest.approx({"A": .125})
    assert compute_betas(pd.DataFrame({"M": A, "X": 2 * A}), "M") == pytest.approx({"X": 2.0})
    assert compute_betas(UNCORR, "missing") == {}


def test_metrics_zero_volatility_and_drawdown():
    metrics = compute_metrics(pd.Series([.001] * 252))
    assert metrics["cagr"] == pytest.approx(.2864, abs=.01)
    assert metrics["max_dd"] == pytest.approx(0)
    assert metrics["sharpe"] is None
    assert compute_metrics(pd.Series([.1, -.5, .2]))["max_dd"] == pytest.approx(-.5)


def test_metrics_with_benchmark():
    metrics = compute_metrics(pd.Series(2 * A), pd.Series(A))
    assert metrics["beta"] == pytest.approx(2, abs=.01)
    assert metrics["alpha"] == pytest.approx(-.0241, abs=.01)
    assert metrics["vol"] == pytest.approx(.3191, abs=.01)


@pytest.mark.parametrize(("optimizer", "expected"), [
    (optimize_max_sortino, {"A": 0, "B": 1, "C": 0}),
    (optimize_min_cvar, {"A": .5414, "B": .2107, "C": .2479}),
    (optimize_min_variance, {"A": .5874, "B": .1467, "C": .2659}),
    (optimize_max_sharpe, {"A": 0, "B": 1, "C": 0}),
    (optimize_max_diversification, {"A": .4593, "B": .2314, "C": .3093}),
])
def test_main_parity(optimizer, expected):
    assert_weights(optimizer(SEEDED), expected)


@pytest.mark.parametrize("name, optimizer, bounds", [
    ("equal", optimize_equal_weight, (0, 1)),
    ("min_variance", optimize_min_variance, (0, 1)),
    ("max_sharpe", optimize_max_sharpe, (0, 1)),
    ("capm", lambda r: optimize_max_sharpe_capm(r, {"A": .06, "B": .09, "C": .05}), (0, 1)),
    ("risk_parity", optimize_risk_parity, (1e-6, 1)),
    ("max_sortino", optimize_max_sortino, (0, 1)),
    ("min_cvar", optimize_min_cvar, (0, 1)),
    ("max_diversification", optimize_max_diversification, (0, 1)),
    ("target_volatility", lambda r: optimize_target_volatility(r, vol_target=.20), (0, 1)),
])
def test_all_optimizers_have_valid_weights(name, optimizer, bounds):
    weights = optimizer(SEEDED)
    assert set(weights) == set(SEEDED.columns)
    assert sum(weights.values()) == pytest.approx(1, abs=1e-6)
    for weight in weights.values():
        assert bounds[0] - 1e-6 <= weight <= bounds[1] + 1e-6


def test_risk_parity_contributions_are_equal():
    weights = optimize_risk_parity(SEEDED)
    w = np.array([weights[t] for t in SEEDED.columns])
    contributions = w * (SEEDED.cov().values * 252 @ w)
    assert np.max(np.abs(contributions - contributions.mean())) <= abs(contributions.mean()) * .01


def test_min_variance_shorting_bounds_and_sum():
    weights = optimize_min_variance(SEEDED, max_weight=1.0, min_weight=-1.0)
    # On this fixture the unconstrained optimum is still long-only; only bounds and sum are contractual.
    assert sum(weights.values()) == pytest.approx(1, abs=1e-6)
    assert all(-1 - 1e-6 <= weight <= 1 + 1e-6 for weight in weights.values())


def test_sortino_uses_all_days_and_downside_loss_size():
    returns = pd.DataFrame({"small_loss": [.02, -.01] * 100, "large_loss": [.03, -.02] * 100})
    rf = .0427
    weights = optimize_max_sortino(returns, rf=rf)
    port = returns.values @ np.array([1.0, 0.0])
    hand_sortino = (float(port.mean()) * 252 - rf) / (np.sqrt(np.mean(np.minimum(port - rf / 252, 0.0) ** 2)) * np.sqrt(252))
    assert hand_sortino == pytest.approx(10.67, abs=.01)
    assert weights["small_loss"] > .99


def test_short_cap_limits_total_short_exposure():
    rng = np.random.default_rng(12)
    common = rng.normal(0, .03, 1000)
    returns = pd.DataFrame({
        "A": common,
        "B": .9 * common + rng.normal(0, .005, 1000),
        "C": .9 * common + rng.normal(0, .005, 1000),
    })
    uncapped = optimize_min_variance(returns, min_weight=-1, max_weight=1)
    capped = optimize_min_variance(returns, min_weight=-1, max_weight=1, max_short=.20)
    assert sum(max(-weight, 0) for weight in uncapped.values()) > .20
    assert sum(max(-weight, 0) for weight in capped.values()) <= .20 + 1e-6
    assert sum(capped.values()) == pytest.approx(1, abs=1e-6)


def test_risk_parity_and_max_diversification_honor_min_weight():
    rng = np.random.default_rng(11)
    returns = pd.DataFrame(rng.normal(0, [.01, .02, .04], size=(500, 3)), columns=["A", "B", "C"])
    for optimizer in (optimize_risk_parity, optimize_max_diversification):
        unfloored = optimizer(returns)
        floored = optimizer(returns, min_weight=.3)
        assert min(unfloored.values()) < .3
        assert all(weight >= .3 - 1e-6 for weight in floored.values())
