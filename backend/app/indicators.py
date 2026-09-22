"""Pure technical-indicator calculations over price series."""

import numpy as np
import pandas as pd


def compute_sma(series: pd.Series, window: int) -> pd.Series:
    """Return the simple moving average for ``window`` observations."""
    return series.rolling(window).mean()


def compute_ema(series: pd.Series, window: int) -> pd.Series:
    """Return the exponentially weighted moving average with the given span."""
    return series.ewm(span=window, adjust=False).mean()


def compute_rsi(series: pd.Series, window: int = 14) -> pd.Series:
    """Return Wilder's relative-strength index."""
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(com=window - 1, min_periods=window).mean()
    avg_loss = loss.ewm(com=window - 1, min_periods=window).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi = rsi.where(avg_loss != 0, other=100.0)
    flat = (avg_gain == 0) & (avg_loss == 0)
    return rsi.where(~flat, other=50.0)


def compute_macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return the MACD line, its signal line, and their histogram."""
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line, macd_line - signal_line


def compute_atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int = 14,
) -> pd.Series:
    """Return Average True Range with Wilder EWM smoothing."""
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return true_range.ewm(com=window - 1, min_periods=window).mean()
