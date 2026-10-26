from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.compare_run import MODES, correlation_matrix, run_compare
from app.optimize_run import OptimizeInputError, run_optimize

DATES = [d.date() for d in pd.bdate_range("2023-01-02", "2024-12-31")]   # 522 bars


def prices(pattern, dates=DATES):
    returns = np.resize(np.asarray(pattern, dtype=float), len(dates) - 1)
    return pd.Series(100 * np.concatenate([[1], np.cumprod(1 + returns)]), index=dates)


A = prices([0.01, -0.01, 0.01, -0.01])
A2 = prices([0.02, -0.02, 0.02, -0.02])            # returns are exactly 2 × A's: rho(A, A2) = 1
B = prices([0.02, 0.02, -0.02, -0.02])
C = prices([0.005, 0.003, -0.004, 0.001, -0.002])
LATE = [d for d in DATES if d >= date(2024, 1, 5)]
E = prices([0.02, 0.02, -0.02, -0.02], LATE)
F = prices([0.004, -0.003], LATE)
Y = pd.Series(50.0, index=DATES)                    # zero variance
SPY = A.copy()
ABC = {"A": A, "B": B, "C": C}
W3 = {"A": 1, "B": 1, "C": 1}


@pytest.fixture(scope="module")
def base():
    return run_compare(W3, ABC, SPY, lookback_days=365)


def test_all_eight_modes_in_order(base):
    assert [row.mode for row in base.modes] == list(MODES)
    assert all(row.error is None for row in base.modes)


def test_in_sample_matches_run_optimize(base):
    row = next(r for r in base.modes if r.mode == "min_variance")
    run = run_optimize(W3, ABC, SPY, mode="min_variance", lookback_days=365)
    assert row.target_weights == pytest.approx(run.target_weights, abs=1e-12)
    assert row.in_sample.sharpe == pytest.approx(run.metrics["optimized"]["sharpe"])


def test_holdout_has_no_lookahead(base):
    later_b = B.copy()
    later_b[later_b.index > date(2024, 1, 1)] *= 1.5
    later = run_compare(W3, {"A": A, "B": later_b, "C": C}, SPY, lookback_days=365)
    fit_closes = {t: s.loc[s.index <= date(2024, 1, 1)] for t, s in ABC.items()}
    for row_base, row_later in zip(base.modes, later.modes):
        assert row_base.holdout_weights == pytest.approx(row_later.holdout_weights, abs=1e-12)
        direct = run_optimize(W3, fit_closes, None, mode=row_base.mode, lookback_days=365)
        assert row_base.holdout_weights == pytest.approx(direct.target_weights, abs=1e-12)
    assert base.current.holdout.cagr != later.current.holdout.cagr


def test_holdout_window_dates(base):
    assert base.holdout.fit_end == date(2024, 1, 1)
    assert base.holdout.score_start == date(2024, 1, 1)
    assert base.holdout.score_end == date(2024, 12, 31)


def test_young_holding_is_excluded_from_holdout_only():
    result = run_compare({"A": 1, "B": 1, "E": 1}, {"A": A, "B": B, "E": E}, SPY, lookback_days=365)
    assert result.holdout.tickers == ["A", "B"]
    assert result.holdout.excluded == ["E"]
    equal = next(r for r in result.modes if r.mode == "equal_weight")
    assert set(equal.target_weights) == {"A", "B", "E"}


def test_holdout_unavailable_when_fewer_than_two_eligible():
    result = run_compare({"A": 1, "E": 1, "F": 1}, {"A": A, "E": E, "F": F}, SPY, lookback_days=365)
    assert result.holdout is None
    assert result.holdout_unavailable
    assert all(row.holdout is None for row in result.modes)
    assert all(row.in_sample is not None for row in result.modes)


def test_infeasible_vol_target_is_a_row_error():
    result = run_compare(W3, ABC, SPY, lookback_days=365, vol_target=0.01)
    row = next(r for r in result.modes if r.mode == "target_volatility")
    assert "Vol target" in row.error
    assert row.in_sample is None and row.target_weights is None and row.holdout is None
    assert all(r.error is None for r in result.modes if r.mode != "target_volatility")


def test_shared_input_error_propagates():
    with pytest.raises(OptimizeInputError):
        run_compare({"A": 1}, {"A": A}, SPY, lookback_days=365)


def test_traded_is_distance_from_current(base):
    for row in base.modes:
        expected = sum(abs(row.target_weights[t] - base.current_weights[t]) for t in base.tickers)
        assert row.traded == pytest.approx(expected, abs=1e-12)
    equal = next(r for r in base.modes if r.mode == "equal_weight")
    assert equal.traded == pytest.approx(0, abs=1e-12)


def test_correlation_clusters_identical_holdings():
    result = correlation_matrix(
        {"A": A, "B": B, "A2": A2, "C": C}, ["A", "B", "A2", "C"], date(2024, 1, 1), date(2024, 12, 31)
    )
    order = result.tickers
    assert abs(order.index("A") - order.index("A2")) == 1
    m = np.array(result.matrix)
    assert np.allclose(m, m.T, atol=1e-12)
    assert np.allclose(np.diag(m), 1, atol=1e-12)
    assert m[order.index("A"), order.index("A2")] == pytest.approx(1, abs=1e-9)
    assert abs(m[order.index("A"), order.index("B")]) < 0.05


def test_correlation_reports_the_limiting_holding():
    result = correlation_matrix(
        {"A": A, "B": B, "F": F}, ["A", "B", "F"], date(2023, 12, 1), date(2024, 12, 31)
    )
    assert result.limited_by == "F"
    assert result.start == date(2024, 1, 8)


def test_correlation_excludes_zero_variance():
    result = correlation_matrix(
        {"A": A, "B": B, "Y": Y}, ["A", "B", "Y"], date(2024, 1, 1), date(2024, 12, 31)
    )
    assert result.excluded == ["Y"]
    assert sorted(result.tickers) == ["A", "B"]


def test_correlation_none_with_fewer_than_two_usable():
    assert correlation_matrix({"A": A, "Y": Y}, ["A", "Y"], date(2024, 1, 1), date(2024, 12, 31)) is None
