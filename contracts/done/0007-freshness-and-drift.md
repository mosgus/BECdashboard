# Contract 0007 — Freshness rule, partial-bar guards, and split/dividend drift detection

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Stored price history stays correct over time: a ticker is refreshed only when it is genuinely
behind the last completed session, incomplete intraday bars never become permanent closes, and a
split or dividend that retroactively restates history is detected and repaired.

## Why

Contract 0006 gets data in correctly **once**. This one keeps it correct.

Two failure modes, both silent, both producing numbers that look entirely plausible:

**Forward staleness** is the easy one — the newest stored bar predates the last completed session.
`REBUILD.md`'s freshness rule handles it, and it is deliberately *idempotent*: a fresh ticker is
never refetched, so repeated updates are free and the abuse vector of a click-loop closes itself.

**Retroactive restatement** is the one the freshness rule cannot see. After a 4:1 split, every
stored `adj_close` before the split date is wrong by a factor of four while the newest bar is
perfectly current — so the freshness rule reports "fresh" and serves corrupted data indefinitely.
Returns, volatility, Sharpe and correlation all go wrong together and every one of them still looks
like a number. This is why contract 0005 added `adj_close` and why 0006 fetches with
`auto_adjust=False`: raw OHLC is the invariant, `adj_close` is the canary.

The detection approach is carried from `reference files/old_yfinance_project/YF.py:149-201`, which
solved this before the rebuild existed: re-fetch a known historical date, compare stored against
fresh, and on mismatch discard and refetch rather than append.

**Depends on contracts 0004–0006.** If `app/market_data.py` or `PriceBar.adj_close` does not exist,
stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL`
from every test via an autouse fixture — **do not remove or weaken it.** It exists because `pytest`
was caught writing to the production database on 2026-09-13.

## Files

Create:
- `backend/app/freshness.py` — session derivation, staleness, drift detection, repair
- `backend/tests/test_freshness.py` — tests for all of it

Modify:
- `backend/app/market_data.py` — add `refresh_ticker()`, the single entry point

**Touch nothing else.** Do not modify `app/cache.py`, `app/db.py`, `app/models.py`, `app/config.py`,
`app/main.py`, any migration, `tests/conftest.py`, `tests/test_cache.py`, or anything under
`frontend/`. No new dependencies — **specifically not `pandas_market_calendars`**, which
`REBUILD.md` rejects. If the work appears to require a file not on this list, stop and report
`BLOCKED`.

## Interface

### `app/freshness.py`

```python
REFERENCE_TICKER = "SPY"
DRIFT_TOLERANCE = 1e-6

def last_completed_session(today: date, now_et_hour: int, reference_bars: pd.DataFrame) -> date | None
def is_stale(stored: pd.DataFrame | None, last_session: date) -> bool
def pick_drift_anchors(stored: pd.DataFrame) -> list[date]
def detect_drift(stored: pd.DataFrame, fresh: pd.DataFrame, anchors: list[date]) -> bool
def missing_range(stored: pd.DataFrame, last_session: date) -> tuple[date, date] | None
```

**Every one of these is pure.** No network, no database, no `datetime.now()` inside them — `today`
and `now_et_hour` are arguments precisely so they can be tested at a specific moment. The impure
wrapper lives in `market_data.py`.

#### `last_completed_session(today, now_et_hour, reference_bars)`

The newest bar date in `reference_bars`, **excluding `today` unless `now_et_hour >= 16`.**

This composes the two approaches `REBUILD.md` records. The reference ticker gives the set of real
sessions empirically — weekends and market holidays fall out for free, with no calendar dependency
and no possibility of disagreeing with what yfinance actually serves. Verified 2026-09-13: SPY's
series shows a gap between 09-04 and 09-08 for Labor Day. The 16:00 ET check decides whether today
counts yet, because **yfinance returns a partial in-progress bar during market hours** and treating
it as complete freezes an incomplete close permanently.

Returns `None` for empty `reference_bars` — callers must treat that as "cannot determine, do
nothing," never as "everything is stale."

#### `is_stale(stored, last_session)`

`True` when `stored` is `None`, empty, or its newest index date is earlier than `last_session`.
Never `True` when the newest stored bar is *equal to or later than* `last_session` — that property
is what makes repeated updates no-ops.

#### `pick_drift_anchors(stored)`

Up to three dates from the stored index: **first, middle, and most recent**. Fewer if the series is
shorter; empty list for an empty frame; no duplicates.

Three rather than one because a dividend restates only prices *before* its ex-date. A single anchor
near the end of the series misses a recent corporate action entirely, and one near the start tells
you nothing about recency. Three rows cost nothing — they come out of a fetch already being made.

#### `detect_drift(stored, fresh, anchors)`

`True` when stored and fresh `adj_close` disagree on **any** anchor date present in both, using
`np.isclose(atol=DRIFT_TOLERANCE, rtol=0.0)`.

- Compare `adj_close` only. Raw `close` is the invariant; if *it* has changed, that is genuine data
  corruption rather than a corporate action, and it is out of scope here — report it, do not repair
  it silently.
- Anchors absent from either frame are skipped, not treated as drift.
- `rtol=0.0` is deliberate. A relative tolerance scales with price and would hide small
  restatements on high-priced tickers.

#### `missing_range(stored, last_session)`

The `(start, end)` to fetch, or `None` when nothing is missing.

**`start` is the newest stored date itself, not the day after.** This is the second partial-bar
guard: the most recent stored bar may be an incomplete intraday snapshot, so it must be re-fetched
and overwritten rather than trusted. The upsert in `cache.py:_write_to_db` makes overwriting safe.

For `stored` empty or `None`, return `None` — a first fetch is the caller's job, not a repair.

### `app/market_data.py` — one new function

```python
def refresh_ticker(ticker: str, force: bool = False) -> dict:
    """Bring a ticker's stored history up to the last completed session, repairing it if a
    split or dividend has restated it. Returns a summary of what happened."""
