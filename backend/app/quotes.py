"""Live intraday quotes, refreshed lazily on request rather than on a schedule — Render's
free tier sleeps after ~15 minutes idle, so a background job would die with it, and refreshing
only when someone actually asks costs nothing when nobody is looking. `is_market_open` and
`needs_refresh` are pure — time comes in as arguments, never from the clock, the same
discipline as freshness.py. The one impure function, refresh_quotes_if_stale, is where the
real clock and the network call live.

Gated on an app_state claim (contract 0051), not on MAX(fetched_at) over ticker_quotes rows —
a ticker with no quote row at all contributes nothing to a MAX, so adding one could never make
the batch look stale and the new ticker was skipped until every other ticker's TTL lapsed too.
The claim is about the batch, not the rows, so a brand-new ticker is no longer invisible to
the check."""

import threading
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.cache import store_quotes
from app.models import AppState

QUOTE_TTL_MINUTES = 10
MARKET_OPEN_ET = time(9, 30)
MARKET_CLOSE_ET = time(16, 0)

QUOTE_ATTEMPT_KEY = "quote_refresh_attempt"

# One process, one quote refresh at a time — the same non-blocking, claim-first pattern
# app/autorefresh.py uses, for the same reason: two requests arriving milliseconds apart must
# not both pass the needs_refresh check and both fetch. A separate lock from autorefresh's own
# — a running universe sweep must not block a quote refresh, and vice versa.
_LOCK = threading.Lock()


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


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres
    round-trips it tz-aware. value_at is always written from this module's own now_utc
    argument, itself always UTC, so relabeling a naive read as UTC is a safe relabel, not a
    guess — the same pattern app/autorefresh.py, app/news.py and app/cache.py use for the
    same reason."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _get_quote_attempt() -> datetime | None:
    with session() as db:
        row = db.get(AppState, QUOTE_ATTEMPT_KEY)
        return _as_utc(row.value_at) if row is not None else None


def _set_quote_attempt(value_at: datetime) -> None:
    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(AppState).values(key=QUOTE_ATTEMPT_KEY, value_at=value_at)
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value_at": stmt.excluded.value_at})
        db.execute(stmt)


def refresh_quotes_if_stale(tickers: list[str]) -> None:
    """The impure composition: read the last refresh *attempt*, consult needs_refresh, claim
    before fetching, and upsert only if stale. No-op with no database configured, or when
    another quote refresh is already running in this process (see _LOCK above) — both checked
    before any read or write, so a degraded deployment never makes the network call at all.

    The claim is written before the fetch, not after — same reasoning as
    autorefresh.run_auto_refresh_if_due: this narrows, but does not eliminate, the race between
    two visitors landing in the same TTL window, and an attempt that fetched nothing still
    claims the window so an unquotable ticker can fire at most one attempt per TTL, not one per
    page load. The only place in this module that reads the real clock."""
    if not _LOCK.acquire(blocking=False):
        return  # another visitor's quote refresh is already running in this process

    try:
        if not is_enabled() or not tickers:
            return

        now_utc = datetime.now(timezone.utc)
        now_et = datetime.now(ZoneInfo("America/New_York"))
        last_attempt = _get_quote_attempt()

        if not needs_refresh(last_attempt, now_utc, now_et):
            return

        _set_quote_attempt(now_utc)

        quotes = fetch_quotes(tickers)
        if quotes:
            store_quotes(quotes, now_utc)
    finally:
        _LOCK.release()
