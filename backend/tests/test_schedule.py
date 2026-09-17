from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.schedule import current_window_start, needs_auto_refresh

ET = ZoneInfo("America/New_York")


def _et(hour: int, minute: int, day: int = 16) -> datetime:
    # 2026-09-16 is a Wednesday, 2026-09-19 a Saturday, 2026-09-20 a Sunday.
    return datetime(2026, 9, day, hour, minute, tzinfo=ET)


def _window(hour: int, minute: int, day: int = 16) -> datetime | None:
    return _et(hour, minute, day)


# --- current_window_start ----------------------------------------------------------------


def test_current_window_start_before_open_is_none():
    assert current_window_start(_et(9, 29)) is None


def test_current_window_start_at_930_is_930():
    assert current_window_start(_et(9, 30)) == _window(9, 30)


def test_current_window_start_at_1159_is_930():
    assert current_window_start(_et(11, 59)) == _window(9, 30)


def test_current_window_start_at_noon_is_noon():
    assert current_window_start(_et(12, 0)) == _window(12, 0)


def test_current_window_start_at_1559_is_noon():
    assert current_window_start(_et(15, 59)) == _window(12, 0)


def test_current_window_start_at_1600_is_1600():
    assert current_window_start(_et(16, 0)) == _window(16, 0)


def test_current_window_start_at_2359_is_1600():
    assert current_window_start(_et(23, 59)) == _window(16, 0)


def test_current_window_start_saturday_is_none():
    # 2026-09-19 is a Saturday.
    assert current_window_start(_et(10, 0, day=19)) is None


def test_current_window_start_sunday_is_none():
    # 2026-09-20 is a Sunday.
    assert current_window_start(_et(13, 0, day=20)) is None


# --- needs_auto_refresh --------------------------------------------------------------------


def test_needs_auto_refresh_true_when_never_refreshed_inside_a_window():
    assert needs_auto_refresh(None, _et(10, 0)) is True


def test_needs_auto_refresh_false_one_second_after_window_opened():
    window_start = _window(9, 30)
    last_refreshed_at = (window_start + timedelta(seconds=1)).astimezone(timezone.utc)
    assert needs_auto_refresh(last_refreshed_at, _et(10, 0)) is False


def test_needs_auto_refresh_true_one_second_before_window_opened():
    window_start = _window(9, 30)
    last_refreshed_at = (window_start - timedelta(seconds=1)).astimezone(timezone.utc)
    assert needs_auto_refresh(last_refreshed_at, _et(10, 0)) is True


def test_needs_auto_refresh_false_before_the_first_window_even_with_no_prior_refresh():
    assert needs_auto_refresh(None, _et(9, 0)) is False


# --- include_weekends -------------------------------------------------------------------------


def test_current_window_start_saturday_with_include_weekends_returns_a_real_window():
    # 2026-09-19 is a Saturday; the same 10:00 slot as a weekday still falls in the 09:30 window.
    assert current_window_start(_et(10, 0, day=19), include_weekends=True) == _window(9, 30, day=19)


def test_current_window_start_saturday_default_is_still_none():
    """The universe sweep must not start running at weekends as a side effect of adding the
    flag — the default (no keyword passed) has to keep today's exact behavior."""
    assert current_window_start(_et(10, 0, day=19)) is None


def test_needs_auto_refresh_unaffected_by_the_new_flag_when_not_passed():
    """Proof the universe sweep itself is untouched: called exactly as every existing call
    site calls it (no keyword), a Saturday visit is still False."""
    assert needs_auto_refresh(None, _et(10, 0, day=19)) is False
