# Contract 0037 — Put the news feed and briefing on the universe's refresh windows

**Status:** in-progress
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The news feed and the AI briefing stop running on their own rolling TTL and refresh on the **same
09:30 / 12:00 / 16:00 ET windows** the universe already uses, triggered from the same endpoint.

Backend only. No migration, no frontend, no new dependency.

## Why

Two schedules exist today and neither knows about the other:

| | trigger | gate |
|---|---|---|
| universe | `GET /universe/strip` | `needs_auto_refresh` — windows 09:30/12:00/16:00 ET, weekdays, claimed in `app_state` |
| news + briefing | `GET /news` | `needs_refresh` — 6-hour TTL, gated at 09:00 ET |

**The news cadence drifts.** A 6-hour TTL measured from the last refresh means a first refresh at
10:47 puts the next at 16:47, then 22:47 — the times wander every day, and the 09:00 gate only blocks
the small hours. The windows are fixed wall-clock times. Pinning news to them makes "when does data
update" one answer instead of two.

`app_state` was built generic for exactly this — `REBUILD.md`: *"the next 'when did X last happen'
question should reuse it rather than add an eighth table."* This is that question. **No migration.**

### Weekends — the reason this is not a straight reuse

`current_window_start` returns `None` on Saturday and Sunday, because bars cannot change over a
weekend and a weekend visitor should not spend a reference fetch to learn nothing.

**News does not work that way.** Adopt the gate unchanged and the feed and briefing freeze from
Friday 16:00 to Monday 09:30 — about 65 hours. So `current_window_start` gains an
`include_weekends` flag: the universe keeps weekdays-only, news opts in. Same three times, different
day coverage, one function.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network, no database and no `GEMINI_KEY`.** Never call yfinance or Gemini
in a test. Every test touching time must pin it and **patch every module that imported the name**.

**Testing a clock-injected function against the real database writes real state.** Contract 0036's
verification claimed a window eight hours ahead by calling the sweep with a simulated `now_et`. If
you do that here, say so and give the command to clear the key you wrote.

**If a command fails with `password authentication failed for user "<not in .env>"`, or the frontend
shows "API offline" while the server logs 200s**, your shell has a stale exported `DATABASE_URL` or
`CORS_ORIGINS`. `env | grep -E "DATABASE_URL|CORS_ORIGINS"`.

## Files

Modify:
- `backend/app/schedule.py` — `include_weekends`
- `backend/app/news.py` — replace the TTL gate, add the scheduled entry point
- `backend/app/routers/news.py` — remove the background task
- `backend/app/routers/universe.py` — schedule the news refresh alongside the universe sweep
- `backend/tests/test_schedule.py`
- `backend/tests/test_news.py`
- `backend/tests/test_api_news.py`

**Touch nothing else.** Not `app/autorefresh.py`, `app/briefing.py`, `app/quotes.py`, `app/cache.py`,
`app/strip.py`, `app/universe.py`, `app/freshness.py`, `app/market_data.py`, `app/models.py`,
`app/schemas.py`, `app/config.py`, `app/db.py`, `app/main.py`, `tests/conftest.py`, any migration, or
**anything under `frontend/`**.

## `app/schedule.py`

```python
def current_window_start(now_et: datetime, *, include_weekends: bool = False) -> datetime | None
def needs_auto_refresh(
    last_refreshed_at: datetime | None,
    now_et: datetime,
    *,
    include_weekends: bool = False,
) -> bool
```

Keyword-only, defaulting to `False`, so **every existing call site keeps its current behaviour
untouched** — the universe sweep must not start running at weekends as a side effect of this
contract. `needs_auto_refresh` forwards the flag.

Nothing else about these functions changes: still pure, still take `now_et`, still return `None`
before 09:30.

## `app/news.py`

### Delete

`NEWS_TTL_HOURS`, `NEWS_EARLIEST_ET`, and `needs_refresh`. They are the old schedule and leaving dead
constants behind implies a rule that no longer exists. `NEWS_RETENTION_DAYS` **stays** — that is the
14-day article prune, unrelated.

### Add — pure

