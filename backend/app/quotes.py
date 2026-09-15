"""Live intraday quotes, refreshed lazily on request rather than on a schedule — Render's
free tier sleeps after ~15 minutes idle, so a background job would die with it, and refreshing
only when someone actually asks costs nothing when nobody is looking. `is_market_open` and
`needs_refresh` are pure — time comes in as arguments, never from the clock, the same
discipline as freshness.py. The one impure function, refresh_quotes_if_stale, is where the
real clock and the network call live."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

from app.cache import get_newest_quote_fetched_at, store_quotes
from app.db import is_enabled

QUOTE_TTL_MINUTES = 10
MARKET_OPEN_ET = time(9, 30)
MARKET_CLOSE_ET = time(16, 0)


def is_market_open(now_et: datetime) -> bool:
    """Monday-Friday, MARKET_OPEN_ET <= t < MARKET_CLOSE_ET, evaluated against whatever moment
    the caller passes as "now in ET" — this function never looks at the clock itself.

    Holidays and early closes are deliberately not handled: detecting them needs a calendar
    dependency (REBUILD.md rejects pandas_market_calendars) or another probe request. The cost
    of ignoring them is at most one wasted batch request per TTL window on roughly nine days a
    year, and only if someone loads the page then."""
    if now_et.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return MARKET_OPEN_ET <= now_et.time() < MARKET_CLOSE_ET


def needs_refresh(newest_fetched_at: datetime | None, now_utc: datetime, now_et: datetime) -> bool:
    """True only when the market is open and the stored quote is missing or older than
    QUOTE_TTL_MINUTES. Outside market hours this is always False, by design — after the
    close, the Price column shows the most recent close instead of a stale intraday quote."""
    if not is_market_open(now_et):
        return False
    if newest_fetched_at is None:
        return True
    return now_utc - newest_fetched_at > timedelta(minutes=QUOTE_TTL_MINUTES)


def _download_quotes(tickers: list[str]) -> pd.DataFrame:
    """The one network call: a single batched request for the whole list, using the chart
    endpoint via period/interval rather than start/end — crumb-free, unlike .info, which is
    what fails from Render's IP (contract 0013)."""
    return yf.download(
        tickers, period="1d", interval="1m", auto_adjust=False, progress=False, threads=False
    )


def fetch_quotes(tickers: list[str]) -> dict[str, tuple[float, datetime]]:
    """Exactly one yf.download call for the whole list — never a loop. Takes the last
    non-null close per ticker and its timestamp; a ticker absent from the response, or with
    no non-null close in today's minute bars, is simply omitted from the dict, not an error."""
    if not tickers:
        return {}

    raw = _download_quotes(tickers)
    if raw.empty:
        return {}

    is_multi = isinstance(raw.columns, pd.MultiIndex)

    quotes: dict[str, tuple[float, datetime]] = {}
    for ticker in tickers:
        key = ticker.upper()
        try:
            closes = raw[("Close", ticker)] if is_multi else raw["Close"]
        except KeyError:
            continue

        non_null = closes.dropna()
        if non_null.empty:
            continue

        timestamp = non_null.index[-1]
        as_of = timestamp.to_pydatetime() if hasattr(timestamp, "to_pydatetime") else timestamp
        quotes[key] = (float(non_null.iloc[-1]), as_of)

    return quotes


def refresh_quotes_if_stale(tickers: list[str]) -> None:
    """The impure composition: read the newest fetched_at, consult needs_refresh, fetch and
    upsert only if stale. No-op with no database configured — and that check happens before
    any fetch is attempted, not just before the write, so a degraded deployment never makes
    the network call at all. The only place in this module that reads the real clock."""
    if not is_enabled() or not tickers:
        return

    now_utc = datetime.now(timezone.utc)
    now_et = datetime.now(ZoneInfo("America/New_York"))
    newest_fetched_at = get_newest_quote_fetched_at(tickers)

    if not needs_refresh(newest_fetched_at, now_utc, now_et):
        return

    quotes = fetch_quotes(tickers)
    if quotes:
        store_quotes(quotes, now_utc)
