> ## ⚠ REVISED 2026-09-28 — re-read this file before executing
>
> The first run was audited. **All production code and every other test are accepted as they
> stand. Do not change them.** Two things changed:
>
> 1. **Criterion 5's grep was the planner's error, not yours.** It searched for the literal
>    `@router.get("/{ticker}")`, but the real line is `@router.get("/{ticker}", response_model=UniverseDetail)`,
>    so it could never match. Your route order (278 < 284) is correct, and **you were right not to
>    edit that line to make the grep pass**. The criterion now greps `@router.get("/{ticker}"` without
>    the closing parenthesis. No code change follows from this.
> 2. **The single remaining task is to strengthen one test.** `test_manual_refresh_keeps_an_existing_window_claim`
>    in `backend/tests/test_autorefresh_manual.py` asserts only that the claim is unchanged. Criterion 2(i)
>    also requires proving the sweep **ran anyway**. As written, a `run_manual_refresh` that returned
>    early on a claimed window would pass, and running on a claimed window is the whole reason the
>    button exists. Add one active ticker (`_add_ticker("AAPL")`) and a recording `refresh` monkeypatch.
>    Then assert that the recorder saw `["AAPL"]` **and** that `_latest_run()["job_name"] == MANUAL_JOB_NAME`,
>    alongside the existing claim assertion.
>
> Edit **only** that test function. `backend/tests/test_autorefresh_manual.py` is the only file this
> revision touches. Then re-run the full verification block and report.

# Contract 0121: a "Force update" for the universe on `/ops`, plus a sweep-status signal

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract:

- `POST /ops/universe/refresh` runs the universe sweep immediately, whether or not the current window has been claimed. It returns `202` when it starts and `409` when a sweep is already running.
- `GET /universe/sweep_status` and `GET /ops/status` (`universe.sweep_active`) report whether a sweep is running or about to start.
- `/ops`'s System Health card has a **Force update** button that starts the sweep, waits for it to finish, and then reloads System Health and Job history.

## Why

**On 2026-09-28 Gunnar saw Coverage at 9/25 after the close, and nothing was actually broken.** From the deployed `/ops/job_runs`:
- The first visit after 16:00 ET started the 16:00 window's sweep at 16:46:56. It fetched all 26 tickers one at a time, which took 145 s.
- The news refresh started at the same moment and finished in 11 s.
- He looked at the page in that ~2-minute gap. Every ticker was at 9/28 by 16:49.

That display gap is contract 0122. This contract handles the case the gap exposed.

**The real hole: a claimed window whose work is lost.** `run_auto_refresh_if_due` writes the `app_state` claim *before* sweeping and never rolls it back (REBUILD.md, "Claim the window before doing the work"). That is correct for a *failing* sweep. For a sweep *killed* partway through, it is the wrong outcome:
- A Render redeploy or restart during a 145 s sweep loses the work.
- The 16:00 window stays claimed.
- Nothing retries until 09:30 the next morning.

There is no way to recover from that today short of waiting. `POST /universe/{ticker}/refresh` still exists, but nothing calls it and it covers only one ticker.

**What this button deliberately does not do: re-download bars that are already current.** It calls `app.universe.refresh(ticker)` exactly as the scheduled sweep does. It never passes `force=True`. That keeps a click on this public, unauthenticated button cheap:
- one reference-ticker (SPY) fetch,
- one batched quote request,
- 26 no-op staleness checks.

`force=True` would cost 26 history downloads per click. The freshness rule is the only thing protecting this write surface from abuse (REBUILD.md, "No write gate"). Gunnar chose this on 2026-09-28. Whether 16:00:xx closes need a second look is a separate open question in REBUILD.md, not part of this contract.

## Files

Modify:

