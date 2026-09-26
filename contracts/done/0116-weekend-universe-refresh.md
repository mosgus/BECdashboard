# Contract 0116 (weekend; numbering collided with 0116-align-signal-states) — Refresh windows run every day, including weekends

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** haiku <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

The 09:30 / 12:00 / 16:00 ET refresh windows open **every day**, not only on weekdays.
`app/schedule.py` loses its `include_weekends` flag. A Saturday visit after 09:30 now picks up
Friday's close when nobody visited after Friday 16:00.

## Why

- **The failure.** It was measured on Saturday 2026-09-26.
  - The last universe claim was Friday 9/25 at 13:52 ET, the 12:00 window. That window cannot fetch
    Friday's bar: `last_completed_session` excludes today before 16:00.
  - Nobody opened the app between Friday 16:00 and midnight.
  - `current_window_start` returns `None` all weekend, so Coverage stayed at `→ 2026-09-24` until
    Monday 09:30, about 65 hours behind.
- **The flaw in the old reasoning.** The weekday-only rule (contract 0036) rested on "bars cannot
  change over a weekend". That is true, but it assumed Friday's 16:00 window had already run. When it
  hasn't, the weekend is exactly when the missing bar should be fetched.
- **Why it's cheap.**
  - `refresh_ticker` short-circuits before the network when a ticker is current, so a weekend sweep
    over current tickers costs one reference fetch plus the existing partial-fundamentals retries.
  - Holidays already work this way: weekday windows open on market holidays and find nothing new.
- **Why remove the flag instead of passing `True`.** After this change, news (`news.py`), the
  universe (`autorefresh.py`) and the health card (`ops.py`) all want weekends. A keyword whose
  default no caller uses is a trap for the next reader.
- **What is kept.** Nothing refreshes before 09:30 ET on any day. The "not until 9:30am the next
  trading day" rule in `needs_auto_refresh`'s docstring still holds; it is simply no longer blocked
  at weekends.

## Files

Modify only these:
- `backend/app/schedule.py`
- `backend/app/news.py`: one call site and its docstring sentence.
- `backend/tests/test_schedule.py`

Each of these needs **no edit**. Its behaviour changes through the shared function, and that change
is intended:
- `backend/app/autorefresh.py`: it already calls `needs_auto_refresh(last_refreshed_at, now_et)`
  without the keyword.
- `backend/app/ops.py`: it already calls `current_window_start(now_et)`. The health card's "Current
  window" will now show a window at weekends instead of "Closed".
- `frontend/src/components/SystemHealthCard.tsx`

If `grep -rn "include_weekends" backend/ frontend/src` shows a reference in any file not listed
above, stop and report `BLOCKED`.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs. It is a snapshot of other working software kept so its behaviour can be compared against this
rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies
Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not
route around it.

## Interface

### `backend/app/schedule.py`

1. **`current_window_start(now_et: datetime) -> datetime | None`.**
   - Remove the `include_weekends` parameter and the `if not include_weekends and now_et.weekday() >= 5:` block.
   - Replace its docstring with:
     ```
     """The ET datetime at which the current refresh window opened, or None before 09:30 ET.
     Windows open every day, weekends included (contract 0116): if nobody visits after Friday
     16:00, Saturday's first window is what fetches Friday's close. Weekday-only windows
     (contract 0036) left that bar missing until Monday 09:30."""
     ```
2. **`needs_auto_refresh(last_refreshed_at, now_et) -> bool`.**
   - Remove the `include_weekends` parameter.
   - Change the `current_window_start` call to `current_window_start(now_et)`.
   - In its docstring, delete the final sentence, which begins "`include_weekends` is forwarded".
   - Leave the rest of the docstring as it is.
3. **The module docstring.** Change the first sentence's "(09:30, 12:00, 16:00 ET)" to
   "(09:30, 12:00, 16:00 ET, every day)". Change nothing else in it.

### `backend/app/news.py`

- Change `return needs_auto_refresh(last_claim_at, now_et, include_weekends=True)` to
  `return needs_auto_refresh(last_claim_at, now_et)`.
