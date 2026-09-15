# Contract 0016 — Backfill history to `HISTORY_START` on refresh

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Refreshing a ticker extends its history **backwards** to `HISTORY_START` as well as forwards to the
last completed session — and stops asking once it has everything.

## Why

`universe.py` defines `HISTORY_START = date(2016, 1, 1)`, and `add` honours it. But `refresh_ticker`
only ever extends forward: `missing_range` returns `(newest_stored, last_session)` and there is no
backward equivalent. So tickers added before `HISTORY_START` existed — fetched with the old
ten-years-back rule, starting 2016-09-13 — will never gain the missing months, and lowering
`HISTORY_START` later would have no effect on anything already stored.

`reference files/old_yfinance_project/YF.py:496-561` did both edges (`need_prepend` / `need_append`).
Contract 0007 carried over that file's drift detection and 4pm rule and took only the forward half.

**The design trap, and why the obvious rule is wrong.** `HISTORY_START` is a calendar date and
January 1st is never a trading day. Measured 2026-09-14:

```
MSFT: request start 2016-01-01 → earliest bar returned is 2016-01-04
SPY : request start 2016-01-01 → earliest bar returned is 2016-01-04
RDDT: request start 2016-01-01 → nothing (IPO'd 2024)
```

So `first_bar > HISTORY_START` is **permanently true for every ticker**. A rule built on it would
re-probe all eight tickers on every Update All, fetch nothing, and do it again — contract 0012's
non-termination bug reincarnated, from the same shared Render IP that got crumb-throttled in 0013.

**The fix is to compare against the earliest real session, not the calendar date.** The reference
ticker already answers the other end of this question (`last_completed_session`); it answers this end
too. `earliest_session_on_or_after(2016-01-01)` is `2016-01-04`, and once a ticker's `first_bar`
equals that, it is done. **This value never changes**, so it is fetched once and cached.

**Accepted residue:** a genuinely young ticker (RDDT, `first_bar` 2024-03-21) stays permanently
greater than `2016-01-04` and re-probes **once per refresh**, getting nothing. That is one wasted
request per young ticker, bounded and visible. The alternative — persisting a per-ticker
"already asked from" date — needs a migration and a column whose semantics are subtle enough to be
misread later. `REBUILD.md` says to defer that kind of thing until there is a measurement justifying
it. There isn't yet.

**Depends on contracts 0007, 0008, 0012.** If `app/freshness.py` has no `missing_range`, or
`_download_history` does not add a day to `end`, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## Files

Modify:
- `backend/app/freshness.py` — two new pure functions
- `backend/app/market_data.py` — cached earliest-session lookup; `refresh_ticker` gains a prepend
- `backend/app/universe.py` — `refresh` passes `HISTORY_START`
- `backend/app/schemas.py` — one new field on `RefreshResult`
- `backend/tests/test_freshness.py`
- `backend/tests/test_universe.py`

**Touch nothing else.** No migration, **no new column, no `universe_tickers` change** — this design
deliberately avoids persistence. Do not modify `app/cache.py`, `app/db.py`, `app/models.py`,
`app/routers/`, any migration, `tests/conftest.py`, `tests/test_cache.py`, or anything under
`frontend/`. No new dependencies. If the work appears to require a file not on this list, stop and
report `BLOCKED`.

## Interface

### `freshness.py` — two pure functions

```python
def earliest_session_on_or_after(history_start: date, reference_bars: pd.DataFrame) -> date | None:
    """The first session in reference_bars on or after history_start, or None when the frame is
    empty or every bar precedes history_start."""

def prepend_range(stored: pd.DataFrame | None, earliest_session: date) -> tuple[date, date] | None:
    """The (start, end) to fetch to extend stored backwards, or None when nothing is missing.
    Both bounds INCLUSIVE."""
```

Both pure — no network, no database, no clock. Same discipline as the rest of the module.

`prepend_range` rules:

- `None` when `stored` is `None` or empty. A first fetch is `add`'s job, not a repair.
- `None` when `first_bar <= earliest_session` — **this is the termination condition.**
- Otherwise `(earliest_session, first_bar - 1 day)`.

