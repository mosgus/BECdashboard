"""Keeps stored price history correct over time. Every function here is pure — no network,
no database, no datetime.now() — so `today` and `now_et_hour` are arguments, not computed
internally. The impure wrapper (deriving the real current moment, calling yfinance) lives in
app/market_data.py:refresh_ticker.

Two failure modes, both silent:
- Forward staleness: the newest stored bar predates the last completed session.
  last_completed_session + is_stale handle it, and the check is idempotent — a fresh ticker
  is never refetched.
- Retroactive restatement: a split or dividend rewrites adj_close for every date before its
  ex-date. The freshness rule cannot see this — it only looks forward. pick_drift_anchors +
  detect_drift catch it by comparing stored adj_close against a fresh re-fetch.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd

REFERENCE_TICKER = "SPY"
DRIFT_TOLERANCE = 1e-6


def _to_date(value) -> date:
    return value.date() if hasattr(value, "date") else value


def last_completed_session(
    today: date, now_et_hour: int, reference_bars: pd.DataFrame
) -> date | None:
    """The newest bar date in reference_bars, excluding today unless now_et_hour >= 16.

    The reference ticker's own bar dates are the set of real trading sessions — weekends and
    market holidays fall out for free, with no calendar dependency. The 16:00 ET cutoff
    exists because yfinance returns a partial in-progress bar during market hours; treating
    it as complete would freeze an incomplete close permanently. Any bar dated after the
    cutoff (including a stray future-dated row) is excluded the same way today's bar is
    before 16:00 — this is what keeps a holiday gap from being read as "the holiday itself
    is the last session" when a later bar happens to already be in the frame.
    """
    if reference_bars is None or reference_bars.empty:
        return None

    cutoff = today if now_et_hour >= 16 else today - timedelta(days=1)
    bar_dates = [_to_date(idx) for idx in reference_bars.index]
    eligible = [d for d in bar_dates if d <= cutoff]

    if not eligible:
        return None
    return max(eligible)


def is_stale(stored: pd.DataFrame | None, last_session: date) -> bool:
    """True when stored is None, empty, or its newest bar predates last_session. Never True
    when the newest stored bar is equal to or later than last_session — that property is
    what makes repeated updates no-ops."""
    if stored is None or stored.empty:
        return True
    newest = _to_date(stored.index.max())
    return newest < last_session


def pick_drift_anchors(stored: pd.DataFrame) -> list[date]:
    """Up to three dates from the stored index: first, middle, most recent. Fewer for a
    shorter series, [] for empty, never duplicates.

    Three rather than one because a dividend or split restates only prices before its
    ex-date — the most recent stored bar is usually on the far side of that boundary and
    would show no drift at all even after a split, while an anchor from earlier in the
    series will. One near the start alone tells you nothing about whether anything recent
    happened. Three anchors cost nothing extra when they fall inside a fetch already being
    made; they only require a dedicated request when they don't."""
    if stored is None or stored.empty:
        return []

    dates = [_to_date(idx) for idx in stored.index]
    n = len(dates)
    candidates = [dates[0], dates[n // 2], dates[-1]]

    anchors: list[date] = []
    for candidate in candidates:
        if candidate not in anchors:
            anchors.append(candidate)
    return anchors


def detect_drift(stored: pd.DataFrame, fresh: pd.DataFrame, anchors: list[date]) -> bool:
    """True when stored and fresh adj_close disagree on any anchor date present in both.

    Compares adj_close only — raw close is the invariant; a change there is genuine data
    corruption, not a corporate action, and is out of scope here (report it, don't repair
    it). Anchors absent from either frame are skipped, not treated as drift: this function
    only ever sees whatever range the caller happened to fetch, and an anchor outside that
    range isn't evidence of anything. rtol=0.0 is deliberate — a relative tolerance scales
    with price and would hide small restatements on high-priced tickers."""
    if stored is None or fresh is None or stored.empty or fresh.empty or not anchors:
        return False

    stored_by_date = {_to_date(idx): val for idx, val in stored["adj_close"].items()}
    fresh_by_date = {_to_date(idx): val for idx, val in fresh["adj_close"].items()}

    for anchor in anchors:
        if anchor not in stored_by_date or anchor not in fresh_by_date:
            continue

        stored_val = stored_by_date[anchor]
        fresh_val = fresh_by_date[anchor]

        stored_missing = pd.isna(stored_val)
        fresh_missing = pd.isna(fresh_val)
        if stored_missing and fresh_missing:
            continue
        if stored_missing or fresh_missing:
            return True

        if not np.isclose(float(stored_val), float(fresh_val), atol=DRIFT_TOLERANCE, rtol=0.0):
            return True

    return False


def missing_range(stored: pd.DataFrame, last_session: date) -> tuple[date, date] | None:
    """The (start, end) to fetch to bring stored current through last_session, or None when
    nothing is missing.

    start is the newest stored date itself, not the day after — the second partial-bar
    guard. The most recent stored bar may be an incomplete intraday snapshot fetched during
    market hours, so it must be re-fetched and overwritten rather than trusted; cache.py's
    upsert makes overwriting safe. For stored empty or None, returns None — a first fetch is
    the caller's job, not a repair."""
    if stored is None or stored.empty:
        return None

    newest = _to_date(stored.index.max())
    if newest >= last_session:
        return None

    return (newest, last_session)


def earliest_session_on_or_after(history_start: date, reference_bars: pd.DataFrame) -> date | None:
    """The first session in reference_bars on or after history_start, or None when the frame
    is empty or every bar precedes history_start.

    January 1st (or any calendar HISTORY_START) is essentially never a trading day, so
    first_bar > HISTORY_START is permanently true for every ticker. Comparing against the
    real earliest session rather than the calendar date is what lets a backfill actually
    terminate."""
    if reference_bars is None or reference_bars.empty:
        return None

    bar_dates = [_to_date(idx) for idx in reference_bars.index]
    eligible = [d for d in bar_dates if d >= history_start]

    if not eligible:
        return None
    return min(eligible)


def prepend_range(stored: pd.DataFrame | None, earliest_session: date) -> tuple[date, date] | None:
    """The (start, end) to fetch to extend stored backwards, or None when nothing is missing.
    Both bounds INCLUSIVE.

    None when stored is None/empty — a first fetch is add()'s job, not a repair. None when
    first_bar <= earliest_session — the termination condition. end is first_bar - 1 day, not
    first_bar itself: _download_history adds a day back on the way out (contract 0012), so
    passing first_bar would refetch the bar already held."""
    if stored is None or stored.empty:
        return None

    first_bar = _to_date(stored.index.min())
    if first_bar <= earliest_session:
        return None

    end = first_bar - timedelta(days=1)
    if end < earliest_session:
        return None

    return (earliest_session, end)
