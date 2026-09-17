"""Visit-triggered auto-refresh windows: universe price history refreshes itself at most once
per window (09:30, 12:00, 16:00 ET), the first time anyone visits inside it. Pure — no
database, no clock, no network; the impure sweep this drives lives in app/autorefresh.py.

The 12:00 window can never pick up a new bar — last_completed_session (app/freshness.py)
excludes today unless now_et_hour >= 16, so the completed session at 09:31 and at 12:30 is the
same date. It exists to refresh quotes and to catch a ticker added since the morning, not to
fetch a bar that does not exist yet."""

from datetime import datetime, time

WINDOW_TIMES = (time(9, 30), time(12, 0), time(16, 0))


def current_window_start(now_et: datetime, *, include_weekends: bool = False) -> datetime | None:
    """The ET datetime at which the current refresh window opened. None before 09:30 ET, and
    — unless `include_weekends` is set — None on Saturday or Sunday too: bars cannot change
    over a weekend, so there is nothing for a weekend visitor's *universe* window to claim.

    `include_weekends` is keyword-only and defaults to False so every existing call site (the
    universe sweep) keeps its exact current behavior. News (contract 0037) opts in: a 6-hour
    weekday-only gate would freeze the feed and briefing from Friday 16:00 to Monday 09:30."""
    if not include_weekends and now_et.weekday() >= 5:  # Saturday=5, Sunday=6
        return None

    t = now_et.time()
    if t < WINDOW_TIMES[0]:
        return None
    if t < WINDOW_TIMES[1]:
        window_time = WINDOW_TIMES[0]
    elif t < WINDOW_TIMES[2]:
        window_time = WINDOW_TIMES[1]
    else:
        window_time = WINDOW_TIMES[2]

    return datetime.combine(now_et.date(), window_time, tzinfo=now_et.tzinfo)


def needs_auto_refresh(
    last_refreshed_at: datetime | None,
    now_et: datetime,
    *,
    include_weekends: bool = False,
) -> bool:
    """True when a window is open and nothing has refreshed since that window opened.

    A midnight-to-09:30 visit always returns False here (current_window_start is None before
    09:30), which is what makes the 16:00 window's work get picked up by the next *morning*
    window rather than by an overnight visitor — the intended reading of "not until 9:30am the
    next trading day".

    last_refreshed_at arrives timezone-aware (UTC, from storage); window_start is aware ET.
    They are compared directly — Python resolves cross-zone comparisons correctly — never
    stripped or re-labeled here. `include_weekends` is forwarded to current_window_start
    unchanged; see its docstring."""
    window_start = current_window_start(now_et, include_weekends=include_weekends)
    if window_start is None:
        return False
    if last_refreshed_at is None:
        return True
    return last_refreshed_at < window_start