- In that function's docstring, replace
  `defers entirely to needs_auto_refresh with weekends included: a weekday-only gate would freeze the feed and briefing from Friday 16:00 to Monday 09:30, about 65 hours.`
  with `defers entirely to needs_auto_refresh, whose windows open every day, weekends included.`
  The line wrapping may change; keep lines under 100 characters.

### `backend/tests/test_schedule.py`

- `test_current_window_start_saturday_is_none` becomes
  `test_current_window_start_saturday_returns_a_real_window`. It asserts
  `current_window_start(_et(10, 0, day=19)) == _window(9, 30, day=19)`.
- `test_current_window_start_sunday_is_none` becomes
  `test_current_window_start_sunday_returns_a_real_window`. It asserts
  `current_window_start(_et(13, 0, day=20)) == _window(12, 0, day=20)`.
- Delete the whole `# --- include_weekends ---` section and its three tests.
- Add:
  ```python
  def test_needs_auto_refresh_saturday_true_when_last_claim_was_friday_noon():
      """The 2026-09-26 incident: Friday's last claim was the 12:00 window, so Friday's close was
      never fetched. Saturday's 09:30 window must be due."""
      friday_noon_claim = _window(13, 52, day=18).astimezone(timezone.utc)
      assert needs_auto_refresh(friday_noon_claim, _et(10, 0, day=19)) is True


  def test_needs_auto_refresh_saturday_before_930_is_still_false():
      assert needs_auto_refresh(None, _et(9, 0, day=19)) is False
  ```
  2026-09-18 is a Friday; update the date comment in `_et` to say so.

## Out of scope

- Changing the 16:00 cutoff in `freshness.py`. **Do not touch it**: it is what stops a partial bar
  being stored as a close (contract 0024).
- Refreshing before 09:30, or refreshing on "newer completed session than last claim" logic.
- `is_market_open` in `quotes.py` and its weekend tests. That is market hours, a separate concept.
- Wording on the Universe page, the Ops page or the frontend.

## Acceptance criteria

1. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)` reports
   **632 passed**. The count before is 633: three tests are deleted and two are added.
   Run it once before editing and paste both counts. If the before count is not 633, report the
   number and continue; don't block.
2. `grep -rn "include_weekends" backend/ frontend/src` prints nothing.
3. `grep -n "weekday()" backend/app/schedule.py` prints nothing.
4. `git diff --stat` shows changes only to the three files above, beyond files that were already
   modified before you started. Run `git status --short` first and paste it.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string, so any script run without that prefix talks to the **production database**.
> Nothing below writes state, but the prefix is still required.

From the repo root. Paste the complete, verbatim output, **with each command shown above its
output**.

```bash
git status --short                                   # before editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)   # before editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q 2>&1 | tail -1)   # after editing
(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_schedule.py tests/test_news.py tests/test_autorefresh.py tests/test_ops.py 2>&1 | tail -1)
grep -rn "include_weekends" backend/ frontend/src; echo "exit=$?"
grep -n "weekday()" backend/app/schedule.py; echo "exit=$?"
(cd backend && DATABASE_URL="" .venv/bin/python -c "
from datetime import datetime
from zoneinfo import ZoneInfo
from app.schedule import current_window_start
ET = ZoneInfo('America/New_York')
for d in (18, 19, 20):
    print(d, current_window_start(datetime(2026, 9, d, 10, 0, tzinfo=ET)))
")
git diff --stat
```

The last Python block must print three real 09:30 windows, for Fri 18, Sat 19 and Sun 20.

## Human verification — does Gunnar need to run anything?

1. Restart the backend. Find the process owning the port with `lsof -nP -iTCP:8000 -sTCP:LISTEN`,
   kill it, then relaunch.
2. Load any page. If today is a weekend after 09:30 ET and the universe hasn't been claimed since
   the window opened, the strip triggers the sweep.
3. Within about 2 minutes, the Universe **Coverage** column should end at the last trading day.
4. Ops → System health: "Current window" shows a time, not "Closed".

## Open questions

None.
