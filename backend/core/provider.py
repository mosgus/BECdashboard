"""Market data provider — OHLCV access with TTL caching.

YFinanceProvider.get_ohlcv() returns a DataFrame with columns:
  open, high, low, close, volume

The existing fetch_prices() in core.cache (adjusted close only) is kept
untouched for backward compatibility with existing endpoints.
"""
from __future__ import annotations

import threading
from typing import Optional

import logging

import pandas as pd
import yfinance as yf
from cachetools import TTLCache

logger = logging.getLogger(__name__)

_ohlcv_lock = threading.Lock()
_ohlcv_cache: TTLCache = TTLCache(maxsize=256, ttl=3600)


class YFinanceProvider:
    """Thin wrapper around yfinance with in-memory TTL caching."""

    def get_ohlcv(
        self, ticker: str, start: str, end: str
    ) -> Optional[pd.DataFrame]:
        """Download OHLCV bars for a single ticker.

        Returns a DataFrame indexed by date with columns:
          open, high, low, close, volume
        Returns None on error or no data.
        """
        key = f"ohlcv:{ticker}:{start}:{end}"
        with _ohlcv_lock:
            if key in _ohlcv_cache:
                return _ohlcv_cache[key]

        try:
            raw = yf.download(
                ticker,
                start=start,
                end=end,
                auto_adjust=True,
                progress=False,
                threads=False,
            )
        except Exception:
            logger.warning("OHLCV download failed", exc_info=True)
            return None

        if raw is None or raw.empty:
            return None

        # Flatten MultiIndex columns (yfinance can wrap single-ticker in MultiIndex)
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)

        raw.columns = [str(c).lower() for c in raw.columns]

        needed = {"open", "high", "low", "close", "volume"}
        if not needed.issubset(set(raw.columns)):
            return None

        df = raw[list(needed)].copy().ffill().dropna()

        with _ohlcv_lock:
            _ohlcv_cache[key] = df

        return df

    def validate_ticker(self, ticker: str) -> bool:
        """Non-blocking check: return True if yfinance returns any recent bar."""
        try:
            raw = yf.download(
                ticker,
                period="5d",
                auto_adjust=True,
                progress=False,
                threads=False,
            )
            return raw is not None and not raw.empty
        except Exception:
            logger.debug("Ticker validation failed for %s", ticker)
            return False


# Module-level singleton — import and use directly
provider = YFinanceProvider()
