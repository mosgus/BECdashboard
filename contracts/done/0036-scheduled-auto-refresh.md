# Contract 0036 — Visit-triggered auto-refresh windows, and a quotes-only Update button

**Status:** accepted (2026-09-17) — audited by planner. Human verification points 2-6 outstanding.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Universe price history refreshes itself at most once per window — **09:30, 12:00 and 16:00 ET** — the
first time anyone visits the site inside that window, and not again until 09:30 the next weekday. The
`Update all data` button stops refreshing bars and instead forces an intraday quote refresh.

## Why

Gunnar, 2026-09-16: he does not want to click a button to keep the universe current, and he wants
fewer yfinance calls. Both are achievable because the existing machinery is already idempotent.

**Measured facts from the current code — build on these, do not re-derive them:**

- `refresh_ticker` (`app/market_data.py:212`) short-circuits **before any network call** when a
  ticker is current: `elif not is_stale(stored, last_session) and not force:` returns immediately.
- `_cached_last_session` is keyed per *(ET date, past-4pm)*, so deriving the session costs at most
  **one** reference-ticker fetch shared across all tickers, twice a day.
- Therefore a sweep over 20 already-current tickers costs ~1 call, not 20. The expensive path only
  runs for genuinely stale tickers.

**The 12:00 window can never fetch a new bar, and that is correct.** `last_completed_session`
(`app/freshness.py`) excludes today unless `now_et_hour >= 16`. So at 09:31 and at 12:30 the last
completed session is the *same date* — every ticker current in the morning is still current at noon.
The noon window exists to refresh **quotes**, and to catch a ticker added since the morning. **Do not
"fix" this by lowering the cutoff** — the cutoff is what stops a partial in-progress bar being stored
as a completed close (`REBUILD.md`, and the AAPL null-close incident of contract 0024).

