# Contract 0195 — Portfolio endpoints read prices from an in-process cache, not the database each time

**Status:** accepted <!-- open | in-progress | reported | accepted | rejected | abandoned -->
**Assigned to:** sonnet <!-- haiku | sonnet -->
**Author:** planner (opus)

## Goal

After this contract, every portfolio endpoint loads adjusted closes through a new
`app.cache.get_adj_closes`. It serves each ticker's series from memory once loaded, and is cleared
by the same write and delete paths that already keep `app.cache` consistent with the database.

## Why

The planner measured the live API on 2026-11-09, on a warm server. `POST /portfolio/risk` took:

| Holdings | Time |
|---|---|
| 1 | 0.3–1.1 s |
| 8 | 1–2 s |
| 16 | 2.9–4.4 s |

That's about 0.2 s per holding. The computation itself is milliseconds locally. The time is
`_load_stored_closes` in `app/routers/portfolio.py`, which reads each ticker's **entire** history
(since 2000) from Postgres on every request.

Research's Overview sends risk, performance, attribution and compare at the same time. Each one
reloads the same holdings plus SPY. Concurrently on Render's 0.1 CPU, the four took 21 s.

**Why invalidation can be exact.** Every price-bar write goes through `app.cache.store()`
(→ `_write_to_db`). The only delete, `app.universe.remove`, already calls `app.cache.evict()`
afterwards. The service runs as one uvicorn process (`README.md`:
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, no `--workers`), so every write happens in the
process holding the cache. The only exception is a script writing to the production database from
outside the server; a 1-hour TTL bounds that.

## Files

Modify:
- `backend/app/cache.py`: add `get_adj_closes`, its cache and lock. `store()`, `evict()` and
  `clear()` drop entries from it.
- `backend/app/routers/portfolio.py`: `_load_stored_closes` delegates to `get_adj_closes`. Remove
  imports that become unused, and only those.
- `backend/tests/conftest.py`: add one autouse fixture (below).

Create:
- `backend/tests/test_adj_closes.py`: the tests in criterion 1.

**Touch nothing else.** In particular, do not change `get_cached`, `_read_from_db`, the
`/universe/returns` query, `strip.py`, or any `*_run.py` module. If the work appears to require
editing a file not on this list, stop and report `BLOCKED` instead of editing it.

**`reference files/` is read-only and never belongs on a file list.** Read it as much as the work
needs — that is what it is for — but it is a snapshot of other working software kept so its behaviour
can be compared against this rebuild, and an edited reference stops being evidence of anything.
`.claude/settings.json` denies Edit and Write there; that deny list cannot see a shell redirect,
`sed -i`, `cp` or `mv`, so do not route around it.

**`BLOCKED` is also the right answer if any criterion below cannot be satisfied as written.** Do not
find a clever way to pass a criterion that contradicts another one or the code. Stop and say which.

## Interface

### `app/cache.py`

```python
import threading

_closes_cache: TTLCache = TTLCache(maxsize=512, ttl=3600)
# cachetools caches are not thread-safe, and FastAPI runs sync endpoints in a thread pool. Overview
# fires four portfolio requests at once.
_closes_lock = threading.Lock()


def get_adj_closes(tickers: list[str]) -> dict[str, pd.Series]:
    """Adjusted-close series per ticker, ascending by date, with null adj_close rows dropped, as
    plain-date-indexed Series. Tickers with no stored bars are absent from the result, and absence
    is never cached. Served from an in-process cache: one query covers all misses, and store(),
    evict() and clear() drop entries. Returns copies, so callers may modify them freely."""
```

Exact semantics:
1. **Deduplicate** `tickers`, keeping first-occurrence order. Cache keys are the ticker strings
   **as given**. The database stores tickers uppercase, so a non-uppercase request finds no rows
   today and still finds none.
2. **Hits:** under `_closes_lock`, collect the cached Series for every ticker present.
3. **Misses:** if any ticker missed, run **one** query, built exactly as `_load_stored_closes`
   builds it today but restricted to the misses:
   ```python
   select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)
       .where(PriceBar.ticker.in_(misses), PriceBar.adj_close.is_not(None))
       .order_by(PriceBar.ticker, PriceBar.date)
   ```
   Build each Series with the code that exists today, moved verbatim:
   `pd.Series([price ...], index=[bar_date ...])`. Then store each under `_closes_lock`. Hold the
   lock only around cache reads and writes, **never around the query**.
4. **Return** `{ticker: series.copy()}` for each deduplicated ticker that has a series, in requested
   order.
5. **`store(ticker, df)`:** as its last statement, run on every path, including when the database is
   disabled, drop the entry: `with _closes_lock: _closes_cache.pop(key, None)`. `key` is the
   uppercase key `store` already computes.
6. **`evict(ticker)`:** also pops `ticker.upper()` from `_closes_cache` under the lock.
7. **`clear()`:** also clears `_closes_cache` under the lock. Update its docstring to say it clears
   both in-process caches.

### `app/routers/portfolio.py`

```python
def _load_stored_closes(tickers: list[str], *, required: bool = True) -> dict[str, pd.Series]:
    """Adjusted closes via app.cache.get_adj_closes (in-process, dropped on every bar write), with
    the same missing-history behavior as /series."""
    closes = get_adj_closes(tickers)
    if required:
        for ticker in tickers:
            if ticker not in closes:
                raise HTTPException(status_code=404, detail=f"No stored price history for {ticker}")
    return closes
```

The 404 message and the `required=False` behaviour are unchanged.

**One intended difference.** The returned dict is now in **requested** order. Before, it followed
the SQL `ORDER BY ticker`. Every consumer looks closes up by ticker. The only order-sensitive
outputs are dict key orders in JSON responses (e.g. `first_bar`), which the frontend reads by key.
Do not reorder to imitate the old order.

