# Contract 0042 — Close the add/refresh seam: no zero-bar members, and refresh can heal one

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Three fixes in one seam:

1. `add()` refuses a ticker whose history fetch produced no bars, instead of writing a membership
   row that nothing can ever repair.
2. `refresh()` can first-fetch a member that already has no history, so an existing empty ticker
   heals itself.
3. A ticker added after 16:00 ET is not left a session behind the rest of the universe.

Backend only. No migration, no new dependency, no frontend change.

## Why

Found 2026-09-17 while repairing damage from a mistimed cleanup command. The repair failed, and the
reason it failed is a real defect.

### The unrecoverable state

`app/universe.py:add()` ends like this — the membership row is written **unconditionally** after
`fetch_history` returns:

```python
start = _history_start(date.today())
fetch_history(key, start=start, end=None)
fetch_fundamentals(key)
with session() as db:
    ...db.add(UniverseTicker(ticker=key, active=True))...
```

Nothing checks that any bars landed. So:

1. `symbol_has_history(key)` passes — Yahoo confirms the symbol exists
2. `fetch_history` returns an **empty** frame — one transient Yahoo hiccup is enough
3. the membership row is written anyway
4. the ticker sits in the table with no coverage, no price, no fundamentals

And it can never recover, because `refresh()` cannot first-fetch:

```python
# freshness.missing_range
"""...For stored empty or None, returns None — a first fetch is the caller's job,
not a repair."""
```

`missing_range(None, last_session)` returns `None`, so `refresh_ticker` falls into its
`summary("none", ...)` branch. **The auto-refresh sweep will no-op on that ticker every window,
forever.** The only recovery is delete-and-re-add, which a user has no way to guess at.

Measured: calling `refresh("TSLA")` against a member with 0 bars returned
`action: none, bars_after: 0`. Repair required `remove()` then `add()`.

**This matters more than it looks because portfolios come next.** Portfolio math reads `price_bars`;
a silently-empty member yields garbage covariance rather than an error.

### The off-by-one-session add

`fetch_history(key, start=start, end=None)` — and `REBUILD.md` records that **`yf.download`'s `end`
is EXCLUSIVE**. With `end=None` yfinance defaults to today, exclusive, so the fetch stops at
*yesterday*. Before 16:00 ET that is correct; after 16:00 today's completed session is silently
skipped.

Measured 2026-09-17 at 22:18 ET: `AMD` and `TSLA`, both added that evening, sat at `2026-09-16` while
the other 20 tickers were at `2026-09-17`. Self-heals at the next 09:30 window, so this is the least
severe of the three — but it is the same seam.

**Do not fix it by passing `end=date.today()`.** `_download_history` adds a day to make `end`
inclusive (contract 0012), so that would pull **today's partial in-progress bar** before 16:00 and
store it as a completed session — exactly the AAPL null-close incident that contract 0024 fixed. The
16:00 cutoff in `last_completed_session` exists for this. Reuse it; do not reimplement it.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network, no database and no `GEMINI_KEY`.** Never call yfinance in a test —
patch `fetch_history`, `symbol_has_history` and `refresh_ticker`.

**If a command fails with `password authentication failed`, or the frontend shows "API offline" while
the server logs 200s**, your shell has a stale exported `DATABASE_URL` or `CORS_ORIGINS`. As of
contract 0041 a conflict raises at import and names the variable.

## Files

Modify:
- `backend/app/universe.py`
- `backend/app/routers/universe.py`
- `backend/tests/test_universe.py`
- `backend/tests/test_api_universe.py`

**Touch nothing else.** Not `app/market_data.py`, `app/freshness.py`, `app/cache.py`, `app/db.py`,
`app/config.py`, `app/news.py`, `app/briefing.py`, `app/autorefresh.py`, `app/schedule.py`,
`app/quotes.py`, `app/strip.py`, `app/models.py`, `app/schemas.py`, `app/main.py`, `tests/conftest.py`,
any migration, or **anything under `frontend/`**.

**No migration. No schema change. No new dependency.**

