# Report — Contract 0024 — Live quotes during market hours, and no more partial bars

**Status:** reported

## Summary

Two independent fixes at the same boundary: `cache.store()` now drops any row whose `close` is
null before it reaches either the TTL cache or the database, and a new `ticker_quotes` table +
`app/quotes.py` serve a live intraday price during market hours, refreshed lazily (no scheduler)
at most once per 10 minutes from one batched request.

Files as listed:
- `backend/app/quotes.py` (new)
- `backend/migrations/versions/0004_ticker_quotes.py` (new) — `revision="0004"`,
  `down_revision="0003"`, real `downgrade()`
- `backend/tests/test_quotes.py` (new) — 8 of the 13 required cases
- `backend/app/models.py` — `TickerQuote`
- `backend/app/cache.py` — the null-close guard, `store_quotes`/`get_newest_quote_fetched_at`/`get_quotes`
- `backend/app/universe.py` — `current_price`/`last_close` in `list_all`/`get_one`
- `backend/app/schemas.py` — the two new `UniverseEntry` fields
- `backend/tests/test_cache.py` — 3 of the 13 cases (the null-close guard; see below)
- `backend/tests/test_universe.py` — 2 of the 13 cases, plus one pre-existing test updated

**One file outside the list was touched: `backend/tests/test_api_universe.py`.** Explained in
full below — not a silent addition.

## `tests/test_cache.py` — why it changed

Contract 0004 marked this file untouchable except for exactly this guard, so per the contract's
own instruction, quoting the diff and the reason: I added three new tests (cases 8–10 — dropping
a null-close row, TTL-cache/database agreement after that drop, and an entirely-null-close frame
being a no-op) and a small `_ohlcv_frame` helper. **No existing test in the file was modified.**
The new tests reproduce the real AAPL bug shape directly (open/high/low/volume present, close and
adj_close null) rather than a synthetic case.

## The unplanned part: two existing tests broke, and why

Implementing `list_all()` calling `refresh_quotes_if_stale` — exactly what the contract asks for —
surfaced two problems neither in my file list nor anticipated by the contract text. Both are
mechanical, direct consequences of the required change, not scope creep.

**1. A real network call in tests that never expected one.** `refresh_quotes_if_stale`'s decision
to fetch depends on `is_market_open`, which depends on the *actual* system clock at test-run
time — not the fictional "today" in this conversation's context, the real one. The first time I
ran the full suite, `test_list_all_query_count_does_not_scale_with_ticker_count` made a real
`yf.download` call and logged `$BBB: possibly delisted; no price data found` — because the real
wall-clock happened to fall inside market hours when that test ran. This is exactly the kind of
hidden real-network call `tests/conftest.py`'s `DATABASE_URL`-stripping fixture exists to prevent
on the database side, just newly possible on the quotes side. Any test that calls `list_all()` (or
hits `GET /universe`) was now silently timing-dependent and could flake or make real external
requests depending on when the suite happens to run.