Realistically there are two bar-fetching events per day: the morning one (picks up yesterday's close
if nobody visited after 16:00) and the post-16:00 one (picks up today's).

**Quotes keep their 10-minute TTL.** Gunnar's explicit decision, 2026-09-16. `list_all` continues to
call `refresh_quotes_if_stale` exactly as it does now. The new button is a *force* path for when he
does not want to wait out the TTL. **Do not change `QUOTE_TTL_MINUTES`, `needs_refresh`, or
`refresh_quotes_if_stale`.**

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**

**Tests must pass with no network and no database.** Every test touching market state must pin time
explicitly and **patch every module that imported the name**, not just where it is defined — this has
bitten three times.

**Restart the backend with `--reload` before any manual check.**

**If a command fails with `password authentication failed for user "<not in .env>"`, or the frontend
shows "API offline" while the server logs 200s**, your shell has a stale exported `DATABASE_URL` or
`CORS_ORIGINS` that `load_dotenv` will not override. `env | grep -E "DATABASE_URL|CORS_ORIGINS"`.

## Files

Create:
- `backend/migrations/versions/0007_app_state.py`
- `backend/app/schedule.py` — pure window logic
- `backend/app/autorefresh.py` — the impure sweep
- `backend/tests/test_schedule.py`
- `backend/tests/test_autorefresh.py`

Modify:
- `backend/app/models.py` — `AppState`
- `backend/app/schemas.py` — `QuoteRefreshResult`
- `backend/app/routers/universe.py` — one new route, one background task
- `backend/tests/test_api_universe.py`
- `frontend/src/api/client.ts` — `refreshQuotes`
- `frontend/src/pages/UniversePage.tsx` — the button

**Touch nothing else.** Not `app/freshness.py`, `app/market_data.py`, `app/quotes.py`, `app/cache.py`,
`app/strip.py`, `app/universe.py`, `app/news.py`, `app/briefing.py`, `app/config.py`, `app/db.py`,
`app/main.py`, `tests/conftest.py`, any existing migration, `UniverseTable.tsx`, `NewsSection.tsx`,
`TickerStrip.tsx`, `App.tsx`, `LaunchPage.tsx`, `index.html`, or `globals.css`.

**No new dependency.**

## Schema — `app_state`

Migration revision **0007**, down-revision **0006**. Exactly seven afterwards.

| column | type | notes |
|---|---|---|
| `key` | `String` PK | `"auto_refresh"` is the only key this contract writes |
| `value_at` | `DateTime(timezone=True)` NOT NULL | UTC |

A deliberately generic key→timestamp store — the next "when did X last happen" question should reuse
it rather than add an eighth table.

## `app/schedule.py` — pure

```python
WINDOW_TIMES = (time(9, 30), time(12, 0), time(16, 0))

def current_window_start(now_et: datetime) -> datetime | None:
    """The ET datetime at which the current refresh window opened.
    None before 09:30 ET, and None on Saturday or Sunday."""

def needs_auto_refresh(last_refreshed_at: datetime | None, now_et: datetime) -> bool:
    """True when a window is open and nothing has refreshed since that window opened."""
```

No database, no clock, no network.

`current_window_start`:
- `now_et.weekday() >= 5` → **None**. Bars cannot change at the weekend, and this keeps a Saturday
  visitor from spending a reference fetch to learn nothing.
- `t < 09:30` → **None**
- `t < 12:00` → today at 09:30
- `t < 16:00` → today at 12:00
- otherwise → today at 16:00

`needs_auto_refresh`:
- window is `None` → **False**
- `last_refreshed_at is None` → **True**
- otherwise → `last_refreshed_at < window_start`

`last_refreshed_at` arrives timezone-aware (UTC, from storage); `window_start` is aware ET. Compare
them directly — Python handles that correctly across zones. **Do not strip tzinfo** and do not
`.replace(tzinfo=...)` on either side.

A midnight-to-09:30 visit returns False, so the 16:00 window's work is picked up by the next morning
window if nobody visited in the evening. That is the intended reading of "it doesn't get
automatically updated until 9:30am the next trading day".

## `app/autorefresh.py` — impure

```python
def run_auto_refresh_if_due(now_utc: datetime, now_et: datetime) -> None
```

1. Read `app_state["auto_refresh"]`. Call `needs_auto_refresh`; return immediately when False.
2. **Write `now_utc` to `app_state` before doing any work.** Claiming the window first is what stops
   two visitors in the same second from both running a full sweep. It is not a perfect lock — a
   genuine lock is out of scope — but it narrows the race from seconds to milliseconds. Say in the
   report that you did this first, not last.
3. Read active universe tickers — one bounded query. **Do not call `app.universe.list_all()`**: it
   pulls fundamentals, bars and quotes and triggers a quote fetch, none of which this needs. Select
   from `UniverseTicker` directly, the same way `app/news.py:active_universe_tickers` already does.
4. Walk tickers **sequentially**, calling `app.universe.refresh(ticker)` — the same function
   `POST /{ticker}/refresh` uses. No `asyncio.gather`, no thread pool: contract 0013.
   **A failure on one ticker must not abort the rest** — catch, log, continue.
5. Finally call `app.quotes.refresh_quotes_if_stale(tickers)` so the window also lands a current
   intraday price.

**Never roll back the timestamp on failure.** A window that errored is not retried by the next
visitor thirty seconds later; it waits for the next window. Retrying a failing sweep on every page
load is how you get rate-limited.

## Router

### Trigger the sweep from `GET /universe/strip`

`TickerStrip` lives in `App.tsx` outside `<Routes>`, so `/universe/strip` fires once on **every**
page load — it is the only endpoint that reliably means "a user visited the site". `/universe` would
miss anyone who only opens the launch page.

Schedule `run_auto_refresh_if_due` with FastAPI `BackgroundTasks`. **The strip response must not wait
on it.** Everything else about that route — its read-only body, its "never fetch from yfinance"
guarantee for the *response* — is unchanged.

### `POST /universe/quotes/refresh`

```
200 → QuoteRefreshResult { refreshed: int, fetched_at: datetime | None }
503 → no database configured
```

Forces a quote fetch regardless of the 10-minute TTL — that is the whole point of the button.

**This route collides with `POST /{ticker}/refresh`.** Both match `/universe/X/refresh`, so declared
after it, `quotes/refresh` resolves as a ticker named "quotes" and 404s — a plausible wrong answer,
not an error. Contracts 0020 and 0028 both hit this exact trap. **Declare it above
`/{ticker}/refresh` and add a test asserting `POST /universe/quotes/refresh` returns the quote shape,
not a 404.**

## Frontend

### `client.ts`

```ts
export interface QuoteRefreshResult { refreshed: number; fetched_at: string | null }
export async function refreshQuotes(): Promise<QuoteRefreshResult>
```

### `UniversePage.tsx`

The `Update all data {N}` button becomes **`Refresh prices`** — no count, because it no longer walks
tickers. One `POST /universe/quotes/refresh`, then refetch the universe list so the Price column and
its timestamp update.

- Remove the sequential `refreshTicker` loop and its progress counter.
- Keep the disabled/in-flight state so it cannot be double-clicked.
- `refreshTicker` stays exported from `client.ts` and `POST /{ticker}/refresh` stays on the server —
  neither is called from the page any more. **Do not delete either.**
- Tooltip: `Fetch the latest intraday prices now`.
- Everything else on the page is unchanged: filters, the download buttons, the table, the chart.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **281**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
3. `ls backend/migrations/versions/` shows exactly **seven**; `0007` has `down_revision = "0006"`.
4. `current_window_start` tests, all pinned: 09:29 → None; 09:30 → 09:30; 11:59 → 09:30;
   12:00 → 12:00; 15:59 → 12:00; 16:00 → 16:00; 23:59 → 16:00; **Saturday 10:00 → None**;
   **Sunday 13:00 → None**.
5. `needs_auto_refresh` tests: `None` last-refresh inside a window → True; a refresh **one second
   after** the window opened → False; a refresh **one second before** it opened → True; any time
   before 09:30 → False even with `last_refreshed_at=None`. **Quote all four assertions.**
6. A test proving the timestamp is written **before** the ticker sweep — e.g. a refresh stub that
   raises on the first ticker, after which `app_state` still holds the new timestamp. Assert on
   stored state, not on source order.
7. A test where one ticker's refresh raises and a second still runs.
8. `grep -n '"/quotes/refresh"' backend/app/routers/universe.py` shows an **earlier** line number
   than `grep -n '"/{ticker}/refresh"'`. Quote both. Plus a test that the route returns the quote
   shape rather than 404.
9. `grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/autorefresh.py` matches
   nothing (exit 1).
10. `grep -n "BackgroundTasks" backend/app/routers/universe.py` matches.
11. `git diff --stat backend/app/freshness.py backend/app/market_data.py backend/app/quotes.py backend/app/cache.py backend/app/universe.py backend/app/news.py backend/requirements.txt`
    is empty — in particular `QUOTE_TTL_MINUTES` is untouched.
12. `grep -n "refreshTicker" frontend/src/api/client.ts` still matches — the export survives even
    though the page no longer calls it.
13. `git status --porcelain` lists nothing outside this contract's Files list.
    **Do not use `git diff --name-only` to check this** — several files in this repo are untracked at
    any given time, and `git diff` cannot see them.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "down_revision" backend/migrations/versions/0007_app_state.py
grep -n '"/quotes/refresh"' backend/app/routers/universe.py
grep -n '"/{ticker}/refresh"' backend/app/routers/universe.py
grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/autorefresh.py ; echo "(exit $? — 1 = correct)"
grep -n "BackgroundTasks" backend/app/routers/universe.py
git diff --stat backend/app/freshness.py backend/app/market_data.py backend/app/quotes.py backend/app/universe.py ; echo "(empty = untouched)"
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
git status --porcelain
```

Plus, showing the window logic against real clock values rather than only fixtures:

```bash
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
from datetime import datetime
from zoneinfo import ZoneInfo
from app.schedule import current_window_start, needs_auto_refresh
ET = ZoneInfo('America/New_York')
for d, h, m in [(16,9,29),(16,9,30),(16,12,0),(16,16,0),(16,23,59),(20,10,0)]:
    n = datetime(2026,9,d,h,m,tzinfo=ET)
    print(n.strftime('%a %H:%M'), '->', current_window_start(n))"
```

`Sun 10:00` must print `None`.

## Human verification — does Gunnar need to run anything?

**Yes — the whole feature is time-dependent and cannot be judged from tests alone.**

1. `alembic upgrade head`, then restart uvicorn with `--reload`.
2. Load `localhost:5173/` and watch the server log. Inside a window, you should see the strip respond
   **immediately**, then ticker refresh activity in the log *after* the response. That gap is the
   feature working.
3. Reload the page. The second visit must **not** start another sweep — the window is claimed.
4. Go to `/universe`, press **`Refresh prices`**. Only quotes should move: the Price column and its
   timestamp update, `bar_count` and `last_bar` do not.
5. Confirm the button no longer walks tickers — the log should show a single quote fetch, not twenty
   ticker refreshes.
6. To test a window boundary without waiting, delete the state row and reload:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
   from sqlalchemy import delete
   from app.db import session
   from app.models import AppState
   with session() as db: db.execute(delete(AppState).where(AppState.key=='auto_refresh'))
   print('cleared')"
   ```
   **Note this one is deliberately not `DATABASE_URL=\"\"`** — it must hit the real database.

Point 3 is the one worth being careful about. If every reload starts a sweep, the claim-first write
is in the wrong place and you will be making twenty yfinance calls per page load.

## Out of scope

- No holiday calendar. A market holiday opens a window, finds nothing stale and costs ~1 reference
  fetch. `last_completed_session` already derives real sessions from the reference ticker's own bars,
  so holidays never produce a *wrong* result — only a cheap wasted check.
- No change to `QUOTE_TTL_MINUTES` or any quote freshness rule.
- No change to the news feed, the briefing, the ticker strip, or the launch page.
- No proper distributed lock. Claim-first is the mitigation; a real lock is a separate contract.
- No UI for "when did the universe last auto-refresh". Log only.
- No manual full-refresh escape hatch in the UI.

## Open questions — do NOT resolve these yourself

- **Whether a manual "force full refresh" control should exist** now that the button is quotes-only.
  `POST /{ticker}/refresh` still exists server-side; nothing calls it.
- **Whether the 16:00 window should extend past midnight** so an overnight visitor picks up the
  close. Today it does not, per Gunnar's "not until 9:30am the next trading day".
- **Whether `app_state` should also record the last *successful* sweep** separately from the last
  attempt.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-17)

