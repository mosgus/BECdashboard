# Contract 0054 — A quote for the ticker you just added, and market cap / P/E / yield without the crumb

**Status:** accepted — verified after contracts 0057 and 0058
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Adding a ticker during market hours gets it a live quote immediately, instead of a `0.00%` change
until someone else's TTL window lapses. And `market_cap`, `trailing_pe` and `dividend_yield` populate
on the deployed app, from endpoints that are not `quoteSummary`.

**Backend only. No migration, no new column, no frontend file.**

## Why

Gunnar deleted AAPL on the deployed app on 2026-09-18 and re-added it at 12:08 PM ET. Contract 0053
worked — coverage correctly ended `2026-09-17`, no partial bar. But the row showed `0.00%` change,
and `—` for market cap, P/E and yield. Two unrelated causes.

### Part A — the claim gate is coverage-blind, exactly like the `MAX` it replaced

Contract 0051 replaced `MAX(fetched_at)` with an `app_state` claim, because `MAX` could not see a
ticker that had no quote row at all. **The claim cannot see it either.** `refresh_quotes_if_stale`
reads one global timestamp (`quotes.py:153`) and returns early when it is younger than
`QUOTE_TTL_MINUTES`, so a ticker added inside another visitor's window gets no quote for up to ten
minutes. `current_price` stays null, the frontend falls back to `last_close`, and the change reads
`0.00%`.

This was a planner error, not an implementation one. The claim is right about *when the batch was
last tried* and says nothing about *which tickers it covered*.

**The fix is not to make the gate coverage-aware.** That reintroduces the storm the claim exists to
prevent: a ticker that permanently fails to quote would force a fetch on every page load. Instead,
**fetch that one ticker's quote at the moment it is added** — a targeted request bounded by a
deliberate user action, which cannot storm because adding a ticker is not something a page load does.

### Part B — `quoteSummary` is not the only source of market cap and P/E

Contract 0051 recorded that `market_cap`, `trailing_pe` and `dividend_yield` "have no public
crumb-free equivalent". **That was wrong**, and `REBUILD.md` says so where it should be corrected.
Measured 2026-09-18, yfinance 1.7.0:

- **`yf.Ticker(t).get_valuation_measures()`** reads
  `ws/fundamentals-timeseries/v1/finance/timeseries/{ticker}` on `query2` (`base.py:519` shows the
  same endpoint behind `get_shares_full`, which is what `fast_info.market_cap` is built from). **This
  is not `v10/finance/quoteSummary`.** Its index carries `Market Cap`, `Enterprise Value`,
  `Trailing P/E`, `Forward P/E`, `PEG Ratio (5yr expected)`, `Price/Sales`, `Price/Book` and two
  enterprise-value ratios, with a `Current` column plus dated quarterly ones. For AAPL:
  `Market Cap 4.918239e+12`, `Trailing P/E 38.64679` — against `.info`'s `4.86T` and `38.2`.
- **Dividends come from the chart/actions endpoint**, already proven crumb-free from Render since
  bars and quotes both use it. AAPL's trailing twelve months is `1.06`; `1.06 ÷ 337 × 100 = 0.31%`,
  against `.info`'s reported `0.33%`.

**What is not yet proven: whether the timeseries endpoint is crumb-free from Render's IP.** It cannot
be tested from a laptop where the crumb works. It is a different host and path from the one that
401s, and yfinance 1.7.0 continues without a crumb when the handshake fails
(`data.py:_make_request`), so the request will at least be attempted. **Treat this as a hypothesis
the deploy tests, and say so in the report.** If it fails, the tier returns `None` and everything
degrades exactly as it does today — this cannot make anything worse.

## Files

Modify:
- `backend/app/quotes.py` — a targeted single-ticker quote fetch
- `backend/app/universe.py` — call it at the end of `add()`
- `backend/app/market_data.py` — tier 1.5: valuation measures and trailing yield
- `backend/tests/` — tests for all of it

