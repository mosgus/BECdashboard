from datetime import date

import pytest

from app.returns import base_close_on_or_after, bar_window_start, nth_prior_close, pct_return, ytd_base_close


# --- pct_return -----------------------------------------------------------------------------


def test_pct_return_none_when_either_side_is_none():
    assert pct_return(None, 100.0) is None
    assert pct_return(100.0, None) is None


def test_pct_return_none_when_earlier_is_zero():
    assert pct_return(100.0, 0.0) is None


def test_pct_return_computes_percentage():
    assert pct_return(110.0, 100.0) == 10.0


# --- nth_prior_close --------------------------------------------------------------------------


def test_nth_prior_close_none_on_short_history():
    bars = [(date(2026, 1, 2), 100.0), (date(2026, 1, 3), 101.0)]
    assert nth_prior_close(bars, 5) is None


def test_nth_prior_close_returns_the_session_n_gaps_back():
    bars = [(date(2026, 1, 2 + i), 100.0 + i) for i in range(7)]  # values 100..106
    assert nth_prior_close(bars, 5) == 101.0  # bars[-6]


# --- ytd_base_close ---------------------------------------------------------------------------


def test_ytd_base_close_series_starting_mid_year():
    bars = [(date(2025, 6, 1), 50.0), (date(2026, 3, 1), 90.0), (date(2026, 6, 1), 100.0)]
    assert ytd_base_close(bars, 2026) == 90.0


def test_ytd_base_close_none_when_no_bar_on_or_after_cutoff():
    bars = [(date(2025, 6, 1), 50.0)]
    assert ytd_base_close(bars, 2026) is None


# --- base_close_on_or_after --------------------------------------------------------------------


def test_base_close_on_or_after_uses_the_cutoff_bar_or_the_first_later_bar():
    bars = [(date(2026, 1, 2), 100.0), (date(2026, 1, 5), 105.0)]
    assert base_close_on_or_after(bars, date(2026, 1, 2)) == 100.0
    assert base_close_on_or_after(bars, date(2026, 1, 3)) == 105.0


# --- bar_window_start: the bounded read window ---------------------------------------------
# Narrowing this fails silently — five_day/thirty_day/ytd are computed and returned but not
# rendered yet, so a too-short window drops them to None with nothing on screen to notice.


def test_bar_window_start_reaches_january_first_in_september():
    assert bar_window_start(date(2026, 9, 18), 2026) == date(2026, 1, 1)


def test_bar_window_start_reaches_back_past_new_year_in_early_january():
    """1 January alone cannot satisfy nth_prior_close(bars, 30): on 5 January only a handful of
    sessions exist in the year, so the window must reach into the previous one."""
    assert bar_window_start(date(2027, 1, 5), 2027) == date(2026, 10, 22)


@pytest.mark.parametrize(
    "today",
    [date(2026, 1, 1), date(2026, 1, 15), date(2026, 3, 1), date(2026, 7, 4), date(2026, 12, 31)],
)
def test_bar_window_start_always_satisfies_both_lower_bounds(today):
    start = bar_window_start(today, today.year)
    assert start <= date(today.year, 1, 1), "must reach 1 January for ytd_base_close"
    assert (today - start).days >= 45, "must leave room for 31 trading sessions"
