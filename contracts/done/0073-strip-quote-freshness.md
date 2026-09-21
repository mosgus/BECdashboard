# Contract 0073 — The ticker strip refreshes its own quotes instead of relying on a Universe visit

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`GET /universe/strip` schedules the quote refresh it depends on, and `TickerStrip` refetches once
when the response says its quotes were stale — so the strip stops showing the previous session's move
while `/universe` shows a live price.

## Why

**Reported by Gunnar, 2026-09-22.** The strip showed `S&P 500 7,650.23 +0.16%` while the Universe row
for the same index showed `7,764.70 +1.49%`. It corrected itself after a reload.

This is **not** the deliberate strip/table disagreement recorded in `REBUILD.md` (contract 0028) —
that one is about `0.00%` after the close. Both views read the same `ticker_quotes` table through the
same `QUOTE_TTL_MINUTES` gate (`strip.py:95`, `universe.py:67`). They disagreed about the *moment*,
not the policy.

The chain, traced 2026-09-22:

1. `get_strip` reads storage and **refreshes nothing**. Its docstring is explicit: *"quote refresh for
   the response stays owned by `list_all()`."*
2. `refresh_quotes_if_stale` has exactly two callers — `universe.list_all()` (`GET /universe`) and
   `autorefresh.run_auto_refresh_if_due`, which is window-claimed to 09:30 / 12:00 / 16:00 ET and is a
   no-op between windows.
3. With a stored quote older than 10 minutes, `_quote_is_fresh` is false and the strip falls back to
   `last_close` vs `prior_close` — the last completed session's move.
4. Visiting `/universe` runs `list_all()`, refreshes quotes, and the table shows a live price.
5. `TickerStrip.tsx:60` is `useEffect(…, [])`, and the component sits in `App.tsx` **outside**
   `<Routes>` — it mounts once, survives navigation, and never refetches.

**So the strip's accuracy is a side effect of somebody opening the Universe page.** On a
launch-page-only visit between windows, it can show the previous session indefinitely. That is why it
looks consistently wrong rather than intermittently wrong.

**Two fixes were considered and rejected:**

- *Point the strip at the Universe's values.* It already reads the same table with the same TTL. Same
  data, different moment.
- *Await the quote fetch before responding.* `/universe/strip` fires on **every page load** and is the
  app's only reliable "a user is here" signal. Awaiting a yfinance call there puts network latency on
  the critical path of every page, on top of a ~43s cold start. Fire-and-forget is why that endpoint
  is fast, and it stays.

## Files

Modify:
- `backend/app/schemas.py` — add `quotes_stale: bool` to `StripResponse`.
- `backend/app/strip.py` — compute and return it.
- `backend/app/routers/universe.py` — schedule the quote refresh as a third background task; correct
  the docstring, which currently states the opposite.
- `backend/tests/test_strip.py` — tests below.
- `backend/tests/test_api_universe.py` — the scheduling test.
- `frontend/src/api/client.ts` — the new field on the strip type.
- `frontend/src/components/TickerStrip.tsx` — one delayed refetch.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not change `quotes.py`, `autorefresh.py`, `universe.py`, or `QUOTE_TTL_MINUTES`.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` in this contract must be prefixed `DATABASE_URL=""`.** `app/config.py`
> calls `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**. `tests/conftest.py` strips the variable for
> `pytest` only.

## Interface

### Backend

```python
class StripResponse(BaseModel):
    groups: list[StripGroup]
    as_of: datetime | None
    quotes_stale: bool          # the response fell back to stored closes for at least one ticker
```

`build_strip_response` sets `quotes_stale = True` when **the market is open** and at least one ticker
took the `is_fresh is False` branch. Outside market hours it is **always `False`** — the session-move
fallback is correct then, by the contract 0028 decision, and a client must not refetch chasing a
liveness that does not exist.

In `routers/universe.py`, add a third background task:

```python
background_tasks.add_task(refresh_quotes_if_stale, [entry.ticker for entry in ...])
```

Use whatever ticker list `build_strip_response` already derives — do not add a second query. If that
list is not reachable from the router without one, compute it inside `strip.py` and return it, or
schedule a zero-argument wrapper; say which you chose and why.

This is safe against a request storm by construction and **must not be given a new gate**:
`refresh_quotes_if_stale` already carries its own `app_state` last-attempt claim (contract 0051) and a
module-level lock (contract 0041). Adding another would be a fourth staleness policy for one concept —
the exact divergence contracts 0071 and 0072 removed.

**Correct the `get_strip` docstring.** It currently says quote refresh *"stays owned by `list_all()`"*,
which this contract makes false. A docstring that contradicts the code is worse than none — `REBUILD.md`
records a full debugging session lost to exactly that.

### Frontend

`TickerStrip` keeps its single `useEffect(…, [])` mount fetch, and adds **at most one** follow-up:

- If the first response has `quotes_stale === true`, schedule one refetch after **5000 ms**.
- The result of that refetch is rendered whether or not it is still stale. **Never chain a second
  one** — a loop here becomes a per-visitor poll against Yahoo's rate limit.
