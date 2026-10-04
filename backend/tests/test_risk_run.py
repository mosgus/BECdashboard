from datetime import date
import re

import numpy as np
import pandas as pd
import pytest

from app.risk_run import RiskInputError, run_risk


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
V = 0.0001 * 260 / 259


def run(weights={"A": 1, "B": 1}, closes={"A": A, "B": B}, **kwargs):
    return run_risk(weights, kwargs.pop("cash", 0), closes, kwargs.pop("market", M), market_ticker=kwargs.pop("market_ticker", "M"), lookback_days=kwargs.pop("lookback_days", 365))


def test_equal_weights_no_cash():
    result = run()
    a, b = result.holdings
    assert (a.risk_share, b.risk_share) == pytest.approx((2 / 3, 1 / 3), abs=1e-9)
    assert (a.beta, b.beta, result.portfolio_beta) == pytest.approx((1.5, 0.5, 1), abs=1e-9)
    assert result.portfolio_vol == pytest.approx(np.sqrt(1.5 * 252 * V), abs=1e-9)
    assert a.vol == pytest.approx(np.sqrt(3.25 * 252 * V), abs=1e-9)
    assert (result.hhi, result.effective_holdings, result.top5_weight, result.cash_weight) == pytest.approx((.5, 2, 1, 0), abs=1e-9)
    assert (result.n_returns, result.start, result.end, result.warnings) == (260, DATES[1], DATES[-1], [])


def test_cash_halves_risk_not_shares():
    result = run(cash=2)
    assert [holding.weight for holding in result.holdings] == pytest.approx((.25, .25), abs=1e-9)
    assert [holding.invested_weight for holding in result.holdings] == pytest.approx((.5, .5), abs=1e-9)
    assert (result.cash_weight, result.portfolio_vol, result.portfolio_beta) == pytest.approx((.5, np.sqrt(1.5 * 252 * V) / 2, .5), abs=1e-9)
    assert [holding.risk_share for holding in result.holdings] == pytest.approx((2 / 3, 1 / 3), abs=1e-9)
    assert result.effective_holdings == pytest.approx(2, abs=1e-9)


def test_unequal_weights():
    result = run({"A": 3, "B": 1})
    assert [holding.risk_share for holding in result.holdings] == pytest.approx((.9, .1), abs=1e-9)
    assert (result.hhi, result.effective_holdings) == pytest.approx((.625, 1.6), abs=1e-9)


def test_late_holding_warns():
    result = run({"A": 1, "B": 1, "Y": 1}, {"A": A, "B": B, "Y": Y})
    assert result.start == DATES[K + 1]
    assert len(result.warnings) == 1 and "Y (" in result.warnings[0] and str(DATES[K]) in result.warnings[0]


def test_market_holding_has_beta_one():
    result = run({"M": 1, "A": 1}, {"M": M, "A": A})
    assert [holding.beta for holding in result.holdings] == pytest.approx((1, 1.5), abs=1e-9)


@pytest.mark.parametrize(("kwargs", "message"), [
    ({"weights": {"A": 0}}, "weights must be finite and greater than zero"),
    ({"cash": -1}, "cash must be finite and zero or more"),
    ({"lookback_days": 10}, "lookback_days must be between 28 and 3650"),
    ({"weights": {"A": 1, "Z": 1}}, "missing closes for weighted ticker 'Z'"),
])
def test_validation(kwargs, message):
    with pytest.raises(RiskInputError, match=re.escape(message)):
        run(**kwargs)


def test_late_market_errors():
    with pytest.raises(RiskInputError, match="Market ticker M has prices only from"):
        run(market=prices(m[K:], index=DATES[K:]))


def test_single_holding():
    result = run({"A": 1}, {"A": A})
    assert result.holdings[0].risk_share == pytest.approx(1, abs=1e-9)
    assert result.effective_holdings == pytest.approx(1, abs=1e-9)
    assert result.portfolio_vol == pytest.approx(result.holdings[0].vol, abs=1e-9)