Fixed with an autouse fixture — `quotes_market_closed_by_default` — added to **both**
`test_universe.py` (in my file list) and `test_api_universe.py` (not in my file list, the
deviation). It monkeypatches `app.quotes.is_market_open` to always return `False`, making every
existing test in both files deterministic and network-free regardless of real-world time. Tests
that specifically exercise quote behavior override it themselves (see `test_universe.py`'s two new
case-11 tests, and `test_quotes.py`, which imports `is_market_open`/`needs_refresh` directly and
doesn't need the page-level fixture at all).

**2. The pre-existing query-count bound was now wrong by design.** Once the network-call issue
was fixed, `test_list_all_query_count_does_not_scale_with_ticker_count` still failed on its own
`assert count_at_2 <= 3` — a bound from contract 0008, before quotes existed. Contract 0024 itself
says "three is acceptable; per-ticker is not," explicitly anticipating the count would grow. I
updated the bound to `<= 6` (the actual new query composition: universe_tickers, fundamentals,
price_bars aggregate, latest-non-null-close, quotes' own newest-fetched-at read, and the quotes
join) and kept the load-bearing assertion — `count_at_2 == count_at_10`, i.e. it doesn't scale —
unchanged. This test **is** case 12; no separate new test was needed since the contract explicitly
says to reuse it.

**3. `test_get_history_json_null_close_is_json_null_not_nan` (contract 0021) built its fixture via
`cache.store()`.** That test's whole premise — inject a null-close bar, confirm `/history`
serializes it as JSON `null` not `NaN` — now fails at the fixture-creation step, since `store()`
categorically drops null-close rows before this contract. The underlying behavior the test checks
(does `/history` correctly serialize an *already-stored* null close, e.g. the real, undeleted AAPL
row) is untouched by this contract and still worth testing — contract 0024 explicitly does not
retroactively clean up existing bad rows, so `/history` must still handle them. I changed only the
fixture's construction: a direct `session()` + `db.merge(PriceBar(..., close=None, ...))` insert,
bypassing `cache.store()`'s guard entirely (simulating a bar that predates the guard, the exact
scenario the guard is named after), followed by `cache.clear()` so the next read reconstructs from
the database rather than serving the TTL cache's now-stale-relative-to-the-manual-insert entry.
The test's assertions are byte-for-byte unchanged.

This mirrors the precedent from contract 0017 (a one-line fix to this same file for an unrelated,
equally mechanical reason) — a narrow, fully disclosed, minimal fix to an out-of-scope test file
that the contract's own required change directly broke, rather than a silent workaround or a hard
stop.

## Design decisions

- **The TTL-cache/database divergence risk is closed by filtering once, upstream of both.**
  `store()` computes the filtered frame a single time and assigns it to both `_cache[key]` and
  `_write_to_db`'s input — there's no code path where they could see different row sets, which is
  exactly the bug contract 0004's audit found once already.
