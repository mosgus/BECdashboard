from datetime import date, timedelta

import pandas as pd

from app.signals import compute_all_signals, signal_macd_cross, signal_rsi_threshold, signal_sma_cross


def _series(values: list[float]) -> pd.Series:
    start = date(2026, 1, 1)
    return pd.Series(values, index=pd.to_datetime([start + timedelta(days=i) for i in range(len(values))]))


def test_sma_cross_reports_known_bullish_and_bearish_dates():
    bullish_prices = _series([100.0] * 60 + [101.0] + [102.0] * 10)
    bearish_prices = _series([100.0] * 60 + [99.0] + [98.0] * 10)
    expected_date = date(2026, 3, 2)

    bullish = signal_sma_cross(bullish_prices)
    bearish = signal_sma_cross(bearish_prices)

    assert bullish["state"] == "BULLISH"
    assert bullish["last_trigger_date"] == expected_date
    assert bullish["value"] is None
    assert bearish["state"] == "BEARISH"
    assert bearish["last_trigger_date"] == expected_date
    assert bearish["value"] is None


def test_rsi_threshold_reports_overbought_oversold_and_neutral():
    assert signal_rsi_threshold(_series([float(value) for value in range(40)]))["state"] == "OVERBOUGHT"
    assert signal_rsi_threshold(_series([float(value) for value in range(40, 0, -1)]))["state"] == "OVERSOLD"
    assert signal_rsi_threshold(_series([100.0 + (index % 2) * 0.1 for index in range(40)]))["state"] == "NEUTRAL"


def test_rsi_value_exposes_the_rounded_current_reading():
    neutral = signal_rsi_threshold(_series([100.0 + (index % 2) * 0.1 for index in range(40)]))
    rising = signal_rsi_threshold(_series([float(value) for value in range(40)]))
    flat = signal_rsi_threshold(_series([100.0] * 40))

    assert neutral["state"] == "NEUTRAL"
    assert neutral["value"] == 52.07
    assert 30.0 < neutral["value"] < 70.0
    assert rising["state"] == "OVERBOUGHT"
    assert rising["value"] == 100.0
    assert flat["state"] == "NEUTRAL"
    assert flat["value"] == 50.0


def test_macd_value_sign_matches_its_state():
    bullish = signal_macd_cross(_series([float(value) for value in range(60)]))
    bearish = signal_macd_cross(_series([float(value) for value in range(60, 0, -1)]))

    assert bullish["state"] == "BULLISH"
    assert bullish["value"] is not None and bullish["value"] > 0
    assert bearish["state"] == "BEARISH"
    assert bearish["value"] is not None and bearish["value"] < 0


def test_each_signal_distinguishes_insufficient_history_from_neutral():
    for signal in (
        signal_sma_cross(_series([100.0] * 49)),
        signal_rsi_threshold(_series([100.0] * 14)),
        signal_macd_cross(_series([100.0] * 34)),
    ):
        assert signal["state"] is None
        assert signal["value"] is None


def test_compute_all_signals_has_the_fixed_public_shape():
    signals = compute_all_signals(_series([100.0] * 60))

    assert [signal["label"] for signal in signals] == ["SMA 20/50", "RSI 14", "MACD 12/26/9"]
    assert all(set(signal) == {"signal", "label", "state", "last_trigger_date", "value"} for signal in signals)
