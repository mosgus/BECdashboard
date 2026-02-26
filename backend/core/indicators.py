"""Technical indicators and alert checks. No look-ahead bias."""
from __future__ import annotations

import numpy as np
import pandas as pd


# ── Indicators ────────────────────────────────────────────────────────────────

def compute_sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window).mean()


def compute_rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(com=window - 1, min_periods=window).mean()
    avg_loss = loss.ewm(com=window - 1, min_periods=window).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    # Pure uptrend: avg_loss=0 means RSI=100 (no losses at all)
    rsi = rsi.where(avg_loss != 0, other=100.0)
    return rsi


def compute_macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# ── Alert checks ──────────────────────────────────────────────────────────────

def check_sma_crossover(prices: pd.Series, fast: int = 20, slow: int = 50) -> dict:
    sma_fast = compute_sma(prices, fast)
    sma_slow = compute_sma(prices, slow)
    valid = sma_fast.dropna().index.intersection(sma_slow.dropna().index)
    if len(valid) < 2:
        return {"triggered": False, "message": "Insufficient data for SMA crossover."}

    prev_f, prev_s = sma_fast.loc[valid[-2]], sma_slow.loc[valid[-2]]
    curr_f, curr_s = sma_fast.loc[valid[-1]], sma_slow.loc[valid[-1]]

    bullish = prev_f <= prev_s and curr_f > curr_s
    bearish = prev_f >= prev_s and curr_f < curr_s
    triggered = bullish or bearish
    direction = "BULLISH" if bullish else ("BEARISH" if bearish else "NONE")
    msg = (
        f"SMA{fast}/SMA{slow} {direction} crossover on last bar."
        if triggered
        else f"No SMA{fast}/SMA{slow} crossover. SMA{fast}={curr_f:.2f}, SMA{slow}={curr_s:.2f}"
    )
    return {"triggered": triggered, "direction": direction, "message": msg}


def check_rsi_threshold(prices: pd.Series, overbought: int = 70, oversold: int = 30) -> dict:
    rsi = compute_rsi(prices).dropna()
    if rsi.empty:
        return {"triggered": False, "message": "Insufficient data for RSI."}
    latest = float(rsi.iloc[-1])
    if latest > overbought:
        return {"triggered": True, "rsi": latest, "message": f"RSI {latest:.1f} — OVERBOUGHT (>{overbought})"}
    if latest < oversold:
        return {"triggered": True, "rsi": latest, "message": f"RSI {latest:.1f} — OVERSOLD (<{oversold})"}
    return {"triggered": False, "rsi": latest, "message": f"RSI {latest:.1f} — Neutral"}


def check_price_threshold(prices: pd.Series, threshold: float, direction: str = "above") -> dict:
    latest = float(prices.iloc[-1])
    triggered = (latest > threshold) if direction == "above" else (latest < threshold)
    side = "above" if direction == "above" else "below"
    msg = (
        f"Price ${latest:.2f} is {side} threshold ${threshold:.2f}."
        if triggered
        else f"Price ${latest:.2f} has not crossed ${threshold:.2f} ({side})."
    )
    return {"triggered": triggered, "price": latest, "message": msg}


def compute_atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int = 14,
) -> pd.Series:
    """Average True Range using Wilder EWM smoothing."""
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            high - low,
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(com=window - 1, min_periods=window).mean()


# ── New indicators (Sprint 4) ─────────────────────────────────────────────────

def compute_ema(series: pd.Series, window: int) -> pd.Series:
    """Exponential Moving Average (EWM span)."""
    return series.ewm(span=window, adjust=False).mean()


def compute_bollinger(
    series: pd.Series,
    window: int = 20,
    num_std: float = 2.0,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Bollinger Bands: (upper, middle, lower).

    middle = SMA(window)
    upper  = middle + num_std * rolling_std
    lower  = middle - num_std * rolling_std
    """
    mid = series.rolling(window).mean()
    std = series.rolling(window).std(ddof=1)
    upper = mid + num_std * std
    lower = mid - num_std * std
    return upper, mid, lower


def compute_adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int = 14,
) -> pd.Series:
    """Average Directional Index using Wilder EWM smoothing.

    Values 0–100. Conventionally: > 25 = trending, < 20 = ranging.
    No look-ahead: all computations use only past bars.
    """
    # True Range
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)

    # Directional movement
    up_move = high.diff()
    down_move = -low.diff()

    dm_plus = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    dm_minus = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    dm_plus_s = pd.Series(dm_plus, index=high.index)
    dm_minus_s = pd.Series(dm_minus, index=high.index)

    # Wilder smoothing
    atr = tr.ewm(com=window - 1, adjust=False, min_periods=window).mean()
    di_plus = 100.0 * dm_plus_s.ewm(com=window - 1, adjust=False, min_periods=window).mean() / atr
    di_minus = 100.0 * dm_minus_s.ewm(com=window - 1, adjust=False, min_periods=window).mean() / atr

    dx_denom = (di_plus + di_minus).replace(0.0, np.nan)
    dx = 100.0 * (di_plus - di_minus).abs() / dx_denom
    adx = dx.ewm(com=window - 1, adjust=False, min_periods=window).mean()
    return adx


def compute_donchian(
    high: pd.Series,
    low: pd.Series,
    window: int = 20,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Donchian Channel: (upper, mid, lower).

    upper = rolling max(high, window)
    lower = rolling min(low,  window)
    mid   = (upper + lower) / 2
    """
    upper = high.rolling(window).max()
    lower = low.rolling(window).min()
    mid = (upper + lower) / 2.0
    return upper, mid, lower


def compute_stochastic(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    k_window: int = 14,
    d_window: int = 3,
    smooth_k: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """Full Stochastic Oscillator (%K smoothed, %D). Values 0–100.

    Raw %K = 100 * (close - lowest_low) / (highest_high - lowest_low)
    Smooth %K = SMA(raw_K, smooth_k)
    %D        = SMA(smooth_%K, d_window)
    """
    lowest_low = low.rolling(k_window).min()
    highest_high = high.rolling(k_window).max()
    range_ = (highest_high - lowest_low).replace(0.0, np.nan)
    raw_k = 100.0 * (close - lowest_low) / range_
    k = raw_k.rolling(smooth_k).mean()
    d = k.rolling(d_window).mean()
    return k, d


def compute_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """On-Balance Volume: cumulative sum weighted by daily close direction.

    OBV_t = OBV_{t-1} + volume_t  if close_t > close_{t-1}
                       - volume_t  if close_t < close_{t-1}
                       + 0         otherwise
    """
    direction = np.sign(close.diff().fillna(0.0))
    return (direction * volume).cumsum()


# ── Alert checks ──────────────────────────────────────────────────────────────

def simulate_email_alert(ticker: str, alert: dict) -> dict:
    return {
        "to": "analyst@blueeagle.fund",
        "subject": f"[Blue Eagle Alert] {ticker} — {alert.get('message', '')}",
        "body": (
            f"Alert triggered for {ticker}.\n\n"
            f"Details:\n{alert}\n\n"
            "— Blue Eagle Portfolio System"
        ),
        "ticker": ticker,
        "alert": alert,
    }
