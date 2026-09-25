"""Dynamic risk-free rate from 10-Year US Treasury yield."""
from __future__ import annotations

import logging
import threading

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)
_FALLBACK_RF = 0.0427


def _download_tnx() -> pd.DataFrame:
    """Fetch the one-day Treasury-yield frame at the network boundary."""
    return yf.Ticker("^TNX").history(period="1d")


def fetch_risk_free_rate() -> float:
    """Return the current 10-Year Treasury yield as a decimal, cached for one hour."""
    with _lock:
        if "rf" in _cache:
            return _cache["rf"]
    try:
        tnx = _download_tnx()
        if tnx.empty:
            return _FALLBACK_RF
        rate = float(tnx["Close"].iloc[-1]) / 100.0
        if not (0.001 < rate < 0.20):
            return _FALLBACK_RF
        with _lock:
            _cache["rf"] = rate
        return rate
    except Exception:
        logger.info("Risk-free rate fetch failed; using fallback %.4f", _FALLBACK_RF)
        return _FALLBACK_RF
