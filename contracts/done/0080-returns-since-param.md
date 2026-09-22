# Contract 0080 — A `since` parameter on `GET /universe/returns`

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`GET /universe/returns?tickers=A,B&since=2026-01-02` adds a `since` figure per ticker: the return from
that date's close to the newest stored bar.

## Why

The basis-date feature — one user-chosen anchor per portfolio, **percentage only** (Gunnar,
2026-09-22). This is the backend half.

**It is the same computation as YTD with a different anchor.** `ytd_base_close(bars, year)` finds the
first bar on or after 1 January; this needs the first bar on or after an arbitrary date. Both then go
through `pct_return`. Contract 0077 put that math in `app/returns.py` precisely so the second consumer
would extend it rather than copy it.

Runs independently of contract **0079** (the frontend model and CSV) — no shared files, so the two can
execute at the same time. Contract **0081** wires the UI after both land.

## Files

Modify:
- `backend/app/returns.py` — a date-anchored base-close helper.
- `backend/app/schemas.py` — `since` on `TickerReturns`.
- `backend/app/routers/universe.py` — the query parameter.
- `backend/tests/test_returns.py`, `backend/tests/test_api_universe.py` — tests below.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

**No frontend file.** Contract 0079 may be running against `frontend/` at the same time.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**.

## Interface

### The pure helper

```python
def base_close_on_or_after(bars: list[tuple[date, float]], cutoff: date) -> float | None:
    """The first adj_close on or after `cutoff`. None when no bar qualifies."""
```

`ytd_base_close(bars, year)` becomes `base_close_on_or_after(bars, date(year, 1, 1))` — **rewrite it
as that one-line delegation, do not leave two implementations.** Its existing tests must pass
unchanged; that is the proof the generalisation is behaviour-preserving, exactly as the 0077
extraction was proved by diffing its moved tests.

### The route

```python
def get_returns(tickers: str = "", since: str = "") -> dict:
```

- Absent or empty `since` → every `TickerReturns.since` is `null`. The existing three windows are
  unaffected, so today's callers see no change.
- Malformed `since` → **HTTP 400**, message naming the expected form. Parse it with
  `date.fromisoformat`, which already rejects `2026-02-30` and `2026-13-01`.
- **A `since` in the future, or before a ticker's earliest stored bar, is not an error** — that
  ticker's `since` is `null`. The caller asked a question with no answer, which is different from
  asking a malformed one. A pre-IPO date and a Saturday both land here naturally.
- **`since` may be older than the existing bar window.** `bar_window_start` bounds the query to
  `min(1 January, today − 75 days)`, which is the wrong bound for an anchor in a prior year. Widen the
  window to `min(bar_window_start(today, today.year), since)` when `since` is given. **Do not remove
  the bound** — contract 0073's measurement stands: reading whole bar tables cost the strip 55,917
  rows where 3,914 sufficed. Widen it, do not drop it.
- Still one query for all tickers. No N+1.
- Still `adj_close`, never `close`. Dividend-inclusive, like every other figure here.

```python
class TickerReturns(BaseModel):
    ticker: str
    five_day: float | None
    thirty_day: float | None
    ytd: float | None
    since: float | None
```

## Out of scope

- **No frontend.** 0081.
- No second `since` date, no date range, no per-ticker anchors. One optional date for the whole
  request.
- No dollar figures. Percentage only.
- Do not change `pct_return`, `nth_prior_close`, `bar_window_start`, or the strip.
- Do not add caching.
- No new dependency.

## Acceptance criteria

1. The existing `ytd_base_close` tests pass **unmodified** after it delegates to
   `base_close_on_or_after`. Confirm by diffing them against `git show HEAD:backend/tests/test_returns.py`
   and paste the diff, which must be empty.
2. `grep -c "def ytd_base_close" backend/app/returns.py` is 1, and its body is a single delegating
   `return`. Quote it.
3. A test asserts `base_close_on_or_after` returns the first bar **on** the cutoff when one exists,
   and the first **after** it when the cutoff falls on a non-trading day.
4. A test asserts `since` is `null` for every ticker when the parameter is absent, and that the other
   three figures are byte-identical to a request without it.
5. A test asserts a malformed `since` — use `2026-02-30` — returns **400**.
6. A test asserts a `since` **before** a ticker's earliest stored bar yields `since: null` while the
   other three windows still compute. Not an error.
7. A test asserts a `since` in a **prior calendar year** returns a non-null figure — this is the one
   that fails if the bar window was not widened. Seed bars spanning the year boundary.
8. A test asserts the `since` figure uses `adj_close`: seed a ticker whose `close` and `adj_close`
   diverge across the window and assert the result matches the `adj_close` calculation and **not** the
   `close` one, the same discrimination contract 0077's criterion 10 used.
9. A test asserts a `since` falling on a **Saturday** resolves to the following Monday's bar rather
   than erroring.
10. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count; it was
    **467**.
11. `git status --porcelain frontend/` — state whatever it shows and confirm **you** changed nothing
    there. Contract 0079 may be running in parallel, so a dirty frontend is expected and is not yours.
12. State exactly which files you edited.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_returns.py -q
grep -c "def ytd_base_close" app/returns.py
grep -n -A3 "def ytd_base_close" app/returns.py
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git show HEAD:backend/tests/test_returns.py > /tmp/old_returns.py 2>/dev/null; diff /tmp/old_returns.py backend/tests/test_returns.py ; echo "ytd-tests diff exit: $?"
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/
```

The diff in the fifth command will show your **added** tests; what must not appear is any change to
the ten pre-existing ones. Say so explicitly.

Also paste one response body for a three-ticker request with a `since` in the previous year, produced
against the test database — **not** production.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Optional.** Nothing visual changes until 0081.

**Restart the backend first** — `uvicorn` without `--reload` serves the code it was launched with, and
`REBUILD.md` records a strip verification that ran against a stale process and produced a misleading
404. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/returns?tickers=MU,ORCL&since=2026-01-02" | python3 -m json.tool
```

Check one figure against a public source. Ours is dividend-adjusted and will read slightly **higher**
for a dividend payer than a price-only quote — correct, not a bug. And confirm the same request
without `since` still returns the three original windows unchanged.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
