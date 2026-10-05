from datetime import timedelta

import numpy as np
import pandas as pd
import pytest

from app.attribution_run import AttributionInputError, run_attribution

DATES = [d.date() for d in pd.bdate_range("2024-01-02", periods=301)]
T = np.arange(1, 301)
MKT = 0.01 * np.sin(0.7 * T)
SMB = 0.006 * np.cos(1.3 * T)
HML = 0.004 * np.sin(0.4 * T + 1)
RF = np.full(300, 0.0002)
NOISE = 0.003 * np.sin(2.9 * T)
EXACT = RF + 0.0001 + 0.9 * MKT + 0.3 * SMB - 0.2 * HML
NOISY = EXACT + NOISE


def prices(returns): return pd.Series(100 * np.concatenate([[1.0], np.cumprod(1 + returns)]), index=DATES)


FACTORS = pd.DataFrame({"mkt_rf": MKT, "smb": SMB, "hml": HML, "rf": RF}, index=DATES[1:])
MARKET = prices(MKT + RF)


def run(returns=NOISY, *, cash=0.0, factors=FACTORS, start=DATES[0], end=DATES[-1], today=DATES[-1]):
    return run_attribution(
        {"A": 1.0}, cash, {"A": prices(returns)}, MARKET, factors,
        market_ticker="M", start=start, end=end, today=today,
    )


def design(returns):
    X = np.column_stack([np.ones(300), MKT, SMB, HML])
    y = returns - RF
    b = np.linalg.solve(X.T @ X, X.T @ y)
    resid = y - X @ b
    sigma2 = resid @ resid / (300 - 4)
    se = np.sqrt(np.diag(sigma2 * np.linalg.inv(X.T @ X)))
    return b, b / se, 1 - resid @ resid / ((y - y.mean()) ** 2).sum()


def test_exact_recovery():
    r = run(EXACT)
    assert [loading.key for loading in r.loadings] == ["market", "size", "value"]
    assert [loading.beta for loading in r.loadings] == pytest.approx([0.9, 0.3, -0.2], abs=1e-9)
    assert r.alpha_daily == pytest.approx(0.0001, abs=1e-10)
    assert r.alpha_annual == pytest.approx(1.0001**252 - 1)
    assert r.r_squared == pytest.approx(1, abs=1e-12)
    assert r.n_obs == 300


def test_additivity():
    r = run()
    c = r.contributions
    assert sum(c.values()) == pytest.approx(r.period_return, abs=1e-12)
    assert c["alpha"] + c["market"] + c["size"] + c["value"] + c["risk_free"] == pytest.approx(NOISY.sum(), abs=1e-12)
    assert r.period_return == pytest.approx(np.prod(1 + NOISY) - 1, abs=1e-12)
    assert c["risk_free"] == pytest.approx(0.06)


def test_statistics():
    r = run()
    _, t, r2 = design(NOISY)
    assert r.r_squared == pytest.approx(r2, abs=1e-9)
    assert [loading.t_stat for loading in r.loadings] == pytest.approx(list(t[1:]), abs=1e-9)


def test_cash_warning():
    r = run(cash=1.0)
    assert r.cash_weight == pytest.approx(0.5)
    assert [w for w in r.warnings if w.startswith("Cash (50.0% at the start) is counted at 0% return")]


def test_clipping_to_factor_end():
    r = run(factors=FACTORS.loc[: DATES[250]])
    assert r.end == DATES[250] and r.factor_end == DATES[250]
    assert any(w.startswith(f"Factor data ends on {DATES[250]}") for w in r.warnings)


def test_default_window():
    r = run(start=None, end=None, today=DATES[-1] + timedelta(days=40))
    assert r.factor_end == DATES[-1] and r.end == DATES[-1]
    assert (DATES[-1] - r.start).days <= 365
    assert not any("Factor data ends" in w for w in r.warnings)


def test_too_few_observations():
    with pytest.raises(AttributionInputError, match="At least 60 are needed"):
        run(start=DATES[250])


def test_short_window_warning():
    r = run(start=DATES[180])
    assert any(w.startswith("Only 120 trading days in this window") for w in r.warnings)