- `backend/app/market_data.py`: add `clear_last_session_cache()`.
- `backend/app/autorefresh.py`: add `try_begin_manual_refresh`, `run_manual_refresh`, `is_sweep_active` and `MANUAL_JOB_NAME`. Share the per-ticker loop between the automatic and manual paths.
- `backend/app/ops.py`: add `universe.sweep_active` to `system_health()`, in both the enabled and the not-enabled branch.
- `backend/app/schemas.py`: add `ForceRefreshStarted` and `SweepStatus`. Add `sweep_active: bool` to `OpsUniverseStatus`.
- `backend/app/routers/ops.py`: add the `POST /ops/universe/refresh` route and update the module docstring. The router is no longer read-only.
- `backend/app/routers/universe.py`: add `GET /universe/sweep_status`, **declared above `@router.get("/{ticker}")`**.
- `backend/tests/test_ops.py` and `backend/tests/test_api_ops.py`: change only the two dict-equality assertions described under Interface, and append new tests to `test_api_ops.py`.
- `frontend/src/api/client.ts`: add `ForceRefreshStarted`, `SweepStatus`, `forceUniverseRefresh()` and `getSweepStatus()`, and add `sweep_active` to `OpsUniverseStatus`.
- `frontend/src/components/SystemHealthCard.tsx`: add the button, its polling and an `onSweepFinished` prop.
- `frontend/src/pages/OpsPage.tsx`: remount `JobRunsCard` when a forced sweep finishes.

Create:

- `backend/tests/test_autorefresh_manual.py`: tests for the three new autorefresh functions.
- `frontend/src/lib/sweepWatch.ts`: `watchSweep`, the one polling loop. This contract's `SystemHealthCard` uses it, and so does contract 0122's `UniversePage`.
- `frontend/src/lib/sweepWatch.test.ts`: its tests.

**`backend/tests/test_autorefresh.py` is not on this list and must stay byte-identical.** The existing automatic-path tests passing unmodified is how this contract proves the refactor preserved behaviour.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work needs; that is what it is for. But it is a snapshot of other working software, kept so its behaviour can be compared against this rebuild, and an edited reference stops being evidence of anything. `.claude/settings.json` denies Edit and Write there. That deny list cannot see a shell redirect, `sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the correct answer to a contract that cannot be satisfied as written**, for example if two criteria contradict each other or the code differs from what this contract quotes. Do not find a clever way to pass it. Report the conflict and stop.

## Interface

### `backend/app/market_data.py`

```python
def clear_last_session_cache() -> None:
    """Empty _last_session_cache so the next _cached_last_session call re-derives the last
    completed session from a fresh reference-ticker download."""
```

- The body is `_last_session_cache.clear()`.
- It exists for one case. A sweep resolves the session early, e.g. at 16:00:05, before Yahoo lists today's daily bar. That cached answer then keeps every later refresh in the same hour looking at the previous session. A forced update must not inherit it.
- The cost is one SPY download per click.
- Do not touch `_earliest_session_cache`.

### `backend/app/autorefresh.py`

```python
MANUAL_JOB_NAME = "universe_refresh_manual"

