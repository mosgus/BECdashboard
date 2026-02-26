"""Tests for Epic S4: risk.py, scenarios.py, rebalance.py, and new indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_prices(n: int = 252, tickers: list[str] | None = None) -> pd.DataFrame:
    """Synthetic price DataFrame with deterministic random walk."""
    tickers = tickers or ["A", "B", "C"]
    rng = np.random.default_rng(42)
    rets = rng.normal(0.0005, 0.015, size=(n, len(tickers)))
    prices = 100.0 * np.exp(np.cumsum(rets, axis=0))
    idx = pd.date_range("2022-01-01", periods=n, freq="B")
    return pd.DataFrame(prices, index=idx, columns=tickers)


def _ohlcv(n: int = 252) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Synthetic H/L/C/V series for indicator tests."""
    prices = _make_prices(n, ["C"])
    close = prices["C"]
    high = close * 1.01
    low = close * 0.99
    volume = pd.Series(np.ones(n) * 1_000_000, index=close.index)
    return high, low, close, volume


# ── risk.py ────────────────────────────────────────────────────────────────────

class TestConcentration:
    def test_equal_weights_hhi(self):
        from core.risk import compute_concentration
        n = 10
        weights = {f"T{i}": 1.0 / n for i in range(n)}
        result = compute_concentration(weights)
        assert abs(result["hhi"] - 1.0 / n) < 1e-6, "Equal weights HHI should be 1/N"

    def test_single_position_hhi(self):
        from core.risk import compute_concentration
        result = compute_concentration({"AAPL": 1.0})
        assert result["hhi"] == pytest.approx(1.0, abs=1e-4)
        assert result["n_eff"] == pytest.approx(1.0, abs=1e-4)

    def test_n_eff_equals_n_for_equal_weights(self):
        from core.risk import compute_concentration
        n = 5
        weights = {f"T{i}": 1.0 / n for i in range(n)}
        result = compute_concentration(weights)
        assert abs(result["n_eff"] - n) < 1e-2


class TestRiskContributions:
    def test_rc_sum_to_one(self):
        from core.risk import compute_risk_contributions
        prices = _make_prices(120)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        rows = compute_risk_contributions(prices, weights)
        total_rc = sum(r["rc"] for r in rows if r["rc"] is not None)
        # rc values are rounded to 4dp — sum tolerance is N * 0.5e-4
        assert abs(total_rc - 1.0) < 1e-3, f"RC sum should be ~1.0, got {total_rc}"

    def test_rc_nonnegative_for_long_only(self):
        from core.risk import compute_risk_contributions
        prices = _make_prices(120)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        rows = compute_risk_contributions(prices, weights)
        for r in rows:
            if r["rc"] is not None:
                assert r["rc"] >= -1e-9, f"RC should be >= 0 for long-only, got {r['rc']}"

    def test_rc_insufficient_data_returns_none(self):
        from core.risk import compute_risk_contributions
        prices = _make_prices(3)  # only 3 rows — below min_periods=5
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        rows = compute_risk_contributions(prices, weights)
        assert all(r["rc"] is None for r in rows)


# ── scenarios.py ──────────────────────────────────────────────────────────────

class TestMarketShock:
    def test_zero_shock(self):
        from core.scenarios import run_market_shock
        weights = {"A": 0.5, "B": 0.5}
        result = run_market_shock(weights, 0.0)
        assert result["portfolio_impact"] == pytest.approx(0.0)
        assert all(c["impact"] == pytest.approx(0.0) for c in result["contributions"])

    def test_negative_shock_negative_impact(self):
        from core.scenarios import run_market_shock
        weights = {"A": 0.5, "B": 0.5}
        result = run_market_shock(weights, -0.20)
        assert result["portfolio_impact"] < 0

    def test_unit_portfolio_impact_equals_shock(self):
        from core.scenarios import run_market_shock
        # Fully invested: Σw = 1 → impact should equal shock_pct exactly
        weights = {"A": 0.4, "B": 0.6}
        result = run_market_shock(weights, -0.15)
        assert result["portfolio_impact"] == pytest.approx(-0.15, abs=1e-6)

    def test_contributions_sum_to_impact(self):
        from core.scenarios import run_market_shock
        weights = {"A": 0.3, "B": 0.4, "C": 0.3}
        result = run_market_shock(weights, -0.10)
        total = sum(c["impact"] for c in result["contributions"])
        assert abs(total - result["portfolio_impact"]) < 1e-6


