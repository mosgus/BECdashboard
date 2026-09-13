"""The yfinance boundary. Network calls stay thin and untested; every function with logic
in it is pure and tested against captured shapes in tests/fixtures/yf_samples.py — no
network, no database required to verify this module."""

from datetime import date, datetime, timezone

import pandas as pd
import yfinance as yf

from app.cache import _normalize_ohlcv, store, store_fundamentals

# --- network boundary: thin, no logic, not unit-tested ---------------------------------


def _download_history(ticker: str, start: date | None, end: date | None) -> pd.DataFrame:
    return yf.download(
        ticker, start=start, end=end, auto_adjust=False, progress=False, threads=False
    )


def _download_info(ticker: str) -> dict:
    return yf.Ticker(ticker).info


# --- pure: all the logic, fully tested, no network --------------------------------------


def normalize_history(raw: pd.DataFrame) -> pd.DataFrame:
    """Flatten yfinance's MultiIndex columns (present for single-ticker downloads), then
    reuse app.cache's normalizer — the same one store() and _read_from_db() use — so this
    codebase has exactly one place that defines the canonical six-column shape. An empty
    input already comes out with canonical columns and an empty DatetimeIndex; that's
    _normalize_ohlcv's behavior, not special-cased here."""
    df = raw.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return _normalize_ohlcv(df)


def is_valid_symbol(info: dict) -> bool:
    """True when yfinance returned a real security. An invalid symbol does not raise —
    Ticker("NOTAREALTICKER").info returns {'trailingPegRatio': None} — so validity is a key
    check, never a try/except."""
    return info.get("regularMarketPrice") is not None or info.get("shortName") is not None


def extract_fundamentals(ticker: str, info: dict, fetched_at: datetime) -> dict:
    """Maps a yfinance info dict to TickerFundamentals column names. Uses .get() throughout
    — no coercion, no defaulting, no `or 0`. Absent keys (ETF-missing fields, non-payers'
    dividendYield) become None, never a numeric stand-in: a real 0 is a different claim than
    "not reported". regularMarketPrice, not currentPrice — the latter is absent for ETFs.
    dividendYield is already in percent units (0.33 means 0.33%); do not scale it."""
    return {
        "ticker": ticker.upper(),
        "short_name": info.get("shortName"),
        "long_name": info.get("longName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "currency": info.get("currency"),
        "exchange": info.get("exchange"),
        "quote_type": info.get("quoteType"),
        "regular_market_price": info.get("regularMarketPrice"),
        "previous_close": info.get("previousClose"),
        "market_cap": info.get("marketCap"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "dividend_yield": info.get("dividendYield"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
        "beta": info.get("beta"),
        "average_volume": info.get("averageVolume"),
        "fetched_at": fetched_at,
    }


# --- composition: fetch, transform, persist ---------------------------------------------


def fetch_history(ticker: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
    """Download, normalize, and persist price history for ticker. Returns what was fetched."""
    raw = _download_history(ticker, start, end)
    normalized = normalize_history(raw)
    store(ticker, normalized)
    return normalized


def fetch_fundamentals(ticker: str) -> dict:
    """Download, validate, extract, and persist fundamentals for ticker. Returns what was
    fetched. Raises ValueError for an invalid symbol — the message names the ticker, never
    the raw info dict."""
    info = _download_info(ticker)
    if not is_valid_symbol(info):
        raise ValueError(f"Unknown symbol: {ticker}")

    data = extract_fundamentals(ticker, info, datetime.now(timezone.utc))
    store_fundamentals(ticker, data)
    return data
