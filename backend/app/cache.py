import pandas as pd
from cachetools import TTLCache

_cache = TTLCache(maxsize=512, ttl=86400)


def get_cached(ticker: str) -> pd.DataFrame | None:
    """Return cached price history for ticker, or None if absent or expired.
    Ticker lookup is case-insensitive; normalize to uppercase internally."""
    key = ticker.upper()
    return _cache.get(key)


def store(ticker: str, df: pd.DataFrame) -> None:
    """Cache price history for ticker. Overwrites any existing entry."""
    key = ticker.upper()
    _cache[key] = df


def clear() -> None:
    """Drop all cached entries. Exists for tests; do not call from app code."""
    _cache.clear()
