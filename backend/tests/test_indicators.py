import numpy as np
import pandas as pd
import pytest

from app.indicators import (
    compute_adx,
    compute_atr,
    compute_bollinger,
    compute_donchian,
    compute_macd,
    compute_obv,
    compute_rsi,
    compute_sma,
    compute_stochastic,
)
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


def test_bollinger_bands_collapse_for_a_constant_series():
    upper, middle, lower = compute_bollinger(pd.Series([17.0] * 25))

    assert (upper.dropna() == 17.0).all()
    assert (middle.dropna() == 17.0).all()
    assert (lower.dropna() == 17.0).all()


def test_bollinger_middle_matches_sma_and_bands_are_symmetric():
    prices = pd.Series(np.arange(1.0, 41.0))
    upper, middle, lower = compute_bollinger(prices)

    pd.testing.assert_series_equal(middle, compute_sma(prices, 20))
    assert np.allclose(
        (upper - middle).dropna(),
        (middle - lower).dropna(),
    )


def test_donchian_channel_on_a_rising_series():
    high = pd.Series(np.arange(1.0, 41.0))
    upper, lower = compute_donchian(high, high)

    assert upper.iloc[-1] == 40.0
    assert lower.iloc[-1] == 21.0


def test_adx_is_bounded_and_distinguishes_trend_from_range():
    trend = pd.Series(np.arange(100.0, 200.0))
    alternating = pd.Series([100.0 + index % 2 for index in range(100)])
    trending_adx = compute_adx(trend + 1.0, trend - 1.0, trend)
    alternating_adx = compute_adx(
        alternating + 1.0,
        alternating - 1.0,
        alternating,
    )

    assert trending_adx.iloc[-1] > 25.0
    assert alternating_adx.iloc[-1] < 20.0
    for adx in (trending_adx, alternating_adx):
        non_null = adx.dropna()
        assert ((non_null >= 0.0) & (non_null <= 100.0)).all()


def test_adx_is_never_infinite_for_a_flat_series():
    flat = pd.Series([100.0] * 30)
    adx = compute_adx(flat, flat, flat)

    assert (np.isfinite(adx) | np.isnan(adx)).all()


def test_stochastic_extremes_and_percent_d_sma():
    rising_high = pd.Series(np.arange(1.0, 21.0))
    rising_low = rising_high - 1.0
    rising_k, rising_d = compute_stochastic(rising_high, rising_low, rising_high)
    falling_high = pd.Series(np.arange(20.0, 0.0, -1.0))
    falling_low = falling_high - 1.0
    falling_k, _ = compute_stochastic(falling_high, falling_low, falling_low)

    assert rising_k.iloc[-1] == 100.0
    assert falling_k.iloc[-1] == 0.0
    pd.testing.assert_series_equal(rising_d, compute_sma(rising_k, 3))


def test_stochastic_is_nan_for_a_zero_range():
    flat = pd.Series([100.0] * 20)
    percent_k, _ = compute_stochastic(flat, flat, flat)

    assert np.isnan(percent_k.iloc[-1])


def test_obv_uses_zero_for_the_initial_and_flat_bars():
    volume = pd.Series([100.0] * 4)
    rising = compute_obv(pd.Series([100.0, 101.0, 102.0, 103.0]), volume)
    falling = compute_obv(pd.Series([103.0, 102.0, 101.0, 100.0]), volume)
    flat_day = compute_obv(pd.Series([100.0, 101.0, 101.0, 102.0]), volume)

    assert rising.iloc[0] == 0.0
    assert falling.iloc[0] == 0.0
    assert rising.iloc[-1] == 300.0
    assert falling.iloc[-1] == -300.0
    assert flat_day.iloc[-1] == 200.0
    assert flat_day.iloc[-1] != 300.0
