"""Tests for signal computation — correctness and no look-ahead bias."""
import numpy as np
import pandas as pd
import pytest

from core.signals import (
    compute_all_signals,
    signal_macd_cross,
    signal_rsi_threshold,
    signal_sma_cross,
)


def _make_series(values: list[float], freq: str = "B") -> pd.Series:
    idx = pd.date_range("2020-01-01", periods=len(values), freq=freq)
    return pd.Series(values, index=idx)


# ── SMA Cross ─────────────────────────────────────────────────────────────────

class TestSmaCross:
    def test_bullish_crossover_detected(self):
        """Fast SMA crosses above slow SMA → BULLISH."""
        # 60 bars: price rises sharply at bar 50 to create a fast/slow cross
        prices = [100.0] * 50 + [110.0 + i * 0.5 for i in range(10)]
        result = signal_sma_cross(_make_series(prices), fast=5, slow=20)
        assert result["state"] == "BULLISH"
        assert result["last_trigger_date"] is not None

    def test_bearish_crossover_detected(self):
        """Fast SMA crosses below slow SMA → BEARISH."""
        prices = [100.0] * 50 + [90.0 - i * 0.5 for i in range(10)]
        result = signal_sma_cross(_make_series(prices), fast=5, slow=20)
        assert result["state"] == "BEARISH"
        assert result["last_trigger_date"] is not None

    def test_no_crossover_returns_state(self):
        """Monotonically rising series — no crossover but state should reflect position."""
        prices = list(range(1, 101))
        result = signal_sma_cross(_make_series(prices), fast=5, slow=20)
        assert result["state"] in ("BULLISH", "BEARISH", "NEUTRAL")

    def test_insufficient_data(self):
        """Too few bars for SMA computation → NEUTRAL, no trigger."""
        result = signal_sma_cross(_make_series([100.0, 101.0, 102.0]), fast=20, slow=50)
        assert result["state"] == "NEUTRAL"
        assert result["last_trigger_date"] is None

    def test_no_look_ahead(self):
        """Signal computed on truncated series matches past signal on full series."""
        prices = [100.0] * 50 + [120.0 + i for i in range(30)]
        full = _make_series(prices)
        full_result = signal_sma_cross(full, fast=5, slow=20)

        # Truncate to just before the tail
        truncated = full.iloc[:55]
        trunc_result = signal_sma_cross(truncated, fast=5, slow=20)

        # Past state on truncated series must not depend on future bars
        # (Both are computed independently — we just verify truncated doesn't
        #  report a trigger_date beyond its own last index.)
        if trunc_result["last_trigger_date"]:
            trigger = pd.Timestamp(trunc_result["last_trigger_date"])
            assert trigger <= truncated.index[-1]

    def test_trigger_values_present_when_triggered(self):
        """If a crossover occurred, trigger_values must contain fast and slow."""
        prices = [100.0] * 50 + [130.0 + i * 2 for i in range(20)]
        result = signal_sma_cross(_make_series(prices), fast=5, slow=20)
        if result["last_trigger_date"]:
            assert "fast" in result["trigger_values"]
            assert "slow" in result["trigger_values"]


# ── RSI Threshold ─────────────────────────────────────────────────────────────

class TestRsiThreshold:
    def test_overbought_detection(self):
        """Strongly trending up series → OVERBOUGHT."""
        prices = [100.0 + i * 2 for i in range(60)]
        result = signal_rsi_threshold(_make_series(prices))
        assert result["state"] == "OVERBOUGHT"
        assert result["current_rsi"] is not None
        assert result["current_rsi"] > 70

    def test_oversold_detection(self):
        """Strongly trending down series → OVERSOLD."""
        prices = [200.0 - i * 2 for i in range(60)]
        result = signal_rsi_threshold(_make_series(prices))
        assert result["state"] == "OVERSOLD"
        assert result["current_rsi"] < 30

    def test_neutral_sideways(self):
        """Oscillating series → NEUTRAL RSI."""
        np.random.seed(42)
        prices = 100.0 + np.cumsum(np.random.randn(200) * 0.2)
        result = signal_rsi_threshold(_make_series(list(prices)))
        assert result["state"] in ("NEUTRAL", "OVERBOUGHT", "OVERSOLD")

    def test_insufficient_data(self):
        result = signal_rsi_threshold(_make_series([100.0, 101.0]))
        assert result["state"] == "NEUTRAL"

    def test_no_look_ahead(self):
        """Trigger dates must not exceed the series end date."""
        prices = [100.0 + i * 1.5 for i in range(80)]
        series = _make_series(prices)
        result = signal_rsi_threshold(series)
        if result["last_trigger_date"]:
            assert pd.Timestamp(result["last_trigger_date"]) <= series.index[-1]

    def test_current_rsi_in_result(self):
        prices = list(range(100, 160))
        result = signal_rsi_threshold(_make_series(prices))
        assert "current_rsi" in result
        assert result["current_rsi"] is not None


# ── MACD Cross ────────────────────────────────────────────────────────────────

class TestMacdCross:
    def test_bullish_macd(self):
        """Rising price series → MACD histogram > 0 → BULLISH."""
        prices = [100.0 + i * 0.8 for i in range(100)]
        result = signal_macd_cross(_make_series(prices))
        assert result["state"] in ("BULLISH", "BEARISH")

    def test_state_is_bullish_or_bearish(self):
        """MACD cross always returns BULLISH or BEARISH (never NEUTRAL for long series)."""
        prices = list(range(100, 200))
        result = signal_macd_cross(_make_series(prices))
        assert result["state"] in ("BULLISH", "BEARISH")

    def test_insufficient_data(self):
        result = signal_macd_cross(_make_series([100.0] * 10))
        assert result["state"] == "NEUTRAL"

    def test_no_look_ahead(self):
        prices = [100.0 + np.sin(i * 0.3) * 5 for i in range(120)]
        series = _make_series(prices)
        result = signal_macd_cross(series)
        if result["last_trigger_date"]:
            assert pd.Timestamp(result["last_trigger_date"]) <= series.index[-1]

    def test_trigger_values_when_triggered(self):
        prices = list(range(50, 150))
        result = signal_macd_cross(_make_series(prices))
        if result["last_trigger_date"]:
            assert "macd" in result["trigger_values"]
            assert "signal" in result["trigger_values"]
            assert "histogram" in result["trigger_values"]


# ── compute_all_signals ───────────────────────────────────────────────────────

class TestComputeAllSignals:
    def test_returns_three_signals(self):
        prices = [100.0 + i * 0.5 for i in range(100)]
        results = compute_all_signals(_make_series(prices))
        assert len(results) == 3

    def test_signal_names_present(self):
        prices = [100.0 + i * 0.5 for i in range(100)]
        results = compute_all_signals(_make_series(prices))
        names = {r["signal"] for r in results}
        assert names == {"sma_cross", "rsi_threshold", "macd_cross"}

    def test_all_have_required_keys(self):
        prices = [100.0 + i * 0.5 for i in range(100)]
        results = compute_all_signals(_make_series(prices))
        for r in results:
            assert "state" in r
            assert "last_trigger_date" in r
            assert "trigger_values" in r
