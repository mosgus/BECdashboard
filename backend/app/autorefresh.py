"""Visit-triggered universe sweep: at most one full price-history refresh per app/schedule.py
window, claimed by whichever visitor's page load lands inside it first.

Claiming is not a proper distributed lock — two requests landing within the same few
milliseconds could both pass the needs_auto_refresh check before either write commits. Writing
the claim before doing any work (see run_auto_refresh_if_due) narrows that race from the
duration of a full ~20-ticker sweep down to one upsert; it does not eliminate it. A real lock
is out of scope for this contract."""

import logging
import threading
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.jobrun import record_run
from app.market_data import clear_last_session_cache
from app.models import AppState, UniverseTicker
from app.news import run_forced_news_refresh
from app.cache import store_quotes
from app.quotes import fetch_quotes, refresh_quotes_if_stale
from app.schedule import needs_auto_refresh
from app.universe import refresh

logger = logging.getLogger(__name__)

AUTO_REFRESH_KEY = "auto_refresh"
MANUAL_JOB_NAME = "universe_refresh_manual"

# One process, one sweep at a time (contract 0041). This is a threading.Lock, not asyncio.Lock,
# because run_auto_refresh_if_due runs as a sync function in FastAPI's threadpool. It covers a
# single process only; the app_state claim below is what survives a restart and would cover
# multiple workers — the two are complementary, and neither replaces the other.
_LOCK = threading.Lock()


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres
    round-trips it tz-aware. value_at is always written from this module's own now_utc
    argument, itself always UTC, so relabeling a naive read as UTC is a safe relabel, not a
    guess — the same pattern app/cache.py, app/news.py and app/briefing.py use for the same
    reason."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _get_state(key: str) -> datetime | None:
    with session() as db:
        row = db.get(AppState, key)
        return _as_utc(row.value_at) if row is not None else None


def _set_state(key: str, value_at: datetime) -> None:
    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(AppState).values(key=key, value_at=value_at)
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={"value_at": stmt.excluded.value_at})
        db.execute(stmt)


def active_universe_tickers() -> list[str]:
    """One bounded query — the active universe's ticker list. Deliberately does not go
    through app.universe.list_all(): that pulls fundamentals, bars and quotes and triggers its
    own quote fetch, none of which this sweep needs (it does its own, deliberately, at the
    end). Mirrors app/news.py:active_universe_tickers."""
    if not is_enabled():
        return []
    with session() as db:
        return list(
            db.execute(
                select(UniverseTicker.ticker).where(UniverseTicker.active.is_(True))
            ).scalars().all()
        )


def _refresh_tickers(detail: dict) -> list[str]:
    """Refresh each active ticker and fill the common sweep detail fields."""
    tickers = active_universe_tickers()
    errors: list[str] = []
    refreshed = 0
    fundamentals_counts = {"info": 0, "partial": 0, "none": 0, "skipped": 0}
    for ticker in tickers:
        try:
            result = refresh(ticker)
            if result.get("action") != "none":
                refreshed += 1
            outcome = result.get("fundamentals")
            if outcome in fundamentals_counts:
                fundamentals_counts[outcome] += 1
        except Exception:
            # Broad on purpose: one ticker's refresh failing must not abort the sweep for the
            # rest, the same discipline app/news.py's per-ticker fetch loop uses.
            logger.exception("app.autorefresh: refresh(%s) failed; continuing", ticker)
            errors.append(ticker)

    detail["tickers"] = len(tickers)
    detail["refreshed"] = refreshed
    detail["errors"] = errors
    detail["fundamentals"] = fundamentals_counts
    return tickers


def try_begin_manual_refresh() -> bool:
    """Try to own the process sweep lock.

    The request thread acquires this threading.Lock and the background-task thread releases
    it in run_manual_refresh; unlike RLock, threading.Lock permits that handoff.
    """
    return _LOCK.acquire(blocking=False)


def is_sweep_active(now_et: datetime) -> bool:
    """Whether a sweep is running or an unclaimed window is about to start one.

    The due-window term covers the short interval after /universe/strip schedules its task but
    before that task acquires _LOCK, so a page cannot miss a sweep it should watch.
    """
    if not is_enabled():
        return False
    return _LOCK.locked() or needs_auto_refresh(_get_state(AUTO_REFRESH_KEY), now_et)


def run_auto_refresh_if_due(now_utc: datetime, now_et: datetime) -> None:
    """The impure composition: read the last claim, consult needs_auto_refresh, and only then
    do any work. No-op with no database configured, or when another sweep is already running in
    this process (see _LOCK above) — both checked before any read or write.

    Tickers are walked one at a time, in a plain loop, through app.universe.refresh — the same
    function POST /{ticker}/refresh uses. No concurrent fan-out of any kind (contract 0013). A
    failure on one ticker is caught and logged, not raised; the sweep continues with the rest.

    The claim is written before the sweep runs, not after — see module docstring — and it is
    never rolled back on failure: a window that errored waits for the next window rather than
    being retried by the next visitor thirty seconds later, which is how a failing sweep turns
    into a rate limit.

    A run is recorded (contract 0044) only once the claim above is written — i.e. only for a
    sweep that actually runs. GET /universe/strip fires on every page load, and this function
    returns early whenever the window is already claimed; recording before that gate would
    write a job_runs row per page view instead of per window."""
    if not _LOCK.acquire(blocking=False):
        return  # another visitor's sweep is already running in this process

    try:
        if not is_enabled():
            return

        last_refreshed_at = _get_state(AUTO_REFRESH_KEY)
        if not needs_auto_refresh(last_refreshed_at, now_et):
            return

        _set_state(AUTO_REFRESH_KEY, now_utc)

        with record_run("universe_refresh", now_utc) as detail:
            tickers = _refresh_tickers(detail)
            refresh_quotes_if_stale(tickers)
    finally:
        _LOCK.release()


def run_manual_refresh(now_utc: datetime, now_et: datetime) -> None:
    """Refresh news and the briefing first, then run a manual universe sweep while the caller-owned _LOCK is held."""
    try:
        if not is_enabled():
            return

        try:
            run_forced_news_refresh(now_utc, now_et)
        except Exception:
            # Broad on purpose: news and the briefing are extras on a manual update; they must never
            # stop the price sweep or leave _LOCK held.
            logger.exception("app.autorefresh: forced news refresh failed; continuing with the sweep")

        clear_last_session_cache()
        if needs_auto_refresh(_get_state(AUTO_REFRESH_KEY), now_et):
            _set_state(AUTO_REFRESH_KEY, now_utc)

        with record_run(MANUAL_JOB_NAME, now_utc) as detail:
            tickers = _refresh_tickers(detail)
            quotes = fetch_quotes(tickers)
            if quotes:
                store_quotes(quotes, now_utc)
            detail["quotes"] = len(quotes)
    finally:
        _LOCK.release()
