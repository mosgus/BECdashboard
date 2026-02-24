"""TTLCache wrapper around yfinance downloads."""
from __future__ import annotations

import threading
from typing import Optional

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

_lock = threading.Lock()
_cache: TTLCache = TTLCache(maxsize=128, ttl=3600)


def _cache_key(tickers: tuple[str, ...], start: str, end: str) -> str:
    return f"{','.join(sorted(tickers))}|{start}|{end}"


def fetch_prices(
    tickers: tuple[str, ...],
    start: str,
    end: str,
) -> Optional[pd.DataFrame]:
    """Download adjusted close prices; returns DataFrame[ticker→price] or None."""
    key = _cache_key(tickers, start, end)
    with _lock:
        if key in _cache:
            return _cache[key]

    try:
        raw = yf.download(
            list(tickers),
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception:
        return None

    if raw.empty:
        return None

    # Multi-ticker → MultiIndex columns; single ticker → flat columns
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"]
    else:
        prices = raw[["Close"]] if "Close" in raw.columns else raw

    if isinstance(prices, pd.Series):
        prices = prices.to_frame(name=tickers[0])

    # Drop fully-NaN columns, forward-fill gaps, drop leading NaN rows
    prices = prices.dropna(axis=1, how="all").ffill().dropna()

    with _lock:
        _cache[key] = prices

    return prices