**Touch nothing else.** No migration, no model change, no new column, no frontend file, nothing under
`reference files/` (read-only, and it never belongs on a file list). **No new dependency.**

## Environment

Run everything as `PATH="$PWD/backend/.venv/bin:$PATH" <cmd>` from the repo root. Path-named
executables are blocked by the sandbox.

**Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls `load_dotenv()`
at import and `backend/.env` holds a live Render connection string, so an unprefixed script talks to
**production**.

The suite is **hermetic** — `conftest.py` blocks `socket` *and* `curl_cffi`, and raises
`RuntimeError`, not `OSError`, so `except Exception` handlers cannot absorb it. **Every new network
call must be mocked.** 430 tests currently pass in ~3s; keep it hermetic and keep it fast.

---

# Part A — a quote for the ticker you just added

## Interface

```python
def refresh_quote_for(ticker: str) -> None:
    """Fetch and store one ticker's live quote immediately, bypassing the batch TTL claim.

    For the moment a ticker joins the universe and provably has no quote row — the batch gate
    is about when the batch was last tried, not which tickers it covered, so a ticker added
    inside an existing claim window would otherwise show no live price (and therefore a
    0.00% change) until that window lapsed.

    Market-hours gated, like every other quote path: outside the session the Price column
    shows the most recent close by design, and a minute-bar fetch then would return the
    previous session dressed as a live quote.

    Does NOT read or write the batch claim. This is bounded by a deliberate user action, so
    it cannot produce the per-page-load storm the claim exists to prevent. No-op with no
    database configured."""
```

Put it in `quotes.py`, beside `refresh_quotes_if_stale`, so the clock and the network stay in the one
module that owns them. Reuse the existing `fetch_quotes` / `store_quotes` — **do not add a second
download path.** `fetch_quotes([ticker])` is already correct for a one-element list.

`is_enabled()` and `is_market_open(now_et)` are both checked **before** the fetch, not just before the
write, so a degraded or after-hours deployment makes no network call at all.

## Call site

`universe.add()`, **after** `refresh_ticker(...)` and after the `UniverseTicker` row is written, and
**before** the `return get_one(key)` — `get_one` reads the stored quote, so the fetch has to precede
it or the response still shows no live price on the very request that added the ticker.

Wrap it so a quote failure cannot fail the add: fundamentals are already best-effort here and a live
price is no more load-bearing. A ticker with bars and no quote is a working row; an add that 500s
because Yahoo hiccuped is not.

**Do not** call it from `refresh()`, from `list_all()`, or from any read path.

## Acceptance criteria (Part A)

1. A test proves `add()` calls `refresh_quote_for` with the added ticker.
2. A test proves `refresh_quote_for` makes **no** network call when the market is closed, and none
   when the database is disabled — assert the download mock was not invoked.
3. A test proves `refresh_quote_for` neither reads nor writes `QUOTE_ATTEMPT_KEY` — a targeted fetch
   must not consume the batch window, or the next page load would skip the batch it just pre-empted.
4. A test proves an exception from the quote path does **not** fail `add()`.

---

# Part B — tier 1.5, the timeseries endpoint

## Interface

```python
def fetch_valuation_measures(ticker: str) -> dict | None:
    """Tier 1.5. yf.Ticker(t).get_valuation_measures() reads the fundamentals-timeseries
    endpoint, NOT quoteSummary — so it is a candidate for working from Render's IP where
    .info 401s. Returns {"market_cap", "trailing_pe", "forward_pe"} for the most current
    column, omitting any value that is absent or non-finite. None on any failure."""

def fetch_trailing_yield(ticker: str) -> float | None:
    """Trailing twelve-month dividends divided by the latest close, in PERCENT units
    (0.33 means 0.33%) — the same units extract_fundamentals already stores and
    lib/format.ts's formatPercent already expects. Do not scale it again.

    Uses one year of history with actions, NOT Ticker.dividends: that property fetches
    period="max" and would download decades of daily bars for a single sum. None on failure,
    on no dividends, or when the price is missing or not positive."""
```