**`end` is `first_bar - 1 day`, not `first_bar`.** `_download_history` adds a day on the way out
(contract 0012), so passing `first_bar` would refetch the bar already held. Harmless under the
upsert, but wasteful and it muddies the bar-count arithmetic. If `first_bar - 1 day <
earliest_session`, return `None`.

### `market_data.py`

```python
def _cached_earliest_session(history_start: date) -> date | None
def refresh_ticker(ticker: str, force: bool = False, history_start: date | None = None) -> dict
```

- `_cached_earliest_session` fetches the reference ticker over a **narrow window** —
  `history_start` to roughly `history_start + 30 days`, not full history — and caches by
  `history_start` in a module-level `TTLCache(maxsize=8, ttl=86400)`, mirroring
  `_cached_last_session`. The value is immutable, so N tickers cost **one** fetch.
- `history_start=None` means **no prepend attempt at all.** That is the default, so every existing
  caller and every existing test keeps its current behaviour unchanged.

**Order of operations in `refresh_ticker`:**

1. Existing forward logic, unchanged — session derivation, staleness, `missing_range`, drift, store.
2. Then, if `history_start is not None`: resolve `_cached_earliest_session`, compute
   `prepend_range` against the **current** stored frame, and if non-`None`, fetch and store.
3. A prepend runs **even when the forward path returned `action="none"`.** A ticker can be current
   at the front and short at the back; that is the exact case this contract exists for.

**Storing a prepend must concatenate with the existing frame**, exactly as the append path already
does:

```python
combined = pd.concat([fresh, stored])
combined = combined[~combined.index.duplicated(keep="last")].sort_index()
store(ticker, combined)
```

Calling `store(ticker, fresh)` with only the prepended chunk would **replace the TTL cache entry
with just those bars**, and a subsequent `get_cached` would return a frame missing ten years of
recent history. The database would still hold everything, but the in-process cache would lie until
its TTL expired. This is the single most dangerous mistake available in this contract.

### `schemas.py`

Add to `RefreshResult`:

```python
bars_prepended: int
```

`action` keeps its existing values — it describes the forward path. Overloading it with a prepend
outcome would break the frontend's existing reading of it. `bars_prepended` is additive and the
frontend simply ignores it.

### `universe.py`

`refresh` passes `HISTORY_START` into `refresh_ticker`. `add` is unchanged — it already fetches from
`HISTORY_START`.

## Testing

No network, no database. Monkeypatch `_download_history`; build frames directly.

Required cases:

1. `earliest_session_on_or_after` returns the first bar on or after the date — reference bars on
   2016-01-04/05/06 with `history_start` 2016-01-01 → `2016-01-04`.
2. Returns `None` for an empty frame, and `None` when every bar precedes `history_start`.
3. Returns the exact date when a bar falls **on** `history_start`.
4. `prepend_range(stored starting 2016-09-13, earliest 2016-01-04)` → `(2016-01-04, 2016-09-12)` —
   **end is one day before `first_bar`.**
5. `prepend_range` returns `None` when `first_bar == earliest_session` — the termination condition.
6. `prepend_range` returns `None` when `first_bar < earliest_session`.
7. `prepend_range` returns `None` for `None`/empty stored.
8. **Termination, and the reason this contract has a test section at all.** Stored from 2016-09-13;
   a fake downloader that serves bars from 2016-01-04 honouring yfinance's exclusive `end`. After
   one `refresh_ticker(..., history_start=...)`, `first_bar` is `2016-01-04`; a **second** call
   performs **no prepend download** — assert on a call counter, not on the bar count.
9. **The TTL-cache trap.** After a prepend, `get_cached(ticker)` returns a frame containing **both**
   the prepended bars and the pre-existing recent bars. Assert `first_bar`, `last_bar` and the total
   count — a frame holding only the prepended chunk must fail this.
10. A young ticker: `first_bar` 2024-03-21, `earliest_session` 2016-01-04, downloader returns an
    empty frame. `refresh_ticker` does not raise, stores nothing, and `bars_prepended == 0`.
11. `history_start=None` performs no prepend and no earliest-session fetch at all.
12. A prepend happens even when the forward path is `action="none"`.
13. N tickers refreshed in sequence cost **one** earliest-session reference fetch, not N — assert a
    call counter, as contract 0012's fix does for `_cached_last_session`.
