"""Visit-triggered auto-refresh windows: universe price history refreshes itself at most once
per window (09:30, 12:00, 16:00 ET, every day), the first time anyone visits inside it. Pure — no
database, no clock, no network; the impure sweep this drives lives in app/autorefresh.py.

The 12:00 window can never pick up a new bar — last_completed_session (app/freshness.py)
excludes today unless now_et_hour >= 16, so the completed session at 09:31 and at 12:30 is the
same date. It exists to refresh quotes and to catch a ticker added since the morning, not to
fetch a bar that does not exist yet."""

from datetime import datetime, time

WINDOW_TIMES = (time(9, 30), time(12, 0), time(16, 0))


def current_window_start(now_et: datetime) -> datetime | None:
    """The ET datetime at which the current refresh window opened, or None before 09:30 ET.
    Windows open every day, weekends included (contract 0116): if nobody visits after Friday
    16:00, Saturday's first window is what fetches Friday's close. Weekday-only windows
    (contract 0036) left that bar missing until Monday 09:30."""
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
) -> bool:
    """True when a window is open and nothing has refreshed since that window opened.

    A midnight-to-09:30 visit always returns False here (current_window_start is None before
    09:30), which is what makes the 16:00 window's work get picked up by the next *morning*
    window rather than by an overnight visitor — the intended reading of "not until 9:30am the
    next trading day".

    last_refreshed_at arrives timezone-aware (UTC, from storage); window_start is aware ET.
    They are compared directly — Python resolves cross-zone comparisons correctly — never
    stripped or re-labeled here."""
    window_start = current_window_start(now_et)
    if window_start is None:
        return False
    if last_refreshed_at is None:
        return True
    return last_refreshed_at < window_start