- `pytest -q` → **307 passed** (from 281)
- Route order: `"/quotes/refresh"` at `routers/universe.py:104`, `"/{ticker}/refresh"` at `:129`.
  The trap from contracts 0020 and 0028 avoided, with a test.
- **Claim-first confirmed in source order**: `_set_state(AUTO_REFRESH_KEY, now_utc)` at
  `autorefresh.py:88`, the ticker loop at `:91`. Backed by a test that asserts on stored state after
  a sweep that raises on the first ticker, not on source order.
- `asyncio.gather|ThreadPool|concurrent.futures` in `autorefresh.py` → exit 1
- Seven migrations, `0007` → `down_revision "0006"`
- Scope empty across `freshness.py`, `market_data.py`, `quotes.py`, `cache.py`, `universe.py`,
  `news.py`, `requirements.txt` — `QUOTE_TTL_MINUTES` untouched
- `refreshTicker` still exported at `client.ts:175`; `UniversePage` no longer imports it
- `/universe/strip` schedules the sweep via `BackgroundTasks` and does not await it

### The implementer was right about the concurrent edit

It reported `M frontend/src/components/NewsSection.tsx` as outside its file list and **not its own**,
established via mtime. Correct: Gunnar hand-edited that file during the run — dropping `h-full` from
`CARD_CLASS`, raising the briefing to `text-xl`, restyling `PageButton` to filled blue circles, and
moving the carousel controls. Contract 0035's audit recorded that a hand-edit and a drift are
indistinguishable from inside a run; here the implementer checked rather than assumed, and left the
file alone. That is the behaviour that record was meant to produce.

### A real bug found during verification, outside the acceptance criteria

The first draft of `handleRefreshPrices` refetched via the shared `load()` helper, which resets
`quoteRefresh` to `'idle'` whenever it is not `'running'`. Both updates batched into one React
render, so the reset ran after the `'done'` write and erased the success message before it painted.
Caught by reading `document.body.innerText` after a live click rather than by reading the code —
the button looked right, the message simply never appeared. Fixed by calling `getUniverse()`
directly, which also removes a spurious loading flash on every click.

### Side effect of verification — this morning's window is pre-claimed

The sweep was exercised with an injected `now_et` of 10:00 ET on 2026-09-17 (the correct way to test
a clock-injected function), which wrote a real claim of `2026-09-17 14:00 UTC`. At the time of audit
the real clock was 02:05 ET the same day, so that claim sits ~8 hours in the future and the 09:30
window will be skipped. The 12:00 window fires instead and fetches the same bars, since
`last_completed_session` before 16:00 resolves to Wednesday either way. Self-correcting; clearable
with the snippet in Human verification point 6.

**Testing a clock-injected function against the real database writes real state.** Worth an explicit
instruction in any future contract whose verification advances a stored timestamp.
