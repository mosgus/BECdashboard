"""The yfinance boundary. Network calls stay thin and untested; every function with logic
in it is pure and tested against captured shapes in tests/fixtures/yf_samples.py — no
network, no database required to verify this module."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf
from cachetools import TTLCache
from curl_cffi.requests.exceptions import RequestException as CurlRequestException
from yfinance.exceptions import YFException

from app.cache import _normalize_ohlcv, get_cached, store, store_fundamentals
from app.freshness import (
    REFERENCE_TICKER,
    detect_drift,
    is_stale,
    last_completed_session,
    missing_range,
    pick_drift_anchors,
)

# REBUILD.md: the reference ticker's last completed session "changes once a day" and should
# be cached briefly. Keyed on (ET date, whether it's past 16:00) rather than plain TTL alone,
# so the moment 16:00 ET passes, the next call re-derives immediately instead of serving a
# pre-4pm answer for up to an hour afterward. Refreshing N tickers costs one SPY fetch per
# key, not N — this is what makes a bulk "update all" not hammer Yahoo with a duplicate
# request per ticker.
_last_session_cache: TTLCache = TTLCache(maxsize=8, ttl=3600)


class UpstreamUnavailable(RuntimeError):
    """Yahoo was reachable but refused the request — not a statement about the symbol.

    Raised only where "we couldn't tell" must not be silently treated as "confirmed no" —
    see symbol_has_history. fetch_fundamentals never raises this: fundamentals are
    best-effort enrichment, so any failure there degrades to None instead."""


# --- network boundary: thin, no logic, not unit-tested ---------------------------------


def _download_history(ticker: str, start: date | None, end: date | None) -> pd.DataFrame:
    """Download historical price data from yfinance.

    `end` is INCLUSIVE here. yfinance's end is exclusive, so one day is added before calling
    yfinance. Every other date in this codebase is inclusive; this function is the only place
    that converts."""
    yf_end = end + timedelta(days=1) if end is not None else None
    return yf.download(
        ticker, start=start, end=yf_end, auto_adjust=False, progress=False, threads=False
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


def symbol_has_history(ticker: str) -> bool:
    """True when yf.download returns at least one bar in a short recent window. The
    crumb-free existence check: the chart endpoint behind yf.download doesn't need the
    crumb token that quoteSummary (behind .info) does, so this keeps working even when
    Yahoo's crumb handshake is failing (see fetch_fundamentals).

    A short window (~10 days), not ten years — this is an existence probe that runs before
    the expensive full-history fetch, not the fetch itself.

    Raises UpstreamUnavailable if the download itself fails outright (network/HTTP error).
    That is deliberately not the same as returning False: a failed request means we don't
    know whether the symbol exists, not that it doesn't — collapsing the two would reject
    real tickers during exactly the kind of outage this contract exists to tolerate."""
    end = date.today()
    start = end - timedelta(days=10)
    try:
        raw = _download_history(ticker, start, end)
    except (YFException, CurlRequestException) as exc:
        raise UpstreamUnavailable(f"Could not check price history for {ticker}") from exc
    return not raw.empty


def fetch_history(ticker: str, start: date | None = None, end: date | None = None) -> pd.DataFrame:
    """Download, normalize, and persist price history for ticker. Returns what was fetched."""
    raw = _download_history(ticker, start, end)
    normalized = normalize_history(raw)
    store(ticker, normalized)
    return normalized


def fetch_fundamentals(ticker: str) -> dict | None:
    """Download, validate, extract, and persist fundamentals for ticker. Returns None when
    Yahoo refuses the request (e.g. the crumb/401 failure that motivated this contract) or
    the response doesn't look like a real quote — never raises. Fundamentals are best-effort
    enrichment, not a gate: price history (symbol_has_history) is the sole authority on
    whether a ticker exists. Nothing is written when this returns None — persisting a row of
    all-nulls would be indistinguishable from a real ETF's genuinely-absent fields."""
    try:
        info = _download_info(ticker)
    except (YFException, CurlRequestException):
        return None

    if not is_valid_symbol(info):
        return None

    data = extract_fundamentals(ticker, info, datetime.now(timezone.utc))
    store_fundamentals(ticker, data)
    return data


def _now_et() -> datetime:
    """The one place this module calls datetime.now() — freshness.py's functions are pure
    and take today/now_et_hour as arguments precisely so this doesn't have to live there."""
    return datetime.now(ZoneInfo("America/New_York"))


def _cached_last_session(today: date, now_et_hour: int) -> date | None:
    """last_completed_session, behind a TTL cache keyed on (today, past 4pm ET) so refreshing
    N tickers in the same hour-ish window costs one reference-ticker download, not N."""
    key = (today, now_et_hour >= 16)
    if key in _last_session_cache:
        return _last_session_cache[key]

    reference_raw = _download_history(REFERENCE_TICKER, None, None)
    reference_bars = normalize_history(reference_raw)
    result = last_completed_session(today, now_et_hour, reference_bars)

    _last_session_cache[key] = result
    return result


def refresh_ticker(ticker: str, force: bool = False) -> dict:
    """Bring a ticker's stored history up to the last completed session, repairing it if a
    split or dividend has restated it. Returns a summary of what happened.

    Order matters: session derivation costs at most one reference-ticker fetch per
    (ET date, past-4pm) key — see _cached_last_session — and nothing past that happens
    unless the ticker is actually stale or force is set. That idempotence is what makes
    repeated calls on an already-current ticker free, and refreshing many tickers in one
    pass cost one reference fetch rather than one per ticker."""
    ticker_upper = ticker.upper()
    stored = get_cached(ticker)
    bars_before = 0 if stored is None else len(stored)

    def summary(action: str, last_session: date | None, bars_after: int, drift_detected: bool) -> dict:
        return {
            "ticker": ticker_upper,
            "action": action,
            "last_session": last_session,
            "bars_before": bars_before,
            "bars_after": bars_after,
            "drift_detected": drift_detected,
        }

    now_et = _now_et()
    last_session = _cached_last_session(now_et.date(), now_et.hour)

    if last_session is None:
        return summary("unknown_session", None, bars_before, False)

    if not is_stale(stored, last_session) and not force:
        return summary("none", last_session, bars_before, False)

    fetch_range = missing_range(stored, last_session)
    if fetch_range is None:
        if stored is None or stored.empty or not force:
            # Nothing missing, and either there's no existing series to re-check (a first
            # fetch is the caller's job, not a repair here) or force wasn't set.
            return summary("none", last_session, bars_before, False)
        # force=True on already-current data: still re-check the most recent stored bar.
        fetch_range = (stored.index.max().date(), last_session)

    start, end = fetch_range
    raw = _download_history(ticker, start, end)
    fresh = normalize_history(raw)

    anchors = pick_drift_anchors(stored)
    drift = detect_drift(stored, fresh, anchors)

    if drift:
        full_start = stored.index.min().date()
        full_raw = _download_history(ticker, full_start, last_session)
        full_fresh = normalize_history(full_raw)
        store(ticker, full_fresh)
        return summary("refetched", last_session, len(full_fresh), True)

    combined = pd.concat([stored, fresh])
    combined = combined[~combined.index.duplicated(keep="last")].sort_index()
    store(ticker, combined)
    return summary("appended", last_session, len(combined), False)