- **`last_close` is resilient to the AAPL row without needing it deleted.** `bar_stats`'s
  `max(date)` still answers "what's the newest bar" (unchanged — that's a different question), but
  `last_close` is computed from a **separate** query that ranks by date only among rows where
  `close IS NOT NULL` (a window function, since `max(date)` and `max(date WHERE close IS NOT NULL)`
  are different rows once a null-close bar exists). `get_one()` does the equivalent by dropping
  nulls from the cached frame before taking the last value. Both are deliberately written so the
  literal existing bad AAPL row — which the contract says stays until Gunnar deletes it — reports
  the correct previous session's close rather than `null`, today, before any cleanup.
  `get_quotes`/`get_one`'s fundamentals-detachment bug (see below) is the same kind of "the
  obvious code is wrong" case, caught by actually running the tests rather than assuming the
  refactor was safe.
- **A real bug I introduced and caught**: my first draft of `list_all()` moved the row-building
  loop outside the `with session()` block (required, to call `refresh_quotes_if_stale` without
  nesting sessions), but left `fundamentals_by_ticker` holding live ORM `TickerFundamentals`
  instances — accessing their attributes after the session closed raised
  `sqlalchemy.orm.exc.DetachedInstanceError`. Fixed by extracting fundamentals to plain dicts while
  the session is still open, which is also what makes the detach-then-use pattern safe for the
  `bar_stats`/`latest_close` Core `Row` results (already plain, un-detachable scalar tuples, unlike
  a full mapped-entity `select(TickerFundamentals)`).
- **A second real bug I introduced and caught**: SQLite (used in every test) round-trips a
  `DateTime(timezone=True)` column as a **naive** datetime; Postgres (production) round-trips it
  tz-aware. My first `_current_price` implementation assumed `quote["fetched_at"]` was always
  tz-aware and raised `TypeError: can't subtract offset-naive and offset-aware datetimes` the
  moment a quote came back from a SQLite-backed test. Fixed in `cache.py`'s read functions, not in
  every caller: `_fetched_at_as_utc` re-attaches UTC to a naive `fetched_at` specifically because
  `fetched_at` is *always* written as `datetime.now(timezone.utc)` (in `store_quotes`), so its
  wall-clock numbers are genuinely UTC even after SQLite drops the label — a safe relabel, not a
  guess. `as_of` is deliberately **not** put through the same normalization: it comes from
  yfinance's own bar timestamp, whose timezone this module doesn't control, so blindly relabeling a
  naive `as_of` as UTC could silently be wrong (e.g. if it were actually ET). Only `fetched_at`,
  which this codebase fully controls the origin of, gets normalized.
- **`current_price`'s freshness check lives in `universe.py`, not `quotes.py`.** The contract's
  Part 3 interface lists exactly four functions for `quotes.py`; "should this quote be shown to the
  user right now" is a `UniverseEntry`-field-semantics question that `universe.py` already owns
  (it's the module that decides what every other field means), so `_current_price` is a small
  private helper there, reusing the exported `is_market_open` and `QUOTE_TTL_MINUTES` rather than
  adding a fifth quotes.py function the contract didn't ask for.

## Verification

```
$ PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
182 passed, 2 warnings in 3.86s
```
182 > 169 (baseline stated in the contract; 13 new cases, all passing, plus the one pre-existing
test's bound updated).

```
$ grep -rnE "datetime\.now|date\.today|utcnow" backend/app/quotes.py
95:    now_utc = datetime.now(timezone.utc)
96:    now_et = datetime.now(ZoneInfo("America/New_York"))
```
Both lines are inside `refresh_quotes_if_stale` (starts line 87) — the only function in the module
that reads the real clock, after removing an initial `_now_et()` helper that technically put one
of these calls in a separate function.

```
$ grep -n "yf.download\|_download" backend/app/quotes.py
46:def _download_quotes(tickers: list[str]) -> pd.DataFrame:
50:    return yf.download(
56:    (docstring: "Exactly one yf.download call for the whole list — never a loop.")
62:    raw = _download_quotes(tickers)
```
One network-boundary function (`_download_quotes`), one call to `yf.download` inside it, one call
site (`fetch_quotes`, not inside any loop).

```
$ grep -rn "ForeignKey" backend/app/models.py
(no matches, exit 1)

$ grep -rnE "except\s*:|except Exception" backend/app/quotes.py backend/app/cache.py
(no matches, exit 1)

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py
0004_ticker_quotes.py

$ grep -n "revision\|down_revision\|def downgrade" backend/migrations/versions/0004_ticker_quotes.py
revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
def downgrade() -> None:
```
`downgrade()` drops the table — not a bare `pass`.

```
$ PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "... TestClient(app).get('/health') ..."
status: 200
body: {'status': 'ok', 'python': '3.13.15'}
```

### The contract's exact `is_market_open` verification

```
2026-09-15 10:00 Tue -> True
2026-09-15 09:29 Tue -> False
2026-09-15 16:00 Tue -> False
2026-09-19 11:00 Sat -> False
2026-09-20 11:00 Sun -> False
```
`True` only for the Tuesday 10:00 case, exactly as required.

### Criterion 8's diff check

```
$ git diff --stat backend/app/market_data.py backend/app/freshness.py backend/app/db.py \
    backend/app/export.py backend/app/routers/ backend/tests/conftest.py backend/requirements.txt frontend/
frontend/src/pages/UniversePage.tsx | 2 +-
```
This one line is not from this session — it's pre-existing, uncommitted work from contract 0023
(chart dialog), already present before I started. I did not open or edit any frontend file this
session; `git status` before and after confirms the only files I touched are backend ones listed
above.

## Human verification — not done by me

Both things the contract asks Gunnar to check need either the real market open or a running
server — neither is available here (this sandbox cannot run the backend at all, a constraint
established across every prior contract this session: any binary executed from inside a Python
virtualenv is hard-blocked). Specifically un-verified by me:

1. Applying the migration for real (`alembic upgrade head`) against the actual Postgres database.
2. During real market hours: `current_price` populated and close to `last_close`, a second request
   within a minute not re-fetching, and after 16:00 ET `current_price` reads `null` for every
   ticker. I verified the *logic* these depend on (`is_market_open`, `needs_refresh`,
   `fetch_quotes`'s single-call batching, the TTL check) via unit tests with a controlled clock —
   I did not observe it against the live site.
