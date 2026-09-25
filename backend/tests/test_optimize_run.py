from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.optimize_run import OptimizeInputError, PinnedHolding, run_optimize
from app.portfolio_series import backtest_series


DATES = [d.date() for d in pd.bdate_range("2024-01-02", "2024-12-31")]
A_RETURNS = np.tile([0.01, -0.01, 0.01, -0.01], 65)
B_RETURNS = np.tile([0.02, 0.02, -0.02, -0.02], 65)


def prices(returns):
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=DATES)


A = prices(A_RETURNS)
B = prices(B_RETURNS)
Y = pd.Series(50.0, index=[d for d in DATES if d >= date(2024, 6, 3)])
SPY = A.copy()
CLOSES = {"A": A, "B": B, "Y": Y}


def test_min_variance_without_pinning_has_analytic_result():
    result = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365)

    assert result.target_weights == pytest.approx({"A": 0.8, "B": 0.2}, abs=0.01)
    assert result.pinned == []
    assert result.score_limited_by is None
    assert result.fit_start == date(2024, 1, 3)
    assert result.fit_end == date(2024, 12, 31)
    assert result.feasible is True
    assert result.curves.current[0] == pytest.approx(100)
    assert result.curves.optimized[0] == pytest.approx(100)
    assert result.curves.benchmark and result.curves.benchmark[0] == pytest.approx(100)
    assert len(result.curves.dates) == 261


def test_pins_young_holding_without_shrinking_fit_window():
    result = run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365)

    assert result.current_weights == pytest.approx({"A": 0.25, "B": 0.25, "Y": 0.5})
    assert result.target_weights == pytest.approx({"A": 0.4, "B": 0.1, "Y": 0.5}, abs=0.01)
    assert result.pinned == [PinnedHolding("Y", date(2024, 6, 3), pytest.approx(0.5), False)]
    assert result.score_start == date(2024, 6, 3)
    assert result.score_limited_by == "Y"
    assert len(result.curves.dates) == 152
    assert result.fit_start == date(2024, 1, 3)


def test_scaled_bound_applies_to_final_weight_and_reports_pinned_excess():
    result = run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365, max_weight=0.3)

    assert result.target_weights == pytest.approx({"A": 0.3, "B": 0.2, "Y": 0.5}, abs=0.01)
    assert result.pinned[0].exceeds_max is True


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"max_weight": 0.2}, "after pinning"),
        ({"min_weight": 0.6}, "infeasible"),
    ],
)
def test_feasibility_guards(kwargs, message):
    weights, closes = ({"A": 1, "B": 1, "Y": 2}, CLOSES) if "max_weight" in kwargs else ({"A": 1, "B": 1}, {"A": A, "B": B})
    with pytest.raises(OptimizeInputError, match=message):
        run_optimize(weights, closes, SPY, lookback_days=365, **kwargs)


def test_max_bound_is_infeasible_when_below_equal_weight():
    with pytest.raises(OptimizeInputError, match="infeasible"):
        run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365, max_weight=0.4)


def test_requires_two_full_history_holdings():
    with pytest.raises(OptimizeInputError, match="at least 2 holdings with full history"):
        run_optimize({"A": 1, "Y": 1}, CLOSES, SPY, lookback_days=365)


def test_equal_weight_preserves_pinned_weight():
    result = run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, mode="equal_weight", lookback_days=365)
    assert result.target_weights == pytest.approx({"A": 0.25, "B": 0.25, "Y": 0.5})


def test_capm_returns_expected_returns_and_forward_looking_metrics():
    result = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, mode="max_sharpe_capm", lookback_days=365, rf=0.04)

    assert result.capm_expected_returns == pytest.approx({"A": 0.09, "B": 0.04}, abs=0.01)
    assert result.target_weights == pytest.approx({"A": 1.0, "B": 0.0}, abs=0.01)
    assert {"expected_return", "vol", "sharpe"} <= result.metrics["forward_looking"].keys()


def test_capm_requires_spy():
    with pytest.raises(OptimizeInputError, match="SPY"):
        run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, None, mode="max_sharpe_capm", lookback_days=365)


def test_views_are_only_applied_by_return_based_modes():
    sharpe = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, mode="max_sharpe", lookback_days=365, conviction_views={"A": 20}, kappa=0.05)
    variance = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, mode="min_variance", lookback_days=365, conviction_views={"A": 20})

    assert sharpe.views_applied is True
    assert sharpe.delta_mu == pytest.approx({"A": 0.01, "B": 0.0})
    assert variance.views_applied is False
    assert variance.delta_mu == {}


