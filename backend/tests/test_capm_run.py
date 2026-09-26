from datetime import date
import re

import numpy as np
import pandas as pd
import pytest

from app.capm_run import CapmInputError, HoldingConfig, run_capm


DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=261)]
m = np.tile([0.01, -0.01, 0.01, -0.01], 65)
e1 = np.tile([0.01, 0.01, -0.01, -0.01], 65)
e2 = np.tile([0.01, -0.01, -0.01, 0.01], 65)


def prices(returns, index=DATES, start=100.0):
    return pd.Series(start * np.concatenate([[1], np.cumprod(1 + returns)]), index=index)


M = prices(m)
A = prices(1.5 * m + e1)
B = prices(0.5 * m + e2)
K = DATES.index(date(2024, 6, 3))
Y = prices((0.8 * m + 0.5 * e1 + 0.5 * e2)[K:], index=DATES[K:], start=50.0)


def run(weights={"A": 1, "B": 1}, closes={"A": A, "B": B}, **kwargs):
    return run_capm(weights, closes, kwargs.pop("market", M), market_ticker=kwargs.pop("market_ticker", "M"),
                    rf=kwargs.pop("rf", 0.04), mrp=kwargs.pop("mrp", 0.05),
                    lookback_days=kwargs.pop("lookback_days", 365), **kwargs)


def test_two_holdings_match_the_analytic_tangency():
    result = run()
    assert result.current_weights == {"A": 0.5, "B": 0.5}
    assert result.target_weights["A"] == pytest.approx(0.75, abs=1e-4)
    assert result.target_weights["B"] == pytest.approx(0.25, abs=1e-4)
    assert sum(result.target_weights.values()) == pytest.approx(1, abs=1e-9)
    a, b = result.holdings
    assert (a.beta, b.beta) == pytest.approx((1.5, 0.5), abs=1e-9)
    assert (a.capm_return, b.capm_return) == pytest.approx((0.115, 0.065), abs=1e-9)
    assert (a.expected_return, b.expected_return) == pytest.approx((0.115, 0.065), abs=1e-9)
    assert result.expected_return == pytest.approx(0.1025, abs=1e-4)
    assert result.expected_vol == pytest.approx(0.235240, abs=1e-4)
    assert result.expected_sharpe == pytest.approx(0.265686, abs=1e-3)
    assert result.portfolio_beta == pytest.approx(1.25, abs=1e-4)
    assert result.var_95["daily"] == pytest.approx(-0.0239679, abs=1e-4)
    assert result.var_95["annual"] == pytest.approx(-0.284435, abs=1e-3)
    assert (a.vol, b.vol) == pytest.approx((0.286734, 0.177825), abs=1e-6)
    assert result.fit_start == result.score_start == date(2024, 1, 3)
    assert result.fit_end == date(2024, 12, 31)
    assert result.warnings == []
    assert result.tickers == ["A", "B"]
    assert all(not holding.pinned and not holding.frozen for holding in result.holdings)


def test_view_changes_expected_return_not_capm_return():
    result = run(configs={"A": HoldingConfig(view=-0.2)})
    a = result.holdings[0]
    assert (a.capm_return, a.view, a.expected_return) == pytest.approx((0.115, -0.2, 0.105), abs=1e-9)
    assert result.target_weights == pytest.approx({"A": 0.657895, "B": 0.342105}, abs=1e-4)
    assert result.expected_return == pytest.approx(0.0913158, abs=1e-4)


def test_market_as_holding_has_beta_one_and_freeze_holds_its_weight():
    result = run({"A": 20, "B": 30, "M": 50}, {"A": A, "B": B, "M": M}, configs={"M": HoldingConfig(freeze=True)})
    assert result.holdings[2].beta == 1.0
    assert result.holdings[2].frozen is True
    assert result.target_weights == pytest.approx({"A": 0.3125, "B": 0.1875, "M": 0.5}, abs=1e-4)


def test_unconstrained_with_the_market_held_is_all_market():
    result = run({"A": 1, "B": 1, "M": 1}, {"A": A, "B": B, "M": M})
    assert result.target_weights == pytest.approx({"A": 0, "B": 0, "M": 1}, abs=1e-3)


def test_max_weight_caps_a_holding():
    result = run(configs={"A": HoldingConfig(max_weight=0.6)})
    assert result.target_weights == pytest.approx({"A": 0.6, "B": 0.4}, abs=1e-6)


