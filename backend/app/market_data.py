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
    earliest_session_on_or_after,
    is_stale,
    last_completed_session,
    missing_range,
    pick_drift_anchors,
    prepend_range,
)

# REBUILD.md: the reference ticker's last completed session "changes once a day" and should
# be cached briefly. Keyed on (ET date, whether it's past 16:00) rather than plain TTL alone,
# so the moment 16:00 ET passes, the next call re-derives immediately instead of serving a
# pre-4pm answer for up to an hour afterward. Refreshing N tickers costs one SPY fetch per
# key, not N — this is what makes a bulk "update all" not hammer Yahoo with a duplicate
# request per ticker.
_last_session_cache: TTLCache = TTLCache(maxsize=8, ttl=3600)

# The earliest real trading session on or after a given HISTORY_START never changes once
# computed, unlike last_completed_session — so this is cached far longer (a day) and keyed on
# history_start itself rather than on the current date. Refreshing N tickers against the same
# HISTORY_START costs one narrow reference-ticker fetch, not N.
_earliest_session_cache: TTLCache = TTLCache(maxsize=8, ttl=86400)


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


def _download_chart_meta(ticker: str) -> dict:
    return yf.Ticker(ticker).get_history_metadata()


def _download_search_quotes(ticker: str) -> list[dict]:
    return yf.Search(ticker).quotes


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


def fetch_chart_meta(ticker: str) -> dict | None:
    """Tier 1, crumb-free. yf.Ticker(t).get_history_metadata() — the chart endpoint, the same
    one yf.download already uses for bars and quotes, so this works from Render's IP where
    .info 401s (contract 0013). Returns TickerFundamentals-shaped keys, or None on any failure
    — including the shape an invalid symbol returns, which is a near-empty dict rather than a
    raised exception, so validity is checked the same way is_valid_symbol already does for
    `.info`: both dicts use the exact key names regularMarketPrice/shortName."""
    try:
        meta = _download_chart_meta(ticker)
    except (YFException, CurlRequestException):
        return None

    if not is_valid_symbol(meta):
        return None

    return {
        "short_name": meta.get("shortName"),
        "long_name": meta.get("longName"),
        "quote_type": meta.get("instrumentType"),
        "currency": meta.get("currency"),
        "exchange": meta.get("exchangeName"),
        "regular_market_price": meta.get("regularMarketPrice"),
        "previous_close": meta.get("chartPreviousClose"),
        "fifty_two_week_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": meta.get("fiftyTwoWeekLow"),
    }


def fetch_search_profile(ticker: str) -> dict | None:
    """Tier 2, crumb-free. yf.Search(ticker).quotes — sector and industry for equities. ETFs
    legitimately carry neither. Returns None on failure or when no quote's symbol matches
    ticker exactly (case-insensitively) — a search for PBR returns PBR-A second, and blindly
    taking quotes[0] would eventually write one company's sector onto another's row."""
    try:
        quotes = _download_search_quotes(ticker)
    except (YFException, CurlRequestException):
        return None

    ticker_upper = ticker.upper()
    for quote in quotes:
        symbol = quote.get("symbol")
        if isinstance(symbol, str) and symbol.upper() == ticker_upper:
            return {
                "sector": quote.get("sector"),
                "industry": quote.get("industry"),
            }

    return None


def fetch_fundamentals(ticker: str) -> dict | None:
    """Best-effort enrichment, never a gate — price history remains the sole authority on
    whether a ticker exists (symbol_has_history). Returns the merged row, or None when every
    tier failed. Never raises.

    `.info` is tried first and, if it succeeds and looks like a real quote, is authoritative:
    the full row is written exactly as before, overwriting every column — a non-payer really
    can stop paying a dividend, and only an authoritative source is allowed to record that.
    Nothing below runs in that case, so the 22 rows already populated from a laptop where the
    crumb works keep behaving identically.

    When `.info` fails or doesn't validate (the crumb/401 failure from Render's IP that
    motivated this contract), tiers 1 and 2 run instead. If both fail, nothing is written —
    the genuinely-unreachable case, preserved. Otherwise what came back is merged (tier 2 over
    tier 1 for the one overlapping concern, sector/industry) and written as a **partial**:
    never overwriting a non-null stored value with None (see cache.store_fundamentals)."""
    info = None
    try:
        candidate = _download_info(ticker)
        if is_valid_symbol(candidate):
            info = candidate
    except (YFException, CurlRequestException):
        pass

    if info is not None:
        data = extract_fundamentals(ticker, info, datetime.now(timezone.utc))
        store_fundamentals(ticker, data)
        return data

    chart_meta = fetch_chart_meta(ticker)
    search_profile = fetch_search_profile(ticker)

    if chart_meta is None and search_profile is None:
        return None

    merged: dict = {}
    if chart_meta is not None:
        merged.update(chart_meta)
    if search_profile is not None:
        merged.update(search_profile)

    data = {"ticker": ticker.upper(), **merged, "fetched_at": datetime.now(timezone.utc)}
    store_fundamentals(ticker, data, partial=True)
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


