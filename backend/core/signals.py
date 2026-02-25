"""Signal computation — no look-ahead bias.

Each signal function returns:
  signal:            name string
  params:            indicator parameters used
  state:             current state ("BULLISH" | "BEARISH" | "NEUTRAL" | "OVERBOUGHT" | "OVERSOLD")
  last_trigger_date: ISO date of last crossover/threshold event (or None)
  trigger_values:    dict of indicator values at the trigger bar (or None)
"""
from __future__ import annotations

import pandas as pd

from core.indicators import compute_macd, compute_rsi, compute_sma


def _last_crossover(
    fast: pd.Series, slow: pd.Series
) -> tuple[str | None, dict | None, str]:
    """Scan full series for SMA crossovers.

    Returns (last_trigger_date, trigger_values, current_state).
    No future data ever touches the computation — we only look backward.

    Uses diff-sign change detection so that equal→above (bullish) and
    equal→below (bearish) are both recognised as trigger events.
    """
    valid = fast.dropna().index.intersection(slow.dropna().index)
    if len(valid) < 2:
        return None, None, "NEUTRAL"

    f = fast.loc[valid]
    s = slow.loc[valid]
    diff = f - s  # positive = fast above slow

    last_date: str | None = None
    last_vals: dict | None = None
    last_dir = "NEUTRAL"

    for i in range(1, len(valid)):
        prev_d = float(diff.iloc[i - 1])
        curr_d = float(diff.iloc[i])
        if curr_d > 0 and prev_d <= 0:          # crossed to bullish (includes equal→above)
            last_dir = "BULLISH"
            last_date = str(valid[i].date())
            last_vals = {
                "fast": round(float(f.iloc[i]), 4),
                "slow": round(float(s.iloc[i]), 4),
            }
        elif curr_d < 0 and prev_d >= 0:        # crossed to bearish (includes equal→below)
            last_dir = "BEARISH"
            last_date = str(valid[i].date())
            last_vals = {
                "fast": round(float(f.iloc[i]), 4),
                "slow": round(float(s.iloc[i]), 4),
            }

    # If no crossover ever found, derive state from current relative position
    if last_dir == "NEUTRAL":
        last_dir = "BULLISH" if float(diff.iloc[-1]) > 0 else "BEARISH"

    return last_date, last_vals, last_dir


def signal_sma_cross(
    prices: pd.Series, fast: int = 20, slow: int = 50
) -> dict:
    """SMA fast/slow crossover signal."""
    sma_fast = compute_sma(prices, fast)
    sma_slow = compute_sma(prices, slow)
    last_date, trigger_vals, state = _last_crossover(sma_fast, sma_slow)
    return {
        "signal": "sma_cross",
        "label": f"SMA {fast}/{slow}",
        "params": {"fast": fast, "slow": slow},
        "state": state,
        "last_trigger_date": last_date,
        "trigger_values": trigger_vals,
    }


def signal_rsi_threshold(
    prices: pd.Series, overbought: int = 70, oversold: int = 30
) -> dict:
    """RSI overbought/oversold threshold signal."""
    rsi = compute_rsi(prices).dropna()
    if rsi.empty:
        return {
            "signal": "rsi_threshold",
            "label": "RSI 14",
            "params": {"overbought": overbought, "oversold": oversold},
            "state": "NEUTRAL",
            "last_trigger_date": None,
            "trigger_values": None,
            "current_rsi": None,
        }

    latest_rsi = float(rsi.iloc[-1])
    if latest_rsi >= overbought:
        state = "OVERBOUGHT"
    elif latest_rsi <= oversold:
        state = "OVERSOLD"
    else:
        state = "NEUTRAL"

    last_date: str | None = None
    last_vals: dict | None = None

    # Scan for any threshold crossing (entering or leaving OB/OS zones)
    for i in range(1, len(rsi)):
        prev = float(rsi.iloc[i - 1])
        curr = float(rsi.iloc[i])
        crossed = (
            (prev >= oversold and curr < oversold)   # dropped into oversold
            or (prev < oversold and curr >= oversold)  # rebounded from oversold
            or (prev <= overbought and curr > overbought)  # entered overbought
            or (prev > overbought and curr <= overbought)  # faded from overbought
        )
        if crossed:
            last_date = str(rsi.index[i].date())
            last_vals = {"rsi": round(curr, 2)}

    return {
        "signal": "rsi_threshold",
        "label": "RSI 14",
        "params": {"overbought": overbought, "oversold": oversold},
        "state": state,
        "last_trigger_date": last_date,
        "trigger_values": last_vals,
        "current_rsi": round(latest_rsi, 2),
    }


def signal_macd_cross(prices: pd.Series) -> dict:
    """MACD line / signal line crossover."""
    macd_line, sig_line, histogram = compute_macd(prices)
    valid = histogram.dropna().index

    # EWM with adjust=False produces values even for short series; guard explicitly.
    if len(prices) < 35 or len(valid) < 2:
        return {
            "signal": "macd_cross",
            "label": "MACD (12,26,9)",
            "params": {"fast": 12, "slow": 26, "signal_period": 9},
            "state": "NEUTRAL",
            "last_trigger_date": None,
            "trigger_values": None,
        }

    hist = histogram.loc[valid]
    state = "BULLISH" if float(hist.iloc[-1]) > 0 else "BEARISH"

    last_date: str | None = None
    last_vals: dict | None = None

    for i in range(1, len(valid)):
        prev = float(hist.iloc[i - 1])
        curr = float(hist.iloc[i])
        if (prev <= 0 < curr) or (prev >= 0 > curr):
            last_date = str(valid[i].date())
            last_vals = {
                "macd": round(float(macd_line.loc[valid[i]]), 4),
                "signal": round(float(sig_line.loc[valid[i]]), 4),
                "histogram": round(curr, 4),
            }

    return {
        "signal": "macd_cross",
        "label": "MACD (12,26,9)",
        "params": {"fast": 12, "slow": 26, "signal_period": 9},
        "state": state,
        "last_trigger_date": last_date,
        "trigger_values": last_vals,
    }


def compute_all_signals(prices: pd.Series) -> list[dict]:
    """Compute all three signals. Used by watchlist refresh and ticker endpoints."""
    return [
        signal_sma_cross(prices),
        signal_rsi_threshold(prices),
        signal_macd_cross(prices),
    ]