### Reading the valuation-measures frame without guessing

`get_valuation_measures()` returns a DataFrame whose **index** holds the metric names and whose
columns are `Current` plus dated quarters. Take values from the column literally labelled `Current`
when it exists; otherwise the **most recent** dated column; otherwise return `None`. **Do not index
by position** — column order is not a documented guarantee and a silent off-by-one here writes last
quarter's market cap as today's.

Row labels to map:

| index label | column |
|---|---|
| `Market Cap` | `market_cap` |
| `Trailing P/E` | `trailing_pe` |
| `Forward P/E` | `forward_pe` |

A missing row is `None`, not an error — the frame's shape varies by security type, and an index that
does not exist must not raise. `market_cap` is a `BigInteger` column: coerce with `int()`, and only
after confirming the value is finite. `float('nan')` reaching the database as a market cap would be
worse than a null.

### Where these fit in `fetch_fundamentals`

Unchanged: `.info` first, and **authoritative** when `is_valid_symbol` passes — full-row overwrite,
nothing else runs. That keeps one request and identical behaviour where the crumb works.

When `.info` fails, the crumb-free branch now runs **four** sources and merges them: chart meta,
search profile, valuation measures, trailing yield. Precedence for an overlapping key is later over
earlier in that order; in practice only `regular_market_price` could overlap, and chart meta's is
fine. Write the result as `partial=True`, exactly as now. Return `None` and write nothing only when
**all four** return `None`.

### The cost, and why it is bounded

An incomplete ticker now costs up to four crumb-free requests per refresh window instead of two. That
is self-limiting: once `market_cap` is non-null, `_fundamentals_incomplete` reports the row complete
and nothing is attempted again. The unbounded-retry case this replaces is the one where nothing ever
populated.

**State plainly in the report, because it is a real trade:** once tier 1.5 fills `market_cap`, the
row reads complete and `.info` is never retried, so `beta`, `average_volume`, `long_name` and
`industry` stay whatever the crumb-free tiers gave them. None of the four is rendered on the Universe
table today. This is deliberate — the alternative is retrying `.info` forever on every ticker that
Render can never complete.

### Where the derived yield differs from the reported one

`.info`'s `dividendYield` is Yahoo's own figure; ours is trailing twelve months over the latest
close. For AAPL that is `0.31%` against `0.33%`. **This is expected and must not be "fixed" by
scaling.** It is the same authoritative-when-available rule the rest of the tiering follows: where
`.info` works you get Yahoo's number, where it does not you get a defensible approximation instead of
a blank.

## Acceptance criteria (Part B)

5. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, **430 or more** tests, still
   about 3 seconds, still hermetic. No test performs real network I/O.
6. A test proves `fetch_valuation_measures` reads the `Current` column by **label**, using a mocked
   frame whose columns are deliberately ordered so that position-indexing would pick the wrong one.
7. A test proves a missing index label yields `None` for that field rather than raising, and that a
   `NaN` market cap is dropped rather than stored.
8. A test proves `fetch_trailing_yield` returns percent units — a `1.06` annual dividend against a
   `337.00` price gives approximately `0.3145`, **not** `0.003145`.
9. A test proves `fetch_trailing_yield` returns `None` for a non-payer, and for a zero or missing
   price, with no division by zero anywhere.
10. A test proves that when `.info` succeeds, **none** of the four crumb-free sources is called —
    assert the mocks were not invoked.
11. A test proves that when `.info` fails and all four crumb-free sources fail, `fetch_fundamentals`
    returns `None` and writes nothing.
12. `grep -n "period=\"max\"\|\.dividends" backend/app/market_data.py` matches nothing (exit 1) — the
    yield uses a bounded one-year window.
13. `git status --porcelain backend/migrations/` is empty; `git diff --stat frontend/` is empty.