```

Returns:

```python
{
  "ticker": "AAPL",
  "action": "none" | "appended" | "refetched" | "unknown_session",
  "last_session": date | None,
  "bars_before": int,
  "bars_after": int,
  "drift_detected": bool,
}
```

Order of operations, and this order matters:

1. Read `stored` via `cache.get_cached(ticker)`.
2. Derive `last_session` from a **reference-ticker fetch** and the current ET hour. `None` →
   return `action="unknown_session"` and change nothing.
3. If `not is_stale(...)` and `not force` → return `action="none"`. **No network beyond step 2, no
   writes.** This is the idempotence property; do not check drift here.
4. Otherwise fetch `missing_range(...)` from yfinance.
5. Check `detect_drift(stored, fresh, pick_drift_anchors(stored))` against the overlapping region.
   - No drift → `store()` the fetched range. `action="appended"`.
   - Drift → refetch the **entire stored span** and `store()` that. `action="refetched"`,
     `drift_detected=True`.
6. Never `DELETE`. The upsert overwrites restated rows in place.

Step 3 is why drift is checked when already fetching rather than on every call: a split happens
overnight, so the next session makes the ticker stale anyway and drift is caught then. Worst case
is one trading day of stale-but-known-stale data on a ticker nobody is touching, and `force=True`
covers the rest. Checking on every update would cost a request per click and destroy the
idempotence that makes the freshness rule worth having.

## Testing

No network, no database. Build `pd.DataFrame` fixtures directly; monkeypatch
`market_data._download_history` for `refresh_ticker` tests.

Required cases:

1. `last_completed_session` at 10:00 ET with today's bar present → **yesterday's** date.
2. Same data at 17:00 ET → **today's** date.
3. Across a weekend (Sunday) → the preceding **Friday**.
4. Across a holiday — reference bars with a Labor Day gap → the session before the gap, **not** the
   holiday. Use real dates: bars on 2026-09-04 and 2026-09-08, asked on 2026-09-07.
5. Empty reference bars → `None`.
6. `is_stale` is `False` when the newest stored bar equals `last_session`; `True` when earlier;
   `True` for `None` and for empty.
7. `pick_drift_anchors` returns three distinct dates for a long series, fewer for short ones, `[]`
   for empty, never duplicates.
8. `detect_drift` is `False` for identical `adj_close`.
9. `detect_drift` is `True` when one anchor's `adj_close` differs by more than tolerance —
   **simulate a 4:1 split by dividing historical `adj_close` by 4.**
10. `detect_drift` is `False` when only raw `close` differs and `adj_close` matches.
11. `detect_drift` ignores anchors missing from `fresh`.
12. `detect_drift` is `False` for a difference below `DRIFT_TOLERANCE` (floating-point noise).
13. `missing_range` starts at the **newest stored date**, not the day after — the partial-bar guard.
14. `missing_range` returns `None` when already current, and `None` for empty stored.
15. `refresh_ticker` on fresh data returns `action="none"` and performs **no download** — assert the
    monkeypatched downloader was not called after session derivation.
16. `refresh_ticker` on stale data with no drift returns `action="appended"`.
17. `refresh_ticker` on stale data **with** drift returns `action="refetched"` and
    `drift_detected=True`, and refetches the full stored span rather than only the missing range.
18. `refresh_ticker` with `force=True` on fresh data still fetches.

A test that asserts nothing, or that asserts against the implementation rather than the requirement,
fails this contract. In particular: case 9's fixture must be built by restating a *separate* frame,
not by calling the same helper the implementation uses.

## Out of scope

- No universe table, no add/remove, no API endpoints, no frontend. Contracts 0008 and 0009.
- No prepending — extending history *backwards* is real (`YF.py:496-561`) but unscoped.
- No fundamentals refresh. This contract is price history only.
- No scheduled or background refresh. `refresh_ticker` is called by a request, not a timer.
- No `pandas_market_calendars`, no new dependencies at all.
- No `DELETE` anywhere. No changes to `clear()`.
- Do not modify `cache.py` — reuse `get_cached`/`store` as they are. If you believe you must change
  them, that is a `BLOCKED` report.
- Do not repair a raw-`close` mismatch. Detect and report; repairing genuine corruption is a
  separate decision.

## Acceptance criteria

0. Every file in the Files list exists.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 51.
2. All eighteen cases above are present and meaningful.
3. `grep -rnE "datetime\.now|date\.today|utcnow" backend/app/freshness.py` matches nothing (exit 1)
   — the pure functions take time as an argument.
4. `grep -rn "pandas_market_calendars\|mcal" backend/app/` matches nothing (exit 1).
5. `grep -rnE "DELETE|delete\(\)" backend/app/` matches nothing (exit 1).
6. `git diff --stat backend/app/cache.py backend/tests/conftest.py backend/tests/test_cache.py`
   is empty — none of the three were touched.
7. `git diff --stat backend/requirements.txt` is empty — no new dependencies.
8. `grep -rnE "yf\.(download|Ticker)\(" backend/tests/test_freshness.py` matches nothing (exit 1).
9. Degraded mode intact: app imports and `/health` returns 200 with `DATABASE_URL` unset.

## Verification to run and paste

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rnE "datetime\.now|date\.today|utcnow" backend/app/freshness.py ; echo "exit=$? (1 means clean)"
grep -rn "pandas_market_calendars\|mcal" backend/app/ ; echo "exit=$? (1 means clean)"
grep -rnE "DELETE|delete\(\)" backend/app/ ; echo "exit=$? (1 means clean)"
git diff --stat backend/app/cache.py backend/tests/conftest.py backend/tests/test_cache.py ; echo "(empty = untouched)"
git diff --stat backend/requirements.txt ; echo "(empty = no new deps)"
grep -rnE "yf\.(download|Ticker)\(" backend/tests/test_freshness.py ; echo "exit=$? (1 means clean)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; assert TestClient(app).get('/health').status_code == 200; print('health 200, degraded mode intact')"
```