## 1. Reject a zero-bar add

New exception in `app/universe.py`, beside the existing three:

```python
class HistoryUnavailable(Exception):
    """Raised when a symbol validates but its history fetch returned no bars."""
```

In `add()`, `fetch_history` already **returns** the normalized frame — use it:

```python
stored = fetch_history(key, start=start, end=None)
if stored is None or stored.empty:
    evict(key)
    raise HistoryUnavailable(f"No price history returned for {key}; not added")
```

**The `evict(key)` is load-bearing.** `fetch_history` calls `store(ticker, normalized)`
unconditionally, so an empty frame is written into `cache.py`'s 24-hour `TTLCache`. Leave it there and
a retry within the same day gets the cached *empty* frame from memory, `missing_range` returns `None`
against it, and the repair path in part 2 cannot work either. Import `evict` from `app.cache`.

Raise **before** the membership row is written. `add()`'s docstring already states the invariant —
*"validate before writing, so an unknown symbol leaves no membership row behind"* — this extends it
from "unknown symbol" to "no usable data".

### Router

Map `HistoryUnavailable` to **502**, alongside the existing `AlreadyPresent`→409 and
`UnknownSymbol`→404 on `POST /universe`.

502 rather than 404: the symbol genuinely exists, so this is an upstream failure, not a missing
resource. 503 is already taken by "no database configured".

**Contract 0041 made the frontend retry 502 — that is safe here.** The retry is GET-only and this is
a POST, so `retryDelaysMs` is `[]` and nothing retries. **Confirm that in the report** rather than
assuming it.

## 2. `refresh()` heals a member with no history

In `app/universe.py:refresh()`, after the membership check and **before** `refresh_ticker`:

```python
stored = get_cached(key)
if stored is None or stored.empty:
    fetch_history(key, start=_history_start(date.today()), end=None)
```

Then continue into `refresh_ticker(key, history_start=HISTORY_START)` exactly as now — which will
catch up the current session and backfill.

**Do not change `refresh_ticker` or `missing_range`.** Their documented contract — *"a first fetch is
the caller's job, not a repair"* — stays true; `universe.refresh()` is that caller, and it is already
the layer that owns `HISTORY_START`. Changing `freshness.py` would alter a pure function relied on by
four other call sites.

**A failed heal must not raise.** If the fetch still returns nothing, fall through and let
`refresh_ticker` report `bars_after: 0`. `refresh()` is called from the auto-refresh sweep, which
catches per-ticker exceptions and logs them; raising here would turn a bad ticker into log noise every
window without fixing anything. Honest zero beats an exception.

## 3. Don't leave a new ticker a session behind

At the end of `add()`, after the first fetch and **before** writing the membership row, call:

```python
refresh_ticker(key, history_start=HISTORY_START)
```

That is the whole fix. `refresh_ticker` derives the last completed session through
`_cached_last_session`, which applies the 16:00 ET cutoff, so:

- added before 16:00 → the session logic agrees with `end=None` and this is a no-op
- added after 16:00 → it fetches the one missing day

Cost is one reference-ticker fetch, already cached per *(ET date, past-4pm)*, plus at most one range
fetch. `add()` already takes seconds.

**Reuse, do not reimplement.** Computing an end date inline here would duplicate the 16:00 cutoff in a
second place, and the two would drift.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **354**.
2. **The central test**: `add()` with `symbol_has_history` patched True and `fetch_history` patched to
   return an empty DataFrame raises `HistoryUnavailable` **and leaves no row in `universe_tickers`**.
   Assert on the table, not on the exception alone.
3. A test asserts that same path calls `cache.evict` — spy on it. Without this, a same-day retry is
   poisoned by the cached empty frame.
4. A test asserts `refresh()` on a member whose stored history is empty calls `fetch_history` —
   spy on it. **It must fail against the current code**, where `refresh` never first-fetches.
5. A test asserts `refresh()` **does not raise** when the heal fetch also returns empty, and the
   returned summary reports 0 bars.