- Clear the timer on unmount. The component does not normally unmount, but a timer firing into a
  dead component is the kind of thing that survives until someone adds a route that does.
- A failed refetch leaves the existing data on screen. `TickerStrip` returns `null` on a failed
  *initial* fetch so the launch page never breaks on a slow market endpoint (`REBUILD.md`); do not
  extend that to the refetch, where a failure should be invisible rather than blanking a populated
  strip.

5000 ms is chosen because FastAPI runs background tasks **after** the response is sent, and a batch
quote fetch over ~20 tickers takes a few seconds. Do not poll, do not shorten it to "feel faster", and
do not use `setInterval`.

## Out of scope

- **No presets, no portfolio code.**
- Do not await any fetch inside `get_strip`. The response must stay computed from stored data only.
- Do not change `QUOTE_TTL_MINUTES`, `_quote_is_fresh`, or the market-hours gate.
- Do not change the after-hours behaviour. A strip showing the last session's move when the market is
  closed is contract 0028's decision and is correct.
- Do not change the Universe table, `list_all`, or its quote refresh.
- Do not add a `quote_as_of` field to `UniverseEntry`. That is a known gap recorded in `REBUILD.md`
  and it is a separate contract.
- Do not add polling, websockets, or a refresh button to the strip.
- No new dependency.

## Acceptance criteria

1. A test asserts `build_strip_response` returns `quotes_stale is True` when the market is open and a
   ticker's stored quote is older than `QUOTE_TTL_MINUTES`. Pin the clock explicitly — pass `now_utc`
   and `now_et`; **no test may read the wall clock** (`REBUILD.md`, "Tests must never depend on the
   wall clock").
2. A test asserts `quotes_stale is False` when the market is open and every quote is fresh.
3. A test asserts `quotes_stale is False` **outside market hours even with an ancient quote** — the
   after-hours fallback must not make a client refetch.
4. A test asserts `GET /universe/strip` schedules **three** background tasks, and that the quote
   refresh is one of them. Patch every module that imported the name, not just the defining module
   (`REBUILD.md`, "patching must target where a name is *looked up*").
5. A test asserts the strip response body still computes from stored data with **no network call** —
   the suite's `block_network` fixture must remain satisfied without an `allow_network` marker.
6. `grep -n "stays owned by list_all" backend/app/routers/universe.py` prints nothing — the stale
   docstring is corrected.
7. `grep -n "setInterval" frontend/src/components/TickerStrip.tsx` prints nothing.
8. Reading the diff: the refetch is scheduled at most once. State the lines that guarantee a second
   refetch cannot be chained.
9. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count.
10. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0. (`npx tsc --noEmit` is vacuous in
    this project — see `REBUILD.md`.)
11. `cd frontend && npm run build` exits 0.
12. `cd frontend && npm run lint` exits 0 with no new warnings beyond the pre-existing
    `UniversePage.tsx:60`.
13. `cd frontend && npm run test` exits 0 with **55** tests — unchanged. This contract adds no
    frontend lib logic.
14. `grep -n "available.some" frontend/src/components/AddPositionForm.tsx` still prints the Universe
    guard.
15. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "TSC OK"
cd frontend && npm run build
cd frontend && npm run lint && echo "LINT OK"
cd frontend && npm run test
grep -n "stays owned by list_all" backend/app/routers/universe.py ; echo "stale-docstring grep exit: $?"
grep -n "setInterval" frontend/src/components/TickerStrip.tsx ; echo "interval grep exit: $?"
grep -n "quotes_stale" backend/app/schemas.py backend/app/strip.py frontend/src/api/client.ts frontend/src/components/TickerStrip.tsx
grep -n "available.some" frontend/src/components/AddPositionForm.tsx
```

## Tooltips

No interactive element is added or changed. The strip is display text, not clickable — and
`REBUILD.md` records why it deliberately carries no `Tooltip`: the component captures its anchor's
rect once and cannot follow a moving element.

## Human verification — does Gunnar need to run anything?

**Yes, and it must be during market hours** — the whole bug is invisible when the market is closed.

**Restart the backend first.** A `uvicorn` started without `--reload` serves the code it was launched
with, forever; `REBUILD.md` records a strip verification that ran against a stale process and produced
a misleading 404. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

1. Wait until the stored quotes are stale — at least 10 minutes after any Universe page visit — then
   **open the launch page `/` directly**, not `/universe`. That is the case that was broken.
2. Note the strip's price for `^GSPC`. Within about five seconds it should update on its own, without
   a reload. **That self-correction is the entire fix.**
3. Now open `/universe` in the same session and confirm the strip and the table agree on both price
   and percentage.
4. **After the close**, reload and confirm the strip shows the last session's move — *not* `0.00%`,
   and not a live price. That is contract 0028's deliberate behaviour and this contract must not have
   broken it.
5. Watch for a *second* update after the first. There must not be one; a repeating refresh is the
   failure mode this contract's single-shot rule exists to prevent.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