def _cached_earliest_session(history_start: date) -> date | None:
    """earliest_session_on_or_after, behind a TTL cache keyed on history_start alone — the
    answer never changes once computed, so refreshing N tickers against the same
    HISTORY_START costs one narrow reference-ticker fetch, not N.

    The window is deliberately narrow — history_start to history_start + 30 days, not full
    history — this is a probe for one date, not a data fetch."""
    if history_start in _earliest_session_cache:
        return _earliest_session_cache[history_start]

    window_end = history_start + timedelta(days=30)
    reference_raw = _download_history(REFERENCE_TICKER, history_start, window_end)
    reference_bars = normalize_history(reference_raw)
    result = earliest_session_on_or_after(history_start, reference_bars)

    _earliest_session_cache[history_start] = result
    return result


def refresh_ticker(ticker: str, force: bool = False, history_start: date | None = None) -> dict:
    """Bring a ticker's stored history up to the last completed session, repairing it if a
    split or dividend has restated it, then (when history_start is given) extend it
    backwards to history_start's earliest real session too. Returns a summary of what
    happened.

    Order matters: session derivation costs at most one reference-ticker fetch per
    (ET date, past-4pm) key — see _cached_last_session — and nothing past that happens
    unless the ticker is actually stale or force is set. That idempotence is what makes
    repeated calls on an already-current ticker free, and refreshing many tickers in one
    pass cost one reference fetch rather than one per ticker.

    The backward extension runs after the forward path unconditionally (history_start is not
    None) — including when the forward path was a no-op. A ticker can be current at the
    front and short at the back. history_start=None (the default) skips this entirely, so
    every existing caller keeps its current behaviour unchanged."""
    ticker_upper = ticker.upper()
    stored = get_cached(ticker)
    bars_before = 0 if stored is None else len(stored)

    def summary(
        action: str,
        last_session: date | None,
        bars_after: int,
        drift_detected: bool,
        bars_prepended: int = 0,
    ) -> dict:
        return {
            "ticker": ticker_upper,
            "action": action,
            "last_session": last_session,
            "bars_before": bars_before,
            "bars_after": bars_after,
            "drift_detected": drift_detected,
            "bars_prepended": bars_prepended,
        }

    now_et = _now_et()
    last_session = _cached_last_session(now_et.date(), now_et.hour)

    if last_session is None:
        result = summary("unknown_session", None, bars_before, False)
    elif not is_stale(stored, last_session) and not force:
        result = summary("none", last_session, bars_before, False)
    else:
        fetch_range = missing_range(stored, last_session)
        if fetch_range is None and (stored is None or stored.empty or not force):
            # Nothing missing, and either there's no existing series to re-check (a first
            # fetch is the caller's job, not a repair here) or force wasn't set.
            result = summary("none", last_session, bars_before, False)
        else:
            if fetch_range is None:
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
                result = summary("refetched", last_session, len(full_fresh), True)
            else:
                combined = pd.concat([stored, fresh])
                combined = combined[~combined.index.duplicated(keep="last")].sort_index()
                store(ticker, combined)
                result = summary("appended", last_session, len(combined), False)

    if history_start is not None:
        earliest_session = _cached_earliest_session(history_start)
        if earliest_session is not None:
            current_stored = get_cached(ticker)
            prepend = prepend_range(current_stored, earliest_session)
            if prepend is not None:
                prepend_start, prepend_end = prepend
                prepend_raw = _download_history(ticker, prepend_start, prepend_end)
                prepend_fresh = normalize_history(prepend_raw)
                if not prepend_fresh.empty:
                    # Concatenate with the CURRENT frame, never store() the prepended chunk
                    # alone — that would replace the TTL cache entry with just those bars.
                    merged = pd.concat([prepend_fresh, current_stored])
                    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
                    store(ticker, merged)
                    result["bars_prepended"] = len(prepend_fresh)
                    result["bars_after"] = len(merged)

    return result