def test_young_holding_is_pinned_and_scored_on_the_common_window():
    result = run({"A": 40, "B": 40, "Y": 20}, {"A": A, "B": B, "Y": Y})
    assert result.target_weights == pytest.approx({"A": 0.6, "B": 0.2, "Y": 0.2}, abs=1e-4)
    y = result.holdings[2]
    assert y.pinned is True
    assert y.beta == pytest.approx(0.793333, abs=1e-6)
    assert result.fit_start == date(2024, 1, 3)
    assert result.score_start == date(2024, 6, 4)
    assert result.expected_return == pytest.approx(0.0979333, abs=1e-4)
    assert result.expected_vol == pytest.approx(0.219962, abs=1e-4)
    assert result.portfolio_beta == pytest.approx(1.158667, abs=1e-4)
    assert [holding.vol for holding in result.holdings] == pytest.approx((0.286243, 0.177594, 0.169006), abs=1e-4)
    assert result.warnings == [
        "Y has prices only from 2024-06-03; it is held at its current weight (20.0%) and not optimized. Its min/max limits and freeze setting do not apply.",
        "Volatility, Sharpe and VaR use prices from 2024-06-04 onward, the first date every holding has prices.",
    ]


@pytest.mark.parametrize(("kwargs", "message"), [
    ({"configs": {"A": HoldingConfig(max_weight=0.3), "B": HoldingConfig(max_weight=0.3)}}, "Maximum and frozen weights add up to 60.0%, less than the 100.0% that must be allocated. Raise some maximums or unfreeze a holding."),
    ({"configs": {"A": HoldingConfig(min_weight=0.6), "B": HoldingConfig(min_weight=0.6)}}, "Minimum and frozen weights add up to 120.0%, more than the 100.0% available to optimize. Lower some minimums or unfreeze a holding."),
    ({"configs": {"A": HoldingConfig(min_weight=0.5, max_weight=0.4)}}, "A: min weight (50.0%) is above max weight (40.0%)."),
    ({"configs": {"A": HoldingConfig(max_weight=1.2)}}, "A: weight limits must be between 0% and 100%."),
    ({"configs": {"A": HoldingConfig(view=1.5)}}, "A: view must be between -50% and +100%."),
    ({"configs": {"A": HoldingConfig(freeze=True), "B": HoldingConfig(freeze=True)}}, "Nothing to optimize: every holding with full history is frozen."),
    ({"weights": {"A": 1, "Y": 1}, "closes": {"A": A, "Y": Y}}, "Need at least 2 holdings with full history to optimize."),
    ({"configs": {"Z": HoldingConfig()}}, "configs names Z, which is not a holding."),
    ({"lookback_days": 400}, "lookback_days must be one of (365, 730, 1095, 1825)"),
    ({"rf": 0.25}, "rf must be between 0 and 0.2"),
    ({"mrp": 0}, "mrp must be above 0 and at most 0.2"),
    ({"market": Y, "market_ticker": "Y"}, "Market ticker Y has prices only from 2024-06-03, after the lookback start (2024-01-01). Choose a shorter lookback or another market ticker."),
])
def test_input_errors(kwargs, message):
    with pytest.raises(CapmInputError, match=re.escape(message)):
        run(**kwargs)


def test_non_convergence_is_an_input_error(monkeypatch):
    monkeypatch.setattr("app.capm_run.optimize_max_sharpe_capm", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("CAPM optimizer did not converge: test")))
    with pytest.raises(CapmInputError, match=re.escape("CAPM optimizer did not converge: test")):
        run()


def test_current_metrics_use_current_weights():
    result = run()
    current = result.current_metrics
    assert current["expected_return"] == pytest.approx(0.09, abs=1e-9)
    assert current["expected_vol"] == pytest.approx(0.194797, abs=1e-5)
    assert current["expected_sharpe"] == pytest.approx(0.256677, abs=1e-4)
    assert current["portfolio_beta"] == pytest.approx(1.0, abs=1e-9)
    assert result.expected_vol == pytest.approx(0.235240, abs=1e-4)


def test_short_history_warns():
    weeks = [day.date() for day in pd.date_range("2024-01-05", periods=55, freq="W-FRI")]
    market = prices(m[:54], index=weeks)
    a = prices((1.5 * m + e1)[:54], index=weeks)
    b = prices((0.5 * m + e2)[:54], index=weeks)
    result = run_capm(
        {"A": 1, "B": 1}, {"A": a, "B": b}, market,
        market_ticker="M", rf=0.04, mrp=0.05, lookback_days=365,
    )
    assert result.warnings == ["Fewer than 60 trading days of history — optimization results may be unreliable."]
    assert result.fit_start == result.score_start == date(2024, 1, 26)
    assert result.fit_end == date(2025, 1, 17)
    assert [holding.beta for holding in result.holdings] == pytest.approx((1.5, 0.5), abs=1e-9)
    assert result.target_weights == pytest.approx({"A": 0.75, "B": 0.25}, abs=1e-4)
    assert all(not holding.pinned for holding in result.holdings)