```python
NEWS_REFRESH_KEY = "news_refresh"

def needs_news_refresh(
    newest_fetched_at: datetime | None,
    last_claim_at: datetime | None,
    now_et: datetime,
) -> bool:
    """True when the feed has never been populated, or the current window is unclaimed."""
```

- `newest_fetched_at is None` → **True**, at any hour, weekend included. An empty feed must not stay
  blank until 09:30 on a fresh deploy — the same rule `needs_summary` already follows for the
  briefing, and the reason rule 1 beats rule 2 there.
- otherwise → `needs_auto_refresh(last_claim_at, now_et, include_weekends=True)`

Note it takes **two** timestamps: `newest_fetched_at` is the newest article row, `last_claim_at` is
`app_state["news_refresh"]`. They are different things — an attempted refresh that fetched nothing
still claims the window, and must not be retried on the next page load.

### Add — impure

```python
def run_news_refresh_if_due(now_utc: datetime, now_et: datetime) -> None
```

The scheduled entry point. In order:

1. Read `app_state["news_refresh"]` and the newest article `fetched_at`; call `needs_news_refresh`;
   return immediately when False.
2. **Write `now_utc` to `app_state["news_refresh"]` before any fetch** — claim-first, exactly as
   `autorefresh.run_auto_refresh_if_due` does, and for the same reason. Say in the report that you
   did this first, not last.
3. Read active tickers. **Reuse `app.autorefresh.active_universe_tickers`** — do not add a third copy
   of that query.
4. Run the existing fetch / parse / upsert / prune body **unchanged**. Sequential, per-ticker
   `except Exception` continue, never delete-then-insert.
5. Call `refresh_briefing(now_utc, now_et, articles_refreshed)` exactly as it is called today.

**`refresh_news_if_stale` keeps its signature** — `(tickers, now_utc, now_et)` — because
`test_news.py` and `test_briefing.py` drive it directly. Restructure it into the unguarded body if
you like, but do not change what it does once it has decided to run, and do not change
`refresh_briefing` at all.

**Never roll the claim back on failure.** A window that errored waits for the next one.

## Routers

### `routers/news.py`

Remove the `background_tasks.add_task(...)` at line 66 and the now-unused imports. `GET /news`
becomes a **pure read** — storage in, JSON out, no scheduling. Its `limit` / `max_per_ticker`
clamping, its 503, and its response shape are unchanged.

### `routers/universe.py`

`GET /universe/strip` schedules **both**, as two separate tasks:

```python
background_tasks.add_task(run_auto_refresh_if_due, now_utc, now_et)
background_tasks.add_task(run_news_refresh_if_due, now_utc, now_et)
```

Two tasks rather than one wrapper so a failing universe sweep cannot stop the news refresh, and
neither claims the other's key. The strip response still must not wait on either.

This is the right trigger: `TickerStrip` lives in `App.tsx` outside `<Routes>`, so it fires on every
page load. Moving news here means it also refreshes for someone who only opens `/universe` — which
`GET /news` could never do.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **307**.
2. `grep -rn "NEWS_TTL_HOURS\|NEWS_EARLIEST_ET\|def needs_refresh" backend/app/news.py` matches
   nothing (exit 1) — the old schedule is gone, not merely unused.
3. `grep -rn "add_task" backend/app/routers/news.py` matches nothing (exit 1).
4. `grep -n "add_task" backend/app/routers/universe.py` shows **two** lines.
5. `current_window_start` tests for the new flag: **Saturday 10:00 with `include_weekends=True` →
   10:00's window**, and the same call with the default → `None`. Both asserted.
6. A test proving the universe sweep is **unaffected**: `needs_auto_refresh(None, saturday_now_et)`
   is still `False` with no keyword passed.
7. `needs_news_refresh` tests: empty feed before 09:30 → True; empty feed on a Sunday → True;
   populated feed, window claimed one second after it opened → False; populated feed, claim one
   second before the window opened → True. **Quote all four assertions.**
8. A test proving the claim is written **before** the fetch — a fetch stub that raises, after which
   `app_state["news_refresh"]` still holds the new timestamp. Assert on stored state, not source
   order.