### `tests/conftest.py`

Add:

```python
@pytest.fixture(autouse=True)
def clear_price_caches():
    """Many API tests seed price_bars directly (not through store()) and reuse tickers like AAA
    with different prices. A module-level cache would carry one test's prices into the next."""
    from app import cache

    cache.clear()
    yield
    cache.clear()
```

## Out of scope

- Do not cache `get_cached`'s OHLCV frames differently, and do not route `_load_stored_closes`
  through `get_cached`. It reads full ORM rows one ticker at a time, which is slower on a miss.
- Do not load only a date window. Different endpoints need different ranges; caching the full
  series serves all of them.
- No cross-process or database-level caching, no cache warm-up on startup, no request coalescing
  for concurrent misses.

## Acceptance criteria

1. `cd backend && .venv/bin/python -m pytest tests/test_adj_closes.py -v` passes.
   - The file uses its own SQLite fixture, following the `db_mode` pattern in
     `tests/test_api_portfolio.py`: a `tmp_path` database through `DATABASE_URL`, then
     `Base.metadata.create_all`.
   - It seeds `PriceBar` rows **directly** with `db.add(PriceBar(...))`.
   - The base data is ticker `"AAA"` on `date(2024, 1, 2)`, `date(2024, 1, 3)` and
     `date(2024, 1, 4)`: `close` `10.0, 11.0, 12.0` and `adj_close` `10.0, None, 12.0`. Other
     columns can be any non-null numbers.
   
   Tests:
   - **a.** `get_adj_closes(["AAA", "ZZZ"])` returns keys exactly `["AAA"]`. The series values are
     `[10.0, 12.0]`, its index is `[date(2024, 1, 2), date(2024, 1, 4)]`, and every index element is
     a `datetime.date` (not a `pd.Timestamp`).
   - **b. Hit.** After (a)'s call, delete all `PriceBar` rows with a direct SQL `delete`, bypassing
     `store`. Calling `get_adj_closes(["AAA"])` again still returns `[10.0, 12.0]`.
   - **c. `store` invalidates.** After a first call, call `cache.store("AAA", df)`. `df` is an OHLCV
     frame with one row on `2024-01-05` (a `DatetimeIndex`), with `close` and `adj_close` `13.0` and
     the other OHLCV columns numeric. The next call returns `[10.0, 12.0, 13.0]`.
   - **d. `evict` invalidates.** After a first call, delete the rows directly, then call
     `cache.evict("aaa")` (lowercase on purpose; evict is case-insensitive). The next call returns
     `{}`.
   - **e. Absence is not cached.** `get_adj_closes(["BBB"])` returns `{}`. Seed BBB rows directly.
     The next call returns BBB.
   - **f. Copies.** Set the returned series' first value to `-1.0`. A second call returns `10.0` as
     its first value.
   - **g. Order and deduplication.** With AAA and BBB both seeded, `get_adj_closes(["BBB", "AAA"])`
     has keys `["BBB", "AAA"]`. `get_adj_closes(["AAA", "AAA"])` has keys `["AAA"]`.
   - **h. One query for the misses, none for hits.** Monkeypatch `app.cache.session` with a wrapper
     that counts calls and delegates to the original. `get_adj_closes(["AAA", "BBB"])` (both
     uncached) uses **1** session. Calling the same again uses **0**.
2. `cd backend && .venv/bin/python -m pytest -q` passes. This is the whole backend suite, including
   every existing API test that seeds `price_bars` directly.
3. `grep -n "select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)" backend/app/routers/portfolio.py`
   prints nothing; the query moved into `cache.py`.
   `grep -c "select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)" backend/app/cache.py`
   prints `1`.
4. `grep -c "_closes_lock" backend/app/cache.py` prints at least `5`: the definition, plus its uses
   in `get_adj_closes` (2), `store`, `evict` and `clear`.
5. `cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check`
   still prints `MATCH`. It doesn't touch the database; this guards against collateral edits.
6. **Planner-run, after deploy.** The planner repeats the 2026-11-09 live timings. The second 8-ticker
   `/portfolio/risk` request should drop well under its 1–2 s baseline, and Overview's four
   concurrent requests well under 21 s. This is informational; Render's timing is noisy.

## Verification to run and paste

> **Every ad-hoc `python -c` in this section must be prefixed `DATABASE_URL=""`.**
> `app/config.py` calls `load_dotenv()` at import, and `backend/.env` holds a live Render
> connection string — so any script run without that prefix talks to the **production database**.
> `tests/conftest.py` strips the variable for `pytest` only; it does not cover scripts.
> **If you need a real database for a probe, use the pytest fixtures.**

Run each of these and paste the **complete, verbatim** output into the report — including
failures. Do not summarize, do not trim, do not clean up. **A description of the output is not the
output.**

```bash
cd backend && .venv/bin/python -m pytest tests/test_adj_closes.py -v; cd ..
cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -3; cd ..
grep -n "select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)" backend/app/routers/portfolio.py
grep -c "select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)" backend/app/cache.py
grep -c "_closes_lock" backend/app/cache.py
cd backend && DATABASE_URL="" .venv/bin/python ../contracts/tools/compare_reference.py check; cd ..
```

State which files you edited.

## Human verification — does Gunnar need to run anything?

- **Deploy, then nothing to run.** The planner times the live API (criterion 6). In the app: the
  first portfolio tab after the server wakes loads at today's speed. Every later request for the
  same holdings, on any tab and for any user, skips the database.

## Open questions

None. If an existing test fails because it relied on the old dict order or on reading fresh rows
after a direct insert **within the same test**, report `BLOCKED` with the test name. Do not edit
that test.