def test_non_convergence_falls_back_to_current_weights():
    result = run_optimize({"A": 3, "B": 1}, {"A": A, "B": B}, SPY, mode="target_volatility", lookback_days=365, vol_target=0.01)
    assert result.feasible is False
    assert result.target_weights == pytest.approx({"A": 0.75, "B": 0.25})
    assert any(warning.startswith("Optimizer did not converge") for warning in result.warnings)


def test_scoring_uses_backtest_series_and_rebalancing_changes_result():
    result = run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365)
    expected_current = backtest_series({"A": 0.25, "B": 0.25, "Y": 0.5}, CLOSES)
    expected_optimized = backtest_series({"A": 0.4, "B": 0.1, "Y": 0.5}, CLOSES)
    monthly = run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365, rebalance="monthly")

    assert result.curves.current == pytest.approx(expected_current.total, abs=1e-6)
    assert result.curves.optimized == pytest.approx(expected_optimized.total, abs=1e-6)
    assert abs(monthly.curves.optimized[-1] - result.curves.optimized[-1]) > 1e-6


def test_identical_portfolios_have_identical_scoring_and_metrics():
    result = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, mode="equal_weight", lookback_days=365)
    assert result.curves.current == pytest.approx(result.curves.optimized, abs=1e-9)
    assert result.metrics["current"]["cagr"] == pytest.approx(result.metrics["optimized"]["cagr"], abs=1e-9)
    assert {"beta", "alpha"} <= result.metrics["current"].keys()
    assert {"beta", "alpha"} <= result.metrics["optimized"].keys()


def test_benchmark_missing_or_late_is_not_scored():
    no_benchmark = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, None, lookback_days=365)
    late_benchmark = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY[SPY.index >= date(2024, 7, 1)], lookback_days=365)

    assert no_benchmark.curves.benchmark is None
    assert any("SPY is not stored" in warning for warning in no_benchmark.warnings)
    assert "beta" not in no_benchmark.metrics["current"]
    assert late_benchmark.curves.benchmark is None
    assert any("SPY" in warning for warning in late_benchmark.warnings)


def test_short_warning_and_sum_of_target_weights():
    result = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365, allow_short=True)
    assert "Short positions enabled. Equal Weight, Risk Parity, and Max Diversification remain long-only." in result.warnings
    assert sum(result.target_weights.values()) == pytest.approx(1.0, abs=1e-6)


@pytest.mark.parametrize(
    ("weights", "closes", "kwargs"),
    [
        ({}, {}, {}),
        ({"A": 0, "B": 1}, {"A": A, "B": B}, {}),
        ({"A": 1, "B": 1}, {"A": A, "B": B}, {"mode": "unknown"}),
        ({"A": 1, "B": 1}, {"A": A, "B": B}, {"lookback_days": 400}),
        ({"A": 1, "B": 1}, {"A": A, "B": B}, {"rebalance": "weekly"}),
        ({"A": 1, "B": 1}, {"A": A}, {}),
    ],
)
def test_input_errors(weights, closes, kwargs):
    with pytest.raises(OptimizeInputError):
        run_optimize(weights, closes, SPY, **({"lookback_days": 365} | kwargs))


def test_in_sample_warning_replaces_stale_constant_baseline_text():
    result = run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365)
    assert result.warnings[0] == "In-sample: the optimized weights were chosen using the same prices they are scored on."
    assert not any("constant baseline" in warning for warning in result.warnings)


def test_pinned_feasibility_messages_describe_final_weight_thresholds():
    with pytest.raises(OptimizeInputError, match=r"> 0.50") as minimum:
        run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365, min_weight=0.3)
    assert "after pinning" in str(minimum.value)
    with pytest.raises(OptimizeInputError, match="\(1 − pinned\)/N"):
        run_optimize({"A": 1, "B": 1, "Y": 2}, CLOSES, SPY, lookback_days=365, max_weight=0.2)
    with pytest.raises(OptimizeInputError, match="1/N") as maximum:
        run_optimize({"A": 1, "B": 1}, {"A": A, "B": B}, SPY, lookback_days=365, max_weight=0.4)
    assert "pinned" not in str(maximum.value)