def try_begin_manual_refresh() -> bool: ...
def run_manual_refresh(now_utc: datetime, now_et: datetime) -> None: ...
def is_sweep_active(now_et: datetime) -> bool: ...
```

**`try_begin_manual_refresh()`** is `_LOCK.acquire(blocking=False)` and nothing more.
- `True` means the caller now owns `_LOCK` and **must** schedule `run_manual_refresh`, which releases it.
- `False` means a sweep, automatic or manual, is already running.
- The lock is acquired on the request thread and released on the background-task thread. That is legal for `threading.Lock`, unlike `RLock`. Say so in the docstring.

**`run_manual_refresh(now_utc, now_et)`**
- Precondition: the caller holds `_LOCK` through `try_begin_manual_refresh()`.
- It **never acquires the lock itself.** Its whole body sits inside `try: ... finally: _LOCK.release()`, so the lock is released on every exit path, including an exception and the no-database early return.
- In order:
  1. If `not is_enabled()`: return. The lock is still released.
  2. `clear_last_session_cache()`.
  3. If `needs_auto_refresh(_get_state(AUTO_REFRESH_KEY), now_et)`: `_set_state(AUTO_REFRESH_KEY, now_utc)`. A manual sweep does the same work the current window's sweep would, so it counts as that window's sweep. Without this, the automatic task that lost the race for `_LOCK` returns without claiming. The window would then stay "due" after the manual sweep finished, and `is_sweep_active` would report a sweep that never comes. **Never write the claim when the window is not due**, and never roll it back.
  4. `with record_run(MANUAL_JOB_NAME, now_utc) as detail:`
     - Walk `active_universe_tickers()` through `refresh(ticker)`, exactly as the automatic sweep does. Keep the same per-ticker `except Exception` / `logger.exception` / `errors.append` discipline and the same `fundamentals_counts`.
     - Then `quotes = fetch_quotes(tickers)` and, if it is non-empty, `store_quotes(quotes, now_utc)`. This is a **forced** quote fetch, the same pair `POST /universe/quotes/refresh` uses, **not** `refresh_quotes_if_stale`. Import `fetch_quotes` from `app.quotes` and `store_quotes` from `app.cache` into `app.autorefresh` so tests can monkeypatch `app.autorefresh.fetch_quotes` and `app.autorefresh.store_quotes`.
     - Fill `detail` with the same keys the automatic sweep writes (`tickers`, `refreshed`, `errors`, `fundamentals`) plus `quotes: len(quotes)`.

**`is_sweep_active(now_et)`**
- Returns `False` when `not is_enabled()`.
- Otherwise returns `_LOCK.locked() or needs_auto_refresh(_get_state(AUTO_REFRESH_KEY), now_et)`.
- The second term covers the moment between `GET /universe/strip` scheduling the automatic sweep and that task acquiring the lock. A page that asks right after load would otherwise read "idle" and then miss the sweep entirely.
- Put that reasoning in the docstring.

**Shared loop.** Extract the per-ticker loop and the `detail` filling into one private helper used by both `run_auto_refresh_if_due` and `run_manual_refresh`. The shape is yours: pass the quote step in as a callable or return the ticker list, whichever reads cleanly.
- `run_auto_refresh_if_due` must still call `refresh_quotes_if_stale(tickers)` by that module-level name. The existing tests monkeypatch `app.autorefresh.refresh_quotes_if_stale`.
- Its `detail` keys must not change.

### Schemas (`backend/app/schemas.py`)

```python
class ForceRefreshStarted(BaseModel):
    started: bool          # always True on 202
    started_at: datetime

class SweepStatus(BaseModel):
    active: bool

class OpsUniverseStatus(BaseModel):
    active_tickers: int
    total_bars: int
    newest_bar_date: date | None
    sweep_active: bool     # new
```

### `backend/app/ops.py`

`system_health()` adds `"sweep_active": is_sweep_active(now_et)` to the `universe` dict, reusing the `now_et` it already computes. In the not-enabled branch the value is `False`.

### `backend/app/routers/ops.py`

```python
@router.post("/universe/refresh", status_code=202, response_model=ForceRefreshStarted)
def force_universe_refresh(background_tasks: BackgroundTasks) -> dict:
```

1. `_require_database()`. With no database configured this returns 503 and never touches the lock.
2. Compute `now_utc = datetime.now(timezone.utc)` and `now_et = datetime.now(ZoneInfo("America/New_York"))` **before** acquiring. Nothing that can raise may sit between a successful acquire and `add_task`, or the lock leaks for the life of the process.
3. `if not try_begin_manual_refresh(): raise HTTPException(status_code=409, detail="A universe refresh is already running")`.
4. `background_tasks.add_task(run_manual_refresh, now_utc, now_et)`.
5. `return {"started": True, "started_at": now_utc}`.

### `backend/app/routers/universe.py`

```python
@router.get("/sweep_status", response_model=SweepStatus)
def get_sweep_status() -> dict:
    _require_database()
    return {"active": is_sweep_active(datetime.now(ZoneInfo("America/New_York")))}
