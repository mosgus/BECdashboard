from datetime import date
from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from app.compare_run import MODES, correlation_matrix, run_compare
from app.compare_run import _score
from app.optimize_run import OptimizeInputError, run_optimize
from app.portfolio_series import backtest_series

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


LONG_DATES = [d.date() for d in pd.bdate_range("2019-01-02", "2024-12-31")]
LA = prices([0.01, -0.01, 0.01, -0.01], LONG_DATES)
LB = prices([0.02, 0.02, -0.02, -0.02], LONG_DATES)
LC = prices([0.005, 0.003, -0.004, 0.001, -0.002], LONG_DATES)
YOUNG_DATES = [d for d in LONG_DATES if d >= date(2022, 1, 3)]
LY = prices([0.004, -0.003, 0.002], YOUNG_DATES)
LONG = {"A": LA, "B": LB, "C": LC, "Y": LY}
WLONG = {t: 1 for t in LONG}


@pytest.fixture(scope="module")
def long_result():
    return run_compare(WLONG, LONG, LA, lookback_days=365, folds=4)


def test_folds_step_back_one_year(long_result):
    folds = long_result.folds
    assert [f.fold for f in folds] == [1, 2, 3, 4]
    end = min(s.index[-1] for s in LONG.values())
    assert folds[0].score_end == end
    for f in folds:
        assert f.score_end - f.cut == timedelta(days=365)
    for prev, nxt in zip(folds, folds[1:]):
        assert prev.score_end - nxt.score_end == timedelta(days=365)


def test_folds_have_no_lookahead(long_result):
    for f in long_result.folds:
        assert f.unavailable is None
        assert f.fit_end <= f.cut
        assert f.score_start >= f.fit_end
        fit_closes = {t: LONG[t].loc[LONG[t].index <= f.cut] for t in f.tickers}
        fit_weights = {t: 1 for t in f.tickers}
        scored = {
            t: LONG[t].loc[(LONG[t].index >= f.fit_end) & (LONG[t].index <= f.score_end)]
            for t in f.tickers
        }
        for fm in f.modes:
            if fm.holdout is None:
                continue
            run = run_optimize(fit_weights, fit_closes, None, mode=fm.mode, lookback_days=365)
            by_hand = _score(backtest_series(run.target_weights, scored, "none").total, 0.0427)
            assert fm.holdout.sharpe == pytest.approx(by_hand.sharpe)


def test_young_holding_excluded_by_fold(long_result):
    first_bar = LY.index[0]
    for f in long_result.folds:
        if f.cut < first_bar:
            assert "Y" in f.excluded and "Y" not in f.tickers
        else:
            assert "Y" in f.tickers and "Y" not in f.excluded
    assert any("Y" in f.excluded for f in long_result.folds)
    assert any("Y" in f.tickers for f in long_result.folds)


def test_short_history_folds_are_unavailable(base):
    result = run_compare(W3, ABC, SPY, lookback_days=365, folds=4)
    assert len(result.folds) == 4
    for f in result.folds[1:]:
        assert f.unavailable
        assert f.current is None and f.modes == [] and f.vol_target is None
    assert result.folds[0].unavailable is None
    assert result.folds[0].current == result.current.holdout


def test_fold_one_equals_legacy_fields(long_result):
    fold1 = long_result.folds[0]
    assert fold1.current == long_result.current.holdout
    assert [fm.mode for fm in fold1.modes] == list(MODES)
    for fm, row in zip(fold1.modes, long_result.modes):
        assert fm.holdout == row.holdout
        assert fm.error == row.holdout_error
    assert long_result.holdout.score_start == fold1.score_start
    assert long_result.holdout.fit_end == fold1.fit_end


def test_vol_target_none_matches_current_vol():
    result = run_compare(W3, ABC, SPY, lookback_days=365, vol_target=None, folds=1)
    equal_run = run_optimize(W3, ABC, SPY, mode="equal_weight", lookback_days=365)
    assert result.vol_target == pytest.approx(equal_run.metrics["current"]["vol"])
    row = next(r for r in result.modes if r.mode == "target_volatility")
    assert row.error is None
    assert isinstance(result.folds[0].vol_target, float)


def test_vol_target_none_resolves_per_fold():
    result = run_compare(WLONG, LONG, LA, lookback_days=365, vol_target=None, folds=4)
    for f in result.folds:
        assert f.unavailable is None
        assert isinstance(f.vol_target, float)


def test_numeric_vol_target_is_reported():
    result = run_compare(W3, ABC, SPY, lookback_days=365, vol_target=0.10)
    assert result.vol_target == 0.10
    assert result.folds[0].vol_target == 0.10


def test_frontier_computed_once(monkeypatch):
    frontier_call_count = 0
    random_call_count = 0

    original_frontier = __import__("app.optimize_run", fromlist=["efficient_frontier"]).efficient_frontier
    original_random = __import__("app.optimize_run", fromlist=["random_portfolios"]).random_portfolios

    def counting_frontier(*args, **kwargs):
        nonlocal frontier_call_count
        frontier_call_count += 1
        return original_frontier(*args, **kwargs)

    def counting_random(*args, **kwargs):
        nonlocal random_call_count
        random_call_count += 1
        return original_random(*args, **kwargs)

    monkeypatch.setattr("app.optimize_run.efficient_frontier", counting_frontier)
    monkeypatch.setattr("app.optimize_run.random_portfolios", counting_random)

    run_compare(W3, ABC, SPY, lookback_days=365, folds=2)

    assert frontier_call_count == 1
    assert random_call_count == 1