6. A test asserts `add()` calls `refresh_ticker` with `history_start=HISTORY_START` — spy on it.
7. `POST /universe` returns **502** when `add` raises `HistoryUnavailable`, and still 409 for
   `AlreadyPresent` and 404 for `UnknownSymbol`. Three assertions.
8. `git diff --stat backend/app/market_data.py backend/app/freshness.py backend/app/cache.py backend/app/models.py backend/app/schemas.py backend/app/news.py`
   is empty — in particular `missing_range` is untouched.
9. `grep -n "date.today()" backend/app/universe.py` — every match is a `_history_start(date.today())`
   call, **not** an `end=` argument. Quote each match.
10. `ls backend/migrations/versions/` still shows exactly **seven**.
11. `git status --porcelain` lists nothing outside this contract's four files.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "class HistoryUnavailable" backend/app/universe.py
grep -n "HistoryUnavailable" backend/app/routers/universe.py
grep -n "date.today()" backend/app/universe.py
grep -n "evict" backend/app/universe.py
ls -1 backend/migrations/versions/
git diff --stat backend/app/market_data.py backend/app/freshness.py backend/app/cache.py ; echo "(empty = untouched)"
git status --porcelain
```

Plus proof that the heal path works against the **real** database, on a throwaway ticker only:

```bash
# Add a ticker you do not want, then empty its bars behind its back to simulate the bad state.
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from sqlalchemy import delete, select, func
from app.db import session
from app.models import PriceBar
from app.cache import evict
from app.universe import add, refresh, remove
add('KO')
with session() as db:
    db.execute(delete(PriceBar).where(PriceBar.ticker == 'KO'))
evict('KO')
with session() as db:
    print('bars after sabotage:', db.execute(select(func.count()).select_from(PriceBar).where(PriceBar.ticker=='KO')).scalar())
refresh('KO')
with session() as db:
    print('bars after refresh  :', db.execute(select(func.count()).select_from(PriceBar).where(PriceBar.ticker=='KO')).scalar())
remove('KO')
print('cleaned up')"
```

**Deliberately not `DATABASE_URL=\"\"`** — it must hit the real database. Expect `0` then a few
thousand. **Use a ticker not already in the universe** — `KO` is not, as of 2026-09-17. It removes it
again at the end; if the script fails midway, delete it through the UI.

## Human verification — does Gunnar need to run anything?

**Light.** The behaviour is mostly invisible when working correctly.

1. Restart uvicorn with `--reload`.
2. Add a ticker **after 16:00 ET** and check its `Coverage` column — the right-hand date should match
   the other rows, not be a day behind. Before this contract it was a day behind. Delete it after.
3. Add a nonsense symbol (`ZZZZQQ`) — still a clean `Unknown symbol` 404, unchanged.
4. `AMD` and `TSLA` are currently a session behind from before this fix; they self-heal at the next
   09:30 window. Confirm they have caught up, then this contract's part 3 is what stops it recurring.

## Out of scope

- No change to `freshness.py`, `market_data.py` or the 16:00 cutoff.
- No retry or backoff around a failed history fetch — refusing the add is the fix; retrying is a
  separate decision.
- No UI change. `POST /universe` returning 502 surfaces through the existing `AddTickerForm` error
  line with no work.
- No backfill sweep to find already-broken members. There are none right now — verified 2026-09-17,
  all 22 active tickers have bars.
- No change to `active`, to the delete path, or to the news pipeline.

## Open questions — do NOT resolve these yourself

- **Whether `add()` should retry a failed history fetch** before refusing. Refusing is honest and
  cheap; retrying might be kinder.
- **Whether `_cached_last_session` deserves a fallback reference ticker.** Still the largest remaining
  single point of failure: one throttled reference fetch makes the whole sweep no-op at any universe
  size.
- **Whether `fetch_history` should refuse to `store()` an empty frame at all**, which would make the
  `evict` in part 1 unnecessary. That is `market_data.py`, out of scope here.
- **What happens to the four `Coming soon` cards.** Still open.