class TestVolShock:
    def test_neutral_scale_unchanged(self):
        from core.scenarios import run_vol_shock
        prices = _make_prices(120)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        result = run_vol_shock(prices, weights, 1.0)
        assert result["base_vol"] is not None
        assert abs(result["shocked_vol"] - result["base_vol"]) < 1e-6

    def test_double_scale_doubles_vol(self):
        from core.scenarios import run_vol_shock
        prices = _make_prices(120)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        result = run_vol_shock(prices, weights, 2.0)
        assert result["shocked_vol"] is not None and result["base_vol"] is not None
        # Values rounded to 4dp: expect relative error < 0.1%
        assert abs(result["shocked_vol"] - 2.0 * result["base_vol"]) < 2e-3

    def test_higher_scale_higher_vol(self):
        from core.scenarios import run_vol_shock
        prices = _make_prices(120)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        r1 = run_vol_shock(prices, weights, 1.5)
        r2 = run_vol_shock(prices, weights, 2.5)
        assert r2["shocked_vol"] > r1["shocked_vol"]


class TestHistoricalReplay:
    def test_deterministic(self):
        from core.scenarios import run_historical_replay
        prices = _make_prices(252)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        r1 = run_historical_replay(prices, weights, "2022-01-01", "2022-06-30")
        r2 = run_historical_replay(prices, weights, "2022-01-01", "2022-06-30")
        assert r1["total_return"] == r2["total_return"]
        assert r1["max_dd"] == r2["max_dd"]

    def test_returns_required_fields(self):
        from core.scenarios import run_historical_replay
        prices = _make_prices(252)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        r = run_historical_replay(prices, weights, "2022-01-01", "2022-12-30")
        for field in ("total_return", "max_dd", "worst_day", "best_day", "n_days"):
            assert field in r and r[field] is not None

    def test_no_data_returns_error(self):
        from core.scenarios import run_historical_replay
        prices = _make_prices(10)
        weights = {"A": 0.5, "B": 0.3, "C": 0.2}
        r = run_historical_replay(prices, weights, "2030-01-01", "2030-12-31")
        assert "error" in r


# ── rebalance.py ──────────────────────────────────────────────────────────────

class TestRebalance:
    def test_turnover_identity(self):
        from core.rebalance import compute_rebalance
        current = {"A": 0.5, "B": 0.5}
        target = {"A": 0.7, "B": 0.3}
        result = compute_rebalance(current, target)
        expected_to = 0.5 * (abs(0.7 - 0.5) + abs(0.3 - 0.5))
        assert abs(result["turnover"] - expected_to) < 1e-6

    def test_zero_turnover_identical_weights(self):
        from core.rebalance import compute_rebalance
        current = {"A": 0.5, "B": 0.5}
        result = compute_rebalance(current, current)
        assert result["turnover"] == pytest.approx(0.0, abs=1e-6)

    def test_action_buy(self):
        from core.rebalance import compute_rebalance
        result = compute_rebalance({"A": 0.3}, {"A": 0.7})
        row = result["drift_table"][0]
        assert row["action"] == "BUY"

    def test_action_sell(self):
        from core.rebalance import compute_rebalance
        result = compute_rebalance({"A": 0.7}, {"A": 0.3})
        row = result["drift_table"][0]
        assert row["action"] == "SELL"

    def test_action_hold_near_zero(self):
        from core.rebalance import compute_rebalance
        result = compute_rebalance({"A": 0.5}, {"A": 0.5005})  # drift = 0.0005 < 0.001
        row = result["drift_table"][0]
        assert row["action"] == "HOLD"

    def test_top_trades_max_10(self):
        from core.rebalance import compute_rebalance
        current = {f"T{i}": 1.0 / 20 for i in range(20)}
        target = {f"T{i}": (i + 1) / 210.0 for i in range(20)}  # unequal
        result = compute_rebalance(current, target)
        assert len(result["top_trades"]) <= 10


