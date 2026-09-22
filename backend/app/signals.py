"""Pure derivation of technical-signal states from adjusted prices."""

from datetime import date, datetime

import pandas as pd

from .indicators import compute_macd, compute_rsi, compute_sma

SIGNAL_STATES = ("BULLISH", "BEARISH", "NEUTRAL", "OVERBOUGHT", "OVERSOLD")


def _as_date(value: object) -> date:
    if isinstance(value, pd.Timestamp | datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raise TypeError(f"Signal index must contain dates, not {type(value).__name__}")


def _signal(
    signal: str,
    label: str,
    state: str | None,
    last_trigger_date: date | None,
    value: float | None = None,
) -> dict:
    return {
        "signal": signal,
        "label": label,
        "state": state,
        "last_trigger_date": last_trigger_date,
        "value": value,
    }


def signal_sma_cross(prices: pd.Series, fast: int = 20, slow: int = 50) -> dict:
    """Return the current fast/slow SMA relation and its latest crossover."""
    label = f"SMA {fast}/{slow}"
    if len(prices) < slow:
        return _signal("sma_cross", label, None, None)

    sma_fast = compute_sma(prices, fast)
    sma_slow = compute_sma(prices, slow)
    valid = sma_fast.dropna().index.intersection(sma_slow.dropna().index)
    if len(valid) < 2:
        return _signal("sma_cross", label, "NEUTRAL", None)

    difference = sma_fast.loc[valid] - sma_slow.loc[valid]
    last_trigger_date = None
    for index in range(1, len(valid)):
        previous = float(difference.iloc[index - 1])
        current = float(difference.iloc[index])
        if (previous <= 0 < current) or (previous >= 0 > current):
            last_trigger_date = _as_date(valid[index])

    latest = float(difference.iloc[-1])
    state = "BULLISH" if latest > 0 else "BEARISH" if latest < 0 else "NEUTRAL"
    return _signal("sma_cross", label, state, last_trigger_date)


def signal_rsi_threshold(prices: pd.Series, overbought: int = 70, oversold: int = 30) -> dict:
    """Return the current RSI threshold state and start of its active condition."""
    label = "RSI 14"
    if len(prices) < 15:
        return _signal("rsi_threshold", label, None, None)

    rsi = compute_rsi(prices).dropna()
    if rsi.empty:
        return _signal("rsi_threshold", label, None, None)

    latest = float(rsi.iloc[-1])
    if latest >= overbought:
        state = "OVERBOUGHT"
        active = rsi >= overbought
    elif latest <= oversold:
        state = "OVERSOLD"
        active = rsi <= oversold
    else:
        return _signal("rsi_threshold", label, "NEUTRAL", None, round(latest, 2))

    first_active = len(active) - 1
    while first_active > 0 and bool(active.iloc[first_active - 1]):
        first_active -= 1
    return _signal("rsi_threshold", label, state, _as_date(active.index[first_active]), round(latest, 2))


def signal_macd_cross(prices: pd.Series) -> dict:
    """Return the MACD histogram relation and its latest zero crossover."""
    label = "MACD 12/26/9"
    if len(prices) < 35:
        return _signal("macd_cross", label, None, None)

    _, _, histogram = compute_macd(prices)
    valid = histogram.dropna()
    if len(valid) < 2:
        return _signal("macd_cross", label, "NEUTRAL", None)

    last_trigger_date = None
    for index in range(1, len(valid)):
        previous = float(valid.iloc[index - 1])
        current = float(valid.iloc[index])
        if (previous <= 0 < current) or (previous >= 0 > current):
            last_trigger_date = _as_date(valid.index[index])

    latest = float(valid.iloc[-1])
    state = "BULLISH" if latest > 0 else "BEARISH" if latest < 0 else "NEUTRAL"
    return _signal("macd_cross", label, state, last_trigger_date, round(latest, 4))


def compute_all_signals(prices: pd.Series) -> list[dict]:
    """Compute the complete, fixed set of supported directional signals."""
    if isinstance(prices, pd.DataFrame):
        prices = prices.iloc[:, 0]
    series = pd.Series(prices).astype(float)
    series = series[~series.index.duplicated(keep="last")]
    return [
        signal_sma_cross(series),
        signal_rsi_threshold(series),
        signal_macd_cross(series),
    ]
