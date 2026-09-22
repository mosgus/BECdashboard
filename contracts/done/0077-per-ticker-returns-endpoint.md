# Contract 0077 — Per-ticker 5D / 30D / YTD returns, extracted and served

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

`GET /universe/returns?tickers=A,B,C` returns 5-session, 30-session and year-to-date returns per
ticker from stored bars, and the pure math behind it lives in one module instead of inside `strip.py`.

## Why

The Holdings tab needs per-position performance. **Cost basis and dollar P&L were considered and
declined** — Gunnar's call, 2026-09-22, consistent with `REBUILD.md`'s *"Blue Eagle is an
allocation-analysis and optimization tool, not a tax lot, P&L, or brokerage-holdings ledger."*

The deciding technical argument, worth keeping: **share counts are optional metadata and drift from
weights on every cash edit** (contract 0072). `P&L = (price − cost) × shares` computed from drifting
shares produces a dollar figure that looks precise and is not — the silent-wrongness class this
project keeps getting caught by. Windowed *returns* need no share count and no purchase price; they
come entirely from price history the app already stores.

**The math already exists and is tested.** `strip.py` holds `pct_return`, `nth_prior_close`,
`ytd_base_close` and `bar_window_start`, with 10 pure tests including a parametrised property test on
the window. This contract extracts them rather than letting a second consumer copy them — a derived
quantity computed in two places eventually disagrees in one, which is exactly what contracts 0071 and
0072 spent two rounds undoing for cash.

Risk & Perf will want the same endpoint later. That is a reason to get the shape right now, **not** a
reason to build anything for it in this contract.

## Files

Create:
- `backend/app/returns.py` — the four pure functions, moved verbatim. Tier 0: no app-internal imports.
- `backend/tests/test_returns.py` — the 10 pure tests, moved.

Modify:
- `backend/app/strip.py` — import the four from `app.returns`; delete the local definitions.
- `backend/tests/test_strip.py` — drop the 10 moved tests; everything else stays.
- `backend/app/schemas.py` — `TickerReturns`, `ReturnsResponse`.
- `backend/app/routers/universe.py` — the new route.
- `backend/tests/test_api_universe.py` — endpoint tests.

**Touch nothing else.** If the work appears to require editing a file not on this list, stop and
report `BLOCKED` instead of editing it.

Do not touch the frontend. The Holdings page is contract 0078 and will be written against this
endpoint once it exists.

**`reference files/` is read-only and never belongs on a file list.**

> **Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**. `tests/conftest.py` strips the variable for
> `pytest` only.

## Interface

### The extraction

Move these four **verbatim** into `app/returns.py`, with their docstrings:

```python
pct_return(latest: float | None, earlier: float | None) -> float | None
nth_prior_close(bars: list[tuple[date, float]], sessions: int) -> float | None
ytd_base_close(bars: list[tuple[date, float]], year: int) -> float | None
bar_window_start(today: date, year: int) -> date
```

`_MIN_WINDOW_DAYS` moves with `bar_window_start`. `resolve_display_name` **stays in `strip.py`** —
it is naming, not return math, and nothing here needs it.

**This must be behaviour-preserving.** Do not rename, re-sign, or "improve" any of the four. The 10
moved tests passing unchanged is the proof; if you find yourself editing a test to make it pass, stop
and report `BLOCKED`.

`strip.py` keeps `build_strip_response` exactly as it is and imports the four from `app.returns`.

### Schemas

```python
class TickerReturns(BaseModel):
    ticker: str
    five_day: float | None
    thirty_day: float | None
    ytd: float | None


class ReturnsResponse(BaseModel):
    returns: list[TickerReturns]
    as_of: date | None      # newest bar date across the requested set; null when none
```

### The route

```python
@router.get("/returns", response_model=ReturnsResponse)
def get_returns(tickers: str = "") -> dict:
```

**Declare it above `/{ticker}`** (currently `routers/universe.py:144`). `/universe/returns` matches
that dynamic route, and the wrong order resolves it as a ticker named "returns" and 404s —
`REBUILD.md` records this exact trap for `/strip` and `/quotes/refresh`. Put it beside `/strip`.

Behaviour:

- `tickers` is a comma-separated list. Split, strip whitespace, uppercase, drop empties, de-duplicate
  **preserving first-seen order**. The response array follows that order so the caller can zip it
  against its own list.
- **Empty or absent `tickers` → `{"returns": [], "as_of": null}`.** Do not fall back to "all universe
  tickers" — a caller that forgot the parameter should get nothing, not the most expensive query in
  the app.
- **More than 100 tickers → HTTP 400.** A bounded query on an endpoint with no auth.
- A requested ticker with no stored bars is **present in the response with all three nulls**, not
  omitted and not an error. The caller asked about it and deserves an answer; omitting it would make
  the response array stop lining up with the request.