# ── indicators.py (new) ────────────────────────────────────────────────────────

class TestEMA:
    def test_same_length(self):
        from core.indicators import compute_ema
        _, _, close, _ = _ohlcv(100)
        result = compute_ema(close, 20)
        assert len(result) == len(close)

    def test_no_lookahead(self):
        from core.indicators import compute_ema
        _, _, close, _ = _ohlcv(100)
        ema_full = compute_ema(close, 20)
        close_perturbed = close.copy()
        close_perturbed.iloc[-1] *= 1.10
        ema_perturbed = compute_ema(close_perturbed, 20)
        # All values except last should be identical
        assert np.allclose(ema_full.iloc[:-1].values, ema_perturbed.iloc[:-1].values, equal_nan=True)
        assert ema_full.iloc[-1] != ema_perturbed.iloc[-1]


class TestBollinger:
    def test_shape(self):
        from core.indicators import compute_bollinger
        _, _, close, _ = _ohlcv(100)
        upper, mid, lower = compute_bollinger(close)
        assert len(upper) == len(close)
        assert len(mid) == len(close)
        assert len(lower) == len(close)

    def test_upper_ge_mid_ge_lower(self):
        from core.indicators import compute_bollinger
        _, _, close, _ = _ohlcv(100)
        upper, mid, lower = compute_bollinger(close, window=20)
        valid = upper.dropna().index
        assert (upper[valid] >= mid[valid]).all()
        assert (mid[valid] >= lower[valid]).all()


class TestADX:
    def test_shape(self):
        from core.indicators import compute_adx
        high, low, close, _ = _ohlcv(100)
        result = compute_adx(high, low, close)
        assert len(result) == len(close)

    def test_range_0_100(self):
        from core.indicators import compute_adx
        high, low, close, _ = _ohlcv(200)
        result = compute_adx(high, low, close).dropna()
        assert (result >= 0).all() and (result <= 100).all()

    def test_no_lookahead(self):
        from core.indicators import compute_adx
        high, low, close, _ = _ohlcv(100)
        adx_full = compute_adx(high, low, close)
        # Perturb only last bar
        high2, low2, close2 = high.copy(), low.copy(), close.copy()
        high2.iloc[-1] *= 1.05
        adx_perturbed = compute_adx(high2, low2, close2)
        assert np.allclose(adx_full.iloc[:-1].values, adx_perturbed.iloc[:-1].values, equal_nan=True)


class TestDonchian:
    def test_shape(self):
        from core.indicators import compute_donchian
        high, low, _, _ = _ohlcv(100)
        upper, mid, lower = compute_donchian(high, low)
        assert len(upper) == len(high)

    def test_upper_ge_lower(self):
        from core.indicators import compute_donchian
        high, low, _, _ = _ohlcv(100)
        upper, mid, lower = compute_donchian(high, low, window=20)
        valid = upper.dropna().index
        assert (upper[valid] >= lower[valid]).all()


class TestStochastic:
    def test_shape(self):
        from core.indicators import compute_stochastic
        high, low, close, _ = _ohlcv(100)
        k, d = compute_stochastic(high, low, close)
        assert len(k) == len(close)
        assert len(d) == len(close)

    def test_bounds_0_100(self):
        from core.indicators import compute_stochastic
        high, low, close, _ = _ohlcv(200)
        k, d = compute_stochastic(high, low, close)
        valid_k = k.dropna()
        valid_d = d.dropna()
        assert (valid_k >= 0).all() and (valid_k <= 100).all()
        assert (valid_d >= 0).all() and (valid_d <= 100).all()


class TestOBV:
    def test_shape(self):
        from core.indicators import compute_obv
        _, _, close, volume = _ohlcv(100)
        result = compute_obv(close, volume)
        assert len(result) == len(close)

    def test_monotone_rising_price_positive_obv(self):
        from core.indicators import compute_obv
        idx = pd.date_range("2022-01-01", periods=10, freq="B")
        close = pd.Series(range(100, 110), index=idx, dtype=float)
        volume = pd.Series([1_000_000] * 10, index=idx, dtype=float)
        obv = compute_obv(close, volume)
        # OBV should be strictly increasing
        assert (obv.diff().dropna() > 0).all()