9. `grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/news.py` matches nothing
   (exit 1).
10. Every `DELETE` in `app/news.py` is still the 14-day `pub_date` prune. **Quote each matching line**
    — `grep -nE "delete\(" backend/app/news.py`. Note the SQLAlchemy 2.0 `delete()` construct, not
    `Query.delete()`; contract 0031's criterion got this wrong.
11. `git diff --stat backend/app/autorefresh.py backend/app/briefing.py backend/app/quotes.py backend/app/strip.py backend/app/universe.py backend/app/models.py backend/app/schemas.py`
    is empty.
12. `ls backend/migrations/versions/` still shows exactly **seven**.
13. `git status --porcelain` lists nothing outside this contract's Files list and nothing under
    `frontend/`. **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rn "NEWS_TTL_HOURS\|NEWS_EARLIEST_ET\|def needs_refresh" backend/app/news.py ; echo "(exit $? — 1 = correct)"
grep -rn "add_task" backend/app/routers/news.py ; echo "(exit $? — 1 = correct)"
grep -n "add_task" backend/app/routers/universe.py
grep -nE "delete\(" backend/app/news.py
grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/news.py ; echo "(exit $? — 1 = correct)"
ls -1 backend/migrations/versions/
git diff --stat backend/app/autorefresh.py backend/app/briefing.py backend/app/quotes.py backend/app/universe.py ; echo "(empty = untouched)"
git status --porcelain
```

Plus the weekend difference, shown side by side:

```bash
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
from datetime import datetime
from zoneinfo import ZoneInfo
from app.schedule import current_window_start
ET = ZoneInfo('America/New_York')
sat = datetime(2026,9,19,10,0,tzinfo=ET)   # Saturday
wed = datetime(2026,9,16,10,0,tzinfo=ET)
for label, n in [('Sat', sat), ('Wed', wed)]:
    print(label,
          'universe:', current_window_start(n),
          '| news:', current_window_start(n, include_weekends=True))"
```

`Sat` must print `universe: None` and a real window for `news`.

## Human verification — does Gunnar need to run anything?

**Yes, briefly.** Nothing visible changes; the point is that nothing *breaks*.

1. Restart uvicorn with `--reload`. Load `localhost:5173/`.
2. Watch the log: the strip responds immediately, then **two** background tasks run — ticker refresh
   activity and news fetch activity — after the response.
3. Reload. **Neither** should run again; both windows are claimed.
4. `curl -s 'http://127.0.0.1:8000/news?limit=3'` still returns articles and a `summary`.
5. Clear both keys and reload once to see a full cycle:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
   from sqlalchemy import delete
   from app.db import session
   from app.models import AppState
   with session() as db:
       db.execute(delete(AppState).where(AppState.key.in_(('auto_refresh','news_refresh'))))
   print('cleared')"
   ```
   **Deliberately not `DATABASE_URL=\"\"`** — it must hit the real database.

Point 3 is the one that matters. If news re-fetches on every reload, the claim is written in the
wrong place and you are making 20 yfinance calls per page load.

## Out of scope

- No change to `refresh_briefing`, `needs_summary`, or `SUMMARY_MIN_AGE_MINUTES`. The briefing
  already follows the news refresh; moving news onto windows moves the briefing with it, which is
  the whole point of this contract.
- No change to the window *times*. 09:30 / 12:00 / 16:00 stay.
- No change to the universe sweep's weekday-only behaviour.
- No new `app_state` columns, no migration, no eighth table.
- No frontend change of any kind.
- No proper distributed lock — claim-first remains the mitigation.

## Open questions — do NOT resolve these yourself

- **Whether news deserves a fourth, later window** (e.g. 20:00 ET) now that it is no longer on a
  rolling TTL. Gunnar decides after watching it.
- **Whether the two claims should ever be merged into one key.** They are separate so a failing
  universe sweep cannot suppress news.
- **Whether `GET /news` should keep any trigger at all** as a fallback if `/universe/strip` fails.
- **What happens to the four `Coming soon` cards.** Still open.
