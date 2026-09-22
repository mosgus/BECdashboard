from datetime import date, timedelta

# Calendar days, not sessions — see bar_window_start. 75 days ≈ 52 trading sessions, against the
# 31 that nth_prior_close(bars, 30) requires.
_MIN_WINDOW_DAYS = 75


def pct_return(latest: float | None, earlier: float | None) -> float | None:
    """Percent return between two prices. None when either is None or `earlier` is 0."""
    if latest is None or earlier is None or earlier == 0:
        return None
    return (latest - earlier) / earlier * 100


def nth_prior_close(bars: list[tuple[date, float]], sessions: int) -> float | None:
    """The adj_close `sessions` trading sessions before the latest. None when short.

    bars[-1] is the latest session, so `sessions` sessions before it is bars[-1 - sessions] —
    a 5-day return passes sessions=5 and reads index -6, a 5-session gap from the latest."""
    if len(bars) <= sessions:
        return None
    return bars[-1 - sessions][1]


def base_close_on_or_after(bars: list[tuple[date, float]], cutoff: date) -> float | None:
    """The first adj_close on or after `cutoff`. None when no bar qualifies."""
    for bar_date, close in bars:
        if bar_date >= cutoff:
            return close
    return None


def ytd_base_close(bars: list[tuple[date, float]], year: int) -> float | None:
    """The first adj_close on or after 1 January of `year`. None when absent."""
    return base_close_on_or_after(bars, date(year, 1, 1))


def bar_window_start(today: date, year: int) -> date:
    """The earliest bar date build_strip_response needs. Pure — `today` is an argument.

    The strip derives only five things from stored bars: the newest close, the one before it,
    and the 5-, 30-session and YTD anchors. Reading full history to compute those transferred
    55,917 rows for 22 tickers when 3,914 sufficed — measured 2026-09-18, a 14.3x over-fetch on
    the one endpoint that runs on every page load.

    Two lower bounds have to hold simultaneously, hence the min():
    - YTD needs the first session on or after 1 January, so the window must reach that far back.
    - nth_prior_close(bars, 30) needs 31 sessions, which 1 January does *not* guarantee in early
      January — on 5 January only three sessions exist in the year. _MIN_WINDOW_DAYS covers it:
      75 calendar days is roughly 52 sessions, comfortably above 31.

    Widening this is safe; narrowing it fails **silently**, because five_day/thirty_day/ytd are
    computed and returned but not yet rendered (contracts 0028, 0033). A too-narrow window drops
    them to None with nothing on screen to notice.
    """
    return min(date(year, 1, 1), today - timedelta(days=_MIN_WINDOW_DAYS))
