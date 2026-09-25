"""Dynamic risk-free rate from the 3-month US Treasury bill yield."""
from __future__ import annotations

import logging
import threading
from typing import Literal

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)
_FALLBACK_RF = 0.0427

RateSource = Literal["live", "fallback"]


def _download_irx() -> pd.DataFrame:
    """Fetch the one-day Treasury-bill frame at the network boundary."""
    return yf.Ticker("^IRX").history(period="1d")


def fetch_risk_free_rate_with_source() -> tuple[float, RateSource]:
    """Return (rate, source). source is "live" for a fresh or cached ^IRX read, "fallback" otherwise."""
    with _lock:
        if "rf" in _cache:
            return _cache["rf"], "live"
    try:
        irx = _download_irx()
        if irx.empty:
            return _FALLBACK_RF, "fallback"
        rate = float(irx["Close"].iloc[-1]) / 100.0
        if not (0.0 <= rate < 0.20):
            return _FALLBACK_RF, "fallback"
        with _lock:
            _cache["rf"] = rate
        return rate, "live"
    except Exception:
        logger.info("Risk-free rate fetch failed; using fallback %.4f", _FALLBACK_RF)
        return _FALLBACK_RF, "fallback"


def fetch_risk_free_rate() -> float:
    """Return the current 3-month Treasury bill yield as a decimal, cached for one hour."""
    return fetch_risk_free_rate_with_source()[0]