- **Returns use `adj_close`, never `close`.** `REBUILD.md`: *"adj_close includes dividends, and over a
  YTD window that is material (IBM yields 2.78%, so a close-only YTD return understates it by roughly
  that much)."* This is the single most important line in the contract.
- Bound the bar query with `bar_window_start(today, today.year)`, exactly as `build_strip_response`
  does. Reading whole bar tables cost the strip 55,917 rows where 3,914 sufficed; do not reintroduce
  that here.
- One query for all requested tickers. **No per-ticker query, no N+1.**
- `as_of` is the newest bar date seen across the set, or `null`.
- **Never fetches from yfinance.** Stored data only, like the strip. No background task either — this
  endpoint does not run on every page load and is not a visit signal.
- `_require_database()` as the other routes do.

## Out of scope

- **No frontend.** The Holdings page is 0078.
- **No cost basis, no P&L, no market value, no dollar figures anywhere.** Declined 2026-09-22.
- Do not add returns to `UniverseEntry` or `list_all`. `/universe` would then compute them on every
  Universe page load for data that page does not display.
- Do not add 1M / 3M / 1Y / since-inception windows. Three windows, the three the strip already
  computes. More is a later decision, not a free extra.
- Do not change `build_strip_response`, the strip response shape, or `quotes_stale`.
- Do not change `resolve_display_name` or move it.
- Do not add caching. Measure first if it ever matters.
- No new dependency.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` exits 0. Report the count — it was
   **460**, and moving tests between files should leave the total unchanged plus whatever the new
   endpoint tests add.
2. `grep -n "def pct_return\|def nth_prior_close\|def ytd_base_close\|def bar_window_start" backend/app/strip.py`
   prints **nothing** — the definitions moved, not copied.
3. `grep -n "from app.returns import" backend/app/strip.py` prints the import.
4. `grep -rn "def pct_return" backend/app/` prints exactly **one** line.
5. The 10 moved tests exist in `tests/test_returns.py` and pass **unmodified**. Paste their names and
   confirm the assertions are byte-identical to what was in `test_strip.py`.
6. A test asserts `/universe/returns` is reachable and does **not** resolve as a ticker named
   "returns" — assert the response body has a `returns` key rather than a 404 or a `UniverseDetail`.
7. A test asserts a requested ticker with no stored bars comes back **present with three nulls**, and
   that the response order matches the request order for a mixed set.
8. A test asserts `tickers=""` and an absent parameter both give `{"returns": [], "as_of": null}`.
9. A test asserts 101 tickers returns **400**.
10. A test asserts the computation uses `adj_close`: store a ticker whose `close` and `adj_close`
    differ across the window, and assert the returned figure matches the `adj_close` calculation and
    **not** the `close` one. A test that cannot tell the two apart does not test this.
11. A test asserts de-duplication preserves first-seen order — `MU,ORCL,MU` yields two entries,
    `MU` first.
12. A test asserts the endpoint performs **no** yfinance call — the suite's `block_network` fixture
    must be satisfied with no `allow_network` marker.
13. `grep -n "returns" backend/app/routers/universe.py` shows the route declared **before** the
    `/{ticker}` route. State both line numbers.
14. No frontend file is modified. State this explicitly.

## Verification to run and paste

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest tests/test_returns.py tests/test_strip.py -q
grep -n "def pct_return\|def nth_prior_close\|def ytd_base_close\|def bar_window_start" app/strip.py ; echo "moved-out grep exit: $?"
grep -n "from app.returns import" app/strip.py
grep -rn "def pct_return" app/
grep -n "@router.get" app/routers/universe.py
cd /Users/gunnarbalch/WebstormProjects/blue-eagle && git status --porcelain frontend/ ; echo "frontend-untouched exit: $?"
```

Also paste one real response body, produced against the test database — not production — for a set of
three tickers where one has no bars.

## Tooltips

Not applicable — backend only.

## Human verification — does Gunnar need to run anything?

**Optional, and only if you want to see it before the UI exists.**

**Restart the backend first** — a `uvicorn` started without `--reload` serves the code it was launched
with, and `REBUILD.md` records a strip verification that ran against a stale process and produced a
misleading 404. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound port.

```bash
curl -s "http://localhost:8000/universe/returns?tickers=MU,ORCL,VOO" | python3 -m json.tool
```

Sanity-check the YTD figures against a public source for one or two names. They will not match to the
decimal — ours are dividend-adjusted and most quote sites show price-only — and **ours being slightly
higher for a dividend payer is correct**, not a bug.

Nothing visual changes. The Holdings table is contract 0078.

## Open questions — do not resolve these yourself

None. If you find one, report `BLOCKED` and stop.