State in the report: how you built the split fixture for case 9, and what `refresh_ticker` does when
the reference-ticker fetch itself fails.

## Human verification — does Gunnar need to run anything?

**Yes — against the real service, once the tests pass.** The database already holds AAPL, SPY and
TSLA from the 0006 smoke test, which makes this directly checkable:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from app.market_data import refresh_ticker
for t in ['AAPL','SPY','TSLA']:
    print(refresh_ticker(t))
print('--- second pass, must all be action=none ---')
for t in ['AAPL','SPY','TSLA']:
    print(refresh_ticker(t))
"
```

What proves it worked: the **second pass returns `action="none"` for every ticker**. That is the
idempotence property — if the second pass fetches again, the freshness rule is broken and repeated
updates will hammer Yahoo. Also confirm `bars_after >= bars_before` and that no ticker reports
`unknown_session`.

## Open questions — do NOT resolve these yourself

- **What happens when a refetch returns fewer dates than are stored** (delisting, or a ticker
  changing symbol). Stale rows would remain, since nothing deletes. Undecided — do not add deletion.
- **Whether a raw-`close` mismatch should surface to the user**, and through what channel. Detect
  and report in the return value if you like, but do not repair and do not raise.
- **How far back a first fetch should go.** Decided as 10 years, but it belongs at the call site in
  contract 0008, not here. `refresh_ticker` only ever extends or repairs an existing series.
- **Fundamentals staleness.** Prices and fundamentals go stale on different clocks. Unscoped.
