import pandas as pd
import pytest

from app.optimizer import compute_metrics
from app.performance_run import PerformanceInputError, run_performance


DATES = [day.date() for day in pd.bdate_range("2024-01-02", periods=140)]
A = pd.Series([100 * 1.001**index for index in range(140)], index=DATES)
B = pd.Series([50 + (index % 2) for index in range(140)], index=DATES)
M = pd.Series([200 + index for index in range(140)], index=DATES)


def run(**overrides):
    args = {
        "weights": {"A": 1, "B": 1},
        "cash": 2,
        "closes": {"A": A, "B": B},
        "market": M,
        "market_ticker": "M",
        "start": DATES[0],
        "end": DATES[-1],
        "today": DATES[-1],
        "rf": 0.04,
    }
    args.update(overrides)
    return run_performance(**args)


def test_cash_is_counted_in_buy_and_hold_path():
    result = run()
    assert result.path[-1].value == pytest.approx(0.5 + 0.25 * 1.001**139 + 0.25 * 51 / 50, rel=1e-9)
    assert result.cash_weight == pytest.approx(0.5)
    assert result.n_days == 139


def test_metrics_are_shared_with_optimizer():
    result = run()
    portfolio = pd.Series([point.value for point in result.path]).pct_change().dropna()
    market = pd.Series([point.market for point in result.path]).pct_change().dropna()
    expected = compute_metrics(portfolio, market, rf=0.04)
    benchmark = compute_metrics(market, None, rf=0.04)
    for key, value in expected.items():
        assert result.metrics[key] is None if value is None else result.metrics[key] == pytest.approx(value)
    for key, value in benchmark.items():
        assert result.bench_metrics[key] is None if value is None else result.bench_metrics[key] == pytest.approx(value)
    assert "beta" not in result.bench_metrics


def test_sharpe_subtracts_risk_free_rate():
    with_rate = run(rf=0.04)
    without_rate = run(rf=0.0)
    assert without_rate.metrics["sharpe"] - with_rate.metrics["sharpe"] == pytest.approx(0.04 / with_rate.metrics["vol"])


def test_missing_market_omits_market_metrics():
    result = run(market=M.iloc[5:])
    assert result.bench_metrics is None
    assert "beta" not in result.metrics and "alpha" not in result.metrics
    assert any("no market comparison" in warning for warning in result.warnings)


def test_short_window_is_refused():
    with pytest.raises(PerformanceInputError, match="at least 20 trading days"):
        run(end=DATES[10])


def test_short_window_warning():
    assert any("annualised from a short period" in warning for warning in run(end=DATES[29]).warnings)
    assert not any("annualised from a short period" in warning for warning in run().warnings)


def test_default_window_snaps_to_stored_prices():
    result = run(start=None, end=None)
    assert result.start == DATES[0]
    assert result.end == DATES[-1]


def test_coverage_is_carried_through():
    c = pd.Series([10.0] * 40, index=DATES[100:])
    result = run(weights={"A": 4, "B": 4, "C": 1}, closes={"A": A, "B": B, "C": c})
    assert result.coverage == pytest.approx(8 / 9)
    assert any("counted as flat" in warning for warning in result.warnings)