```

It is **declared above `@router.get("/{ticker}")`**. Otherwise it resolves as a ticker named `SWEEP_STATUS` and 404s, the trap contracts 0020, 0028 and 0029 hit. This contract only exposes the route; contract 0122 is its consumer.

### The two existing assertions that must change

`tests/test_ops.py:66` and `tests/test_api_ops.py:56` compare the whole `universe` dict. On an empty database `sweep_active` depends on the wall clock: `needs_auto_refresh(None, now_et)` is `True` inside any window. So **do not** pin it to `False`. Replace each assertion with:

```python
universe = dict(health["universe"])   # body["universe"] in test_api_ops.py
assert isinstance(universe.pop("sweep_active"), bool)
assert universe == {"active_tickers": 0, "total_bars": 0, "newest_bar_date": None}
```

Change nothing else in those two files except appending new tests to `test_api_ops.py`.

### Frontend

**`client.ts`:**

```ts
export interface ForceRefreshStarted { started: boolean; started_at: string }
export interface SweepStatus { active: boolean }
export async function forceUniverseRefresh(): Promise<ForceRefreshStarted>   // POST /ops/universe/refresh
export async function getSweepStatus(): Promise<SweepStatus>                  // GET /universe/sweep_status
```

Add `sweep_active: boolean` to `OpsUniverseStatus`. `request()` already never retries a POST; leave it that way.

**`lib/sweepWatch.ts`:** pure of React, so the timer logic can be tested with vitest fake timers instead of by watching a page.

```ts
export interface WatchSweepOptions<T> {
  poll: () => Promise<T>
  isActive: (result: T) => boolean
  onUpdate?: (result: T) => void               // every resolved poll, active or not, before the finished check
  onFinished: (result: T, polls: number) => void
  onTimeout: () => void
  intervalMs: number
  timeoutMs: number
}
export function watchSweep<T>(options: WatchSweepOptions<T>): () => void   // returns cancel
```

- The first `poll()` is called **synchronously inside `watchSweep`**, with no initial delay.
- A poll that resolves with `!isActive(result)` calls `onFinished(result, pollsSoFar)` once and ends the watch.
- A poll that resolves active, or that rejects, schedules the next poll after `intervalMs` using the global `setTimeout`.
- There are at most `1 + Math.floor(timeoutMs / intervalMs)` polls. If the last one still resolves active or rejects, `onTimeout()` fires once and the watch ends.
- A rejection is never surfaced. It counts as a poll and is otherwise ignored.
- `cancel()` clears any pending timer. **No callback fires after `cancel()`**, including from a poll already in flight when cancel was called.

**`SystemHealthCard.tsx`:**
- New prop `onSweepFinished?: () => void`.
- A **Force update** button sits in the header row, immediately left of the existing Refresh button, styled identically. It is disabled while a forced sweep is being watched, and while `state.status === 'loading'`.
- **On click:**
  - A `202` enters a "watching" state.
  - A `409` also enters "watching". A sweep is running, and watching it finish is the useful thing to do.
  - Any other error shows inline in the card as `text-brand-negative`, consistent with how this card already shows errors (REBUILD.md, "/ops's cards show their errors").
- **While watching,** call `watchSweep` with:
  - `poll: getOpsStatus`
  - `isActive: (s) => s.universe.sweep_active`
  - `onUpdate`: set the card's `ready` state from the response
  - `onFinished`: leave watching and call `onSweepFinished?.()`
  - `onTimeout`: leave watching and show the inline note `Still running — check Job history shortly.`
  - `intervalMs: 5000`
  - `timeoutMs: 600000`

  The button label reads `Updating…` while watching.
- **Unmount** calls the returned `cancel`. No `setState` after unmount, and no further requests. Hand-rolled `setInterval`/`setTimeout` polling in this component is not acceptable; the loop lives in `watchSweep`.

**`OpsPage.tsx`:** holds a `jobRunsVersion` counter, renders `<JobRunsCard key={jobRunsVersion} />`, and passes `onSweepFinished={() => setJobRunsVersion((v) => v + 1)}` to `SystemHealthCard`. Remounting through `key` is the whole mechanism. **Do not add props to `JobRunsCard`**; it is not on the file list.

## Out of scope

- **No `force=True` anywhere.** Nothing re-downloads a current bar. See Why.
- Do not change `WINDOW_TIMES`, `last_completed_session`'s 16:00 cutoff, or `QUOTE_TTL_MINUTES`.
- Do not add a cooldown, rate limit or auth to the new route. `_LOCK` serialises runs, and a run over current data costs two Yahoo requests.
- Do not touch `UniversePage` or the Universe's `Refresh prices` button. That is contract 0122.
- Do not remove `POST /universe/{ticker}/refresh` or `refreshTicker`.
- Do not change `JobRunsCard`, `opsFormat.ts` or `jobrun.py`. `summariseDetail` already renders unknown detail keys generically, so `quotes` shows up without a change.
- No new dependencies.

## Acceptance criteria

1. `cd backend && pytest -q` exits 0, including the untouched `tests/test_autorefresh.py`.
2. `tests/test_autorefresh_manual.py` covers each of the following in its own test:
   - (a) `try_begin_manual_refresh()` returns `True` and then `False` while held. `_LOCK` is released at the end of the test, e.g. through a `try/finally` in the test itself, so later tests are not poisoned.
   - (b) `run_manual_refresh` releases `_LOCK` after a normal run, after the first ticker's `refresh` raises, and after `fetch_quotes` raises. Assert `_LOCK.locked() is False` after each.
   - (c) `run_manual_refresh` with no database configured returns and releases the lock.
   - (d) It calls `clear_last_session_cache`. Monkeypatch `app.autorefresh.clear_last_session_cache` with a recorder.
   - (e) It calls `refresh` once per active ticker, never with a `force` argument. The fake `refresh` accepts only `(ticker)`, so any extra argument raises `TypeError`.
   - (f) It calls `fetch_quotes` with the active ticker list and `store_quotes` with its result, and **never** calls `refresh_quotes_if_stale`. Monkeypatch it with a function that raises.
   - (g) It writes a `job_runs` row with `job_name == "universe_refresh_manual"` and `detail["quotes"]` equal to the fake quote count.
   - (h) Inside a due window (`now_et = datetime(2026, 9, 16, 10, 0, tzinfo=ET)`, no claim), it writes the `auto_refresh` claim equal to `now_utc`.
   - (i) Inside an already-claimed window, it runs the sweep anyway **and** leaves the stored claim unchanged. Set the claim to a timestamp after the window opened and assert it is identical afterwards.
   - (j) `is_sweep_active` returns `True` while `_LOCK` is held, `True` inside a due unclaimed window, `False` inside a claimed window with the lock free, and `False` with no database.
3. New tests appended to `test_api_ops.py`:
   - `POST /ops/universe/refresh` returns 202 with `started is True` when the lock is free. Monkeypatch `app.routers.ops.run_manual_refresh` to a recorder that releases `_LOCK`, since `TestClient` runs background tasks inline.
   - It returns 409 while the test holds `_LOCK`, and the lock is released in `finally`.
   - It returns 503 with no database, and `_LOCK.locked()` is `False` afterwards.
4. A test (in `test_api_ops.py` or `test_api_universe.py`; if the latter, it must be added to the file list. Prefer `test_api_ops.py`) asserts that `GET /universe/sweep_status` returns 200 with a boolean `active`, **not** 404. That is the route-ordering proof.
5. `grep -n '@router.get("/sweep_status"' backend/app/routers/universe.py` prints a line number **lower** than `grep -n '@router.get("/{ticker}"' backend/app/routers/universe.py` (no closing parenthesis; the real line continues `, response_model=UniverseDetail)`).
6. `grep -rn "force=True" backend/app/autorefresh.py backend/app/routers/ops.py` prints nothing. That is a structural check: the button must never re-download current bars.
7. `run_manual_refresh` does not acquire the lock. Criteria 2(b) and 2(e) prove this: both call it after `try_begin_manual_refresh()` has succeeded, which is the real precondition, and assert that `refresh` ran. A `run_manual_refresh` that tried `acquire(blocking=False)` itself would get `False` and bail out, and those tests would fail. Every test that calls `run_manual_refresh` must call `try_begin_manual_refresh()` first, never bare. A bare call would make its `finally` release an unheld lock and raise `RuntimeError`.
8a. `frontend/src/lib/sweepWatch.test.ts` uses `vi.useFakeTimers()`, with `intervalMs: 100, timeoutMs: 300` (so at most 4 polls) and literal fixtures. Each case below is its own test:
   - (a) The first poll resolves `{ active: false }`. `poll` is called once, synchronously, before any timer advances. `onFinished` is called once with `({ active: false }, 1)`. After advancing 1000 ms, `poll` is still called once.
   - (b) Polls resolve `{active:true}`, `{active:true}`, `{active:false}`. `onFinished` is called with `({ active: false }, 3)`, and `onUpdate` is called 3 times.
   - (c) A rejection followed by `{active:false}` gives `onFinished(…, 2)` and `onTimeout` is never called.
   - (d) Always `{active:true}` gives exactly 4 polls, `onTimeout` once, and `onFinished` never, even after advancing a further 1000 ms.
   - (e) `cancel()` after the first active poll gives no further polls and no callbacks after advancing 1000 ms.
   - (f) `cancel()` while the first poll is in flight: the poll is a deferred promise, resolved `{active:false}` *after* cancel. `onFinished` and `onUpdate` are never called.
8. `cd frontend && npx tsc -p tsconfig.app.json --noEmit`, `npm run lint` and `npm test` all exit 0. (Never plain `npx tsc --noEmit`; see REBUILD.md.)
9. `grep -c "<Tooltip" frontend/src/components/SystemHealthCard.tsx` prints `2`: the existing Refresh button plus the new one. `grep -n "title=" frontend/src/components/SystemHealthCard.tsx` prints nothing. `grep -c "setTimeout\|setInterval" frontend/src/components/SystemHealthCard.tsx` prints `0`, because the polling lives in `watchSweep`.
10. In your report, state which files you edited. Do not derive that list from git.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string, so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
>
> **Do not call `POST /ops/universe/refresh` against a backend using `backend/.env`.** That is the
> production database. A due-window run writes a real `app_state` claim, and a run records a real
> `job_runs` row. Use the pytest fixtures.

Run each of these and paste the **complete, verbatim** output into the report, including failures.

```bash
cd backend && pytest -q
cd backend && pytest -q tests/test_autorefresh.py tests/test_autorefresh_manual.py tests/test_api_ops.py tests/test_ops.py -v
grep -n '@router.get("/sweep_status"\|@router.get("/{ticker}"' backend/app/routers/universe.py
grep -rn "force=True" backend/app/autorefresh.py backend/app/routers/ops.py; echo "exit=$?"
grep -c "<Tooltip" frontend/src/components/SystemHealthCard.tsx
grep -n "title=" frontend/src/components/SystemHealthCard.tsx; echo "exit=$?"
grep -c "setTimeout\|setInterval" frontend/src/components/SystemHealthCard.tsx
cd frontend && npx tsc -p tsconfig.app.json --noEmit && npm run lint && npm test
```

## Tooltips

| element | tooltip copy |
|---|---|
| **Force update** button | `Bring every universe ticker's price history and quotes up to date now, without waiting for the next refresh window` |

The existing Refresh tooltip (`Re-read system status`) is unchanged. Do not use `title=`.

## Human verification: does Gunnar need to run anything?

**Yes, against the deployed app, after he deploys.** Local runs would hit production through `.env`, so the deployed app is the honest test.

1. Open `/ops`. The System Health card shows **Force update** to the left of **Refresh**, and hovering it shows the tooltip above.
2. Click it. The label reads `Updating…` and the button is disabled.
3. Within ~20 s on an up-to-date universe (longer if bars are actually missing), the label returns to **Force update**. Job history then shows a new `universe_refresh_manual` row with a `quotes` count, and `refreshed 0` when the data was already current.
4. Click it twice quickly in two tabs. The second tab goes straight to watching without an error, because that was a 409.
5. `curl -s https://blue-eagle-backend.onrender.com/universe/sweep_status` returns `{"active":false}` when idle, not a 404.

## Open questions

None known. If the code differs from what this contract quotes, report `BLOCKED` with the difference rather than choosing. Examples: `refresh` in `app.universe` takes different arguments; `store_quotes` is not in `app.cache`; the two dict-equality assertions are not at the quoted lines.
