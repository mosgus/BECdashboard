import pandas as pd
import pytest

from app.indicators import compute_atr, compute_macd, compute_rsi, compute_sma
from app.signals import signal_rsi_threshold


def test_sma_known_values():
    result = compute_sma(pd.Series(range(1, 11)), window=5)

    assert result.iloc[:4].isna().all()
    assert result.iloc[-1] == 8.0


def test_rsi_saturates_for_strict_rises_and_falls():
    assert compute_rsi(pd.Series(range(30))).iloc[-1] == 100.0
    assert compute_rsi(pd.Series(range(30, 0, -1))).iloc[-1] == 0.0


def test_rsi_is_neutral_for_a_flat_series():
    assert compute_rsi(pd.Series([50.0] * 30)).iloc[-1] == 50.0


def test_rsi_stays_overbought_after_a_rise_then_flat_stretch():
    # Deliberate: a flat stretch after a rise still reads 100 because every move was upward.
    prices = pd.Series([float(value) for value in range(10)] + [9.0] * 20)

    assert compute_rsi(prices).iloc[-1] == 100.0


def test_rsi_threshold_is_neutral_for_a_flat_series():
    assert signal_rsi_threshold(pd.Series([50.0] * 30))["state"] == "NEUTRAL"


def test_macd_is_zero_for_a_constant_series():
    macd, signal, histogram = compute_macd(pd.Series([17.0] * 40))

    assert (macd.dropna() == 0.0).all()
    assert (signal.dropna() == 0.0).all()
    assert (histogram.dropna() == 0.0).all()


def test_atr_is_zero_when_every_bar_is_flat():
    prices = pd.Series([10.0] * 20)

    assert compute_atr(prices, prices, prices).iloc[-1] == 0.0


def test_atr_settles_at_the_constant_true_range():
    close = pd.Series([100.0] * 20)
    high = close + 1.0
    low = close - 1.0

    assert compute_atr(high, low, close).iloc[-1] == pytest.approx(2.0)