14. Existing contract 0007 and 0012 freshness tests pass unmodified.

## Out of scope

- **No migration, no new column, no persistence of "already asked from".** Deliberate — see Why.
- No change to `missing_range`, `is_stale`, `last_completed_session`, `pick_drift_anchors`,
  `detect_drift`.
- No `add` change — it already uses `HISTORY_START`.
- No frontend change. `bars_prepended` is additive and ignored by the existing client.
- No bulk-refresh change. The frontend loops over the per-ticker endpoint (contract 0014); prepending
  is per-ticker and needs nothing there.
- No retry, backoff, or rate limiting.
- No `pandas_market_calendars`.
- Do not "fix" the young-ticker re-probe. It is accepted and documented.

## Acceptance criteria

0. Only the six listed files changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 120.
2. All fourteen cases present.
3. `git diff --stat backend/app/models.py backend/app/cache.py backend/app/db.py backend/app/routers/ backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt frontend/`
   is empty.
4. `ls backend/migrations/versions/` shows exactly three revisions — no new migration.
5. `grep -n "first_bar - \|timedelta(days=1)" backend/app/freshness.py` shows the one-day-back
   computation in `prepend_range`.
6. `grep -rnE "except\s*:|except Exception" backend/app/freshness.py backend/app/market_data.py`
   matches nothing (exit 1).
7. `grep -rnE "datetime\.now|date\.today|utcnow" backend/app/freshness.py` matches nothing outside a
   docstring — the pure functions still take time as an argument.
8. Degraded mode intact: with `DATABASE_URL` unset the app imports and `/health` returns 200.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "prepend_range" backend/app/freshness.py backend/app/market_data.py
grep -rnE "except\s*:|except Exception" backend/app/freshness.py backend/app/market_data.py ; echo "exit=$? (1 means clean)"
git diff --stat backend/app/models.py backend/app/cache.py backend/app/db.py backend/app/routers/ backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt frontend/ ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "
from datetime import date
import pandas as pd
from app.freshness import prepend_range, earliest_session_on_or_after
idx = pd.to_datetime(['2016-09-13','2016-09-14']).astype('datetime64[us]'); idx.name='date'
stored = pd.DataFrame({'close':[1.0,2.0]}, index=idx)
print('prepend_range  ->', prepend_range(stored, date(2016,1,4)), '(expect (2016-01-04, 2016-09-12))')
idx2 = pd.to_datetime(['2016-01-04','2016-01-05']).astype('datetime64[us]'); idx2.name='date'
print('termination    ->', prepend_range(pd.DataFrame({'close':[1.0,2.0]}, index=idx2), date(2016,1,4)), '(expect None)')
ref = pd.DataFrame({'close':[1.0,2.0]}, index=idx2)
print('earliest sess  ->', earliest_session_on_or_after(date(2016,1,1), ref), '(expect 2016-01-04)')"
```

## Human verification — does Gunnar need to run anything?

**Yes — this is the whole point of the contract and it is directly visible in the table.**

Several tickers currently have coverage starting `2016-09-13` (added under the old ten-years-back
rule); AAPL, added after `HISTORY_START`, starts `2016-01-04`.

With backend and frontend running, at `localhost:5173/universe`:

1. Note which rows show `2016-09-13` in the **Coverage** column.
2. Click **Update all**.
3. Those rows should now read **`2016-01-04 → …`** and their bar counts should rise by roughly 175.
4. Click **Update all** a second time. **Nothing should change, and it should finish noticeably
   faster** — that is the termination condition working. If coverage keeps "updating" or the run
   takes as long as the first, the prepend is not terminating and that is a bug.

Expect the first run to be slow: eight tickers, sequential, each fetching ~9 months of extra history.

## Open questions — do NOT resolve these yourself

- **Persisting "already asked from" per ticker**, to stop young tickers re-probing. Deferred until
  there is a measurement showing it matters. Do not add a column.
- **Whether `HISTORY_START` should be configurable** rather than a module constant. Out of scope.
- **Whether `action` should report prepend outcomes.** It should not — `bars_prepended` carries that.
- **Bulk-refresh cost once the universe is large.** Sequential refresh over 50 tickers is slow by
  design; do not parallelise it.
