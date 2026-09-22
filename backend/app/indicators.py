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


def compute_bollinger(
    series: pd.Series,
    window: int = 20,
    num_std: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return the upper band, middle SMA, and lower Bollinger band."""
    middle = compute_sma(series, window)
    standard_deviation = series.rolling(window).std(ddof=1)
    upper = middle + num_std * standard_deviation
    lower = middle - num_std * standard_deviation
    return upper, middle, lower


def compute_donchian(
    high: pd.Series,
    low: pd.Series,
    window: int = 20,
) -> tuple[pd.Series, pd.Series]:
    """Return the rolling highest high and lowest low over ``window``."""
    return high.rolling(window).max(), low.rolling(window).min()


def compute_adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int = 14,
) -> pd.Series:
    """Return Wilder-smoothed, direction-agnostic Average Directional Index."""
    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            high - low,
            (high - previous_close).abs(),
            (low - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)

    upward_move = high.diff()
    downward_move = -low.diff()
    positive_dm = pd.Series(
        np.where(
            (upward_move > downward_move) & (upward_move > 0),
            upward_move,
            0.0,
        ),
        index=high.index,
    )
    negative_dm = pd.Series(
        np.where(
            (downward_move > upward_move) & (downward_move > 0),
            downward_move,
            0.0,
        ),
        index=high.index,
    )

    average_true_range = true_range.ewm(
        com=window - 1,
        adjust=False,
        min_periods=window,
    ).mean().replace(0.0, np.nan)
    positive_di = 100.0 * positive_dm.ewm(
        com=window - 1,
        adjust=False,
        min_periods=window,
    ).mean() / average_true_range
    negative_di = 100.0 * negative_dm.ewm(
        com=window - 1,
        adjust=False,
        min_periods=window,
    ).mean() / average_true_range

    directional_index_denominator = (positive_di + negative_di).replace(0.0, np.nan)
    directional_index = (
        100.0
        * (positive_di - negative_di).abs()
        / directional_index_denominator
    )
    return directional_index.ewm(
        com=window - 1,
        adjust=False,
        min_periods=window,
    ).mean()


def compute_stochastic(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    k_window: int = 14,
    d_window: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """Return stochastic %K and its %D simple moving average."""
    lowest_low = low.rolling(k_window).min()
    highest_high = high.rolling(k_window).max()
    price_range = (highest_high - lowest_low).replace(0.0, np.nan)
    percent_k = 100.0 * (close - lowest_low) / price_range
    return percent_k, compute_sma(percent_k, d_window)


def compute_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """Return cumulative on-balance volume."""
    direction = np.sign(close.diff().fillna(0.0))
    return (direction * volume).cumsum()
