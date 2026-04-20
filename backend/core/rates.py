"""Dynamic risk-free rate from 10-Year US Treasury yield.

Fetches the current ^TNX value from yfinance, cached for 1 hour.
Falls back to 4.27% if fetch fails.
"""
from __future__ import annotations

import threading

import logging

import yfinance as yf
from cachetools import TTLCache

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)
_FALLBACK_RF = 0.0427


def fetch_risk_free_rate() -> float:
    """Return the current 10-Year Treasury yield as a decimal (e.g. 0.0425).

    Cached for 1 hour. Falls back to 4.27% on any failure.
    """
    with _lock:
        if "rf" in _cache:
            return _cache["rf"]

    try:
        tnx = yf.Ticker("^TNX").history(period="1d")
        if tnx.empty:
            return _FALLBACK_RF
        rate = float(tnx["Close"].iloc[-1]) / 100.0
        if not (0.001 < rate < 0.20):  # sanity check
            return _FALLBACK_RF
        with _lock:
            _cache["rf"] = rate
        return rate
    except Exception:
        logger.info("Risk-free rate fetch failed; using fallback %.4f", _FALLBACK_RF)
        return _FALLBACK_RF