## Verification to run and paste

Paste the **complete, verbatim** output of each, including failures.

```bash
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -10
grep -n "period=\"max\"\|\.dividends" backend/app/market_data.py ; echo "(exit $? — 1 = correct)"
grep -n "refresh_quote_for" backend/app/quotes.py backend/app/universe.py
grep -n "QUOTE_ATTEMPT_KEY" backend/app/quotes.py
git status --porcelain backend/migrations/ ; echo "(empty = no migration)"
git diff --stat frontend/ ; echo "(empty = untouched)"
git status --porcelain
```

Then the live probe — network is allowed here because it is evidence, not a test:

```bash
DATABASE_URL="" PATH="$PWD/backend/.venv/bin:$PATH" python -c "
from app.market_data import fetch_valuation_measures, fetch_trailing_yield
for t in ('AAPL','PBR','VOO','MSFT'):
    print(t, fetch_valuation_measures(t), fetch_trailing_yield(t))
"
```

`DATABASE_URL=""` is mandatory — the store functions no-op with no database, which is what this probe
wants. **Without it this writes to production.**

Expected shape: `AAPL` market cap near `4.9e12` and trailing P/E near `38.6`; `VOO` likely missing
several fields, which is fine; `PBR` a real market cap. A yield near `0.31` for AAPL — **percent
units, so `0.31`, not `0.0031`.**

## Out of scope

- **No frontend change.** Nothing here alters a column, a label or a format.
- **No coverage-aware batch gate.** Part A is a targeted fetch precisely so the batch gate stays
  purely time-based.
- No per-ticker quote refresh on any read path, no quote refresh from `refresh()` or `list_all()`.
- No new provider, no API key, no scraping of finance.yahoo.com HTML.
- No attempt to reconstruct `beta` or `average_volume`.
- No provenance column, no change to `_fundamentals_incomplete`'s definition.
- No change to the news pipeline, `schedule.py`'s windows, or the auto-refresh sweep's structure.

## Human verification — does Gunnar need to run anything?

**Yes, and Part B only proves itself on the deployed app** — locally the crumb works, so `.info`
succeeds and the whole crumb-free branch is skipped. That is the path that was never broken.

Restart the backend with `--reload` before anything visual; a `uvicorn` started without it serves the
code it was launched with, forever. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner of a bound
port.

1. **Locally:** `/universe` must look exactly as it does now. Any name, sector, market cap, P/E or
   yield that disappears is a regression — the `.info` path is supposed to be untouched.
2. **Deploy. Then, during market hours, delete a ticker and re-add it.**
   - Its change % should be a **real non-zero number immediately**, not `0.00%`. That is Part A.
   - **Market cap and P/E should populate**, and yield too if it pays a dividend. That is Part B, and
     it is the answer to whether the timeseries endpoint is crumb-free from Render.
3. If market cap appears but yield does not, the dividend/actions path is the one failing — report
   which, since they are different endpoints.
4. If **nothing** populates, tier 1.5 is crumb-gated after all. Report it; the tier costs two wasted
   requests per incomplete ticker per window and we decide whether to keep or drop it. Nothing else
   regresses.
5. `/ops` → Recent Job Runs: the `universe_refresh` detail's `fundamentals` counts should show
   `partial` incrementing on the deployed app.

## Open questions — do NOT resolve these yourself

- **Whether the derived trailing yield should replace `.info`'s reported one everywhere**, so the
  column means one thing rather than "Yahoo's number where available, ours otherwise."
- **Whether `beta` and `average_volume` are worth keeping** as columns that can only ever populate
  from Gunnar's laptop.
- **Whether a provenance column is eventually wanted** so "not reported" and "not fetched" stop being
  indistinguishable.
- `_cached_last_session` remains a single point of failure — one throttled reference fetch no-ops an
  entire sweep at any universe size. Unchanged here, still unaddressed.
