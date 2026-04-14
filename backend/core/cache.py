"""TTLCache wrapper around yfinance downloads, plus DB-backed hybrid fetch."""
from __future__ import annotations

import threading
from datetime import date, datetime, timedelta
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


# ── Hybrid: DB first, yfinance fallback ──────────────────────────────────────

def fetch_prices_hybrid(
    tickers: tuple[str, ...],
    start: str,
    end: str,
) -> Optional[pd.DataFrame]:
    """Read adjusted close prices from price_history table, fall back to yfinance
    for missing tickers or date ranges. Auto-backfills missing data into the DB.

    Returns DataFrame[date x ticker] matching the fetch_prices() interface.
    Falls back to the legacy yfinance-only fetch_prices() if the DB is unavailable.
    """
    try:
        from db.base import SessionLocal
        from core.price_loader import (
            read_price_bars,
            fetch_ohlcv,
            df_to_records,
            upsert_price_bars,
            get_price_coverage,
        )
    except Exception:
        return fetch_prices(tickers, start, end)

    tickers = tuple(sorted(set(tickers)))
    start_d = date.fromisoformat(start[:10])
    end_d = date.fromisoformat(end[:10])

    db = SessionLocal()
    try:
        # Step 1: check coverage per ticker; fetch missing ranges from yfinance
        for t in tickers:
            min_d, max_d = get_price_coverage(db, t)
            missing_ranges: list[tuple[date, date]] = []
            if min_d is None:
                # No data at all
                missing_ranges.append((start_d, end_d))
            else:
                if start_d < min_d:
                    missing_ranges.append((start_d, min_d - timedelta(days=1)))
                if end_d > max_d:
                    missing_ranges.append((max_d + timedelta(days=1), end_d))

            for r_start, r_end in missing_ranges:
                if r_start > r_end:
                    continue
                ohlcv_map = fetch_ohlcv([t], r_start.isoformat(), (r_end + timedelta(days=1)).isoformat())
                if t in ohlcv_map:
                    records = df_to_records(t, ohlcv_map[t])
                    if records:
                        upsert_price_bars(db, records)

        # Step 2: read the (now complete) range from DB
        prices = read_price_bars(db, list(tickers), start, end)
        if prices is None or prices.empty:
            # DB still empty after fetch attempt — fall back to legacy path
            return fetch_prices(tickers, start, end)

        # Drop fully-NaN columns, forward-fill gaps, drop leading NaN rows
        prices = prices.dropna(axis=1, how="all").ffill().dropna()
        if prices.empty:
            return fetch_prices(tickers, start, end)
        return prices
    except Exception:
        return fetch_prices(tickers, start, end)
    finally:
        db.close()
