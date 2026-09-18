# Contract 0051 — Crumb-free fundamentals, and the quote gate that skips new tickers

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A ticker added on the **deployed** app gets its name, type, exchange, currency, 52-week range and
(for equities) sector — none of which need Yahoo's crumb — instead of a row of blanks. And it gets a
live quote on the visit that adds it, instead of waiting out someone else's TTL.

**Backend only. No migration, no new column, no frontend file.** The `TypePill` fix is contract 0052.

## Why

Gunnar added PBR, SHNY and VOO on the deployed app on 2026-09-18. All three came back with **Name,
Sector, Mkt Cap, P/E and Yield empty** and a `0.00%` price change, while their price history loaded
fine. Two independent causes, plus one that is not a bug.

### Cause 1 — every empty column comes from one row that was never written

All five columns read from `ticker_fundamentals`, fetched through `yf.Ticker(t).info`. From Render's
IP the crumb handshake fails and `.info` 401s (contract 0013). `market_data.fetch_fundamentals`
handles that by returning `None` and **writing nothing**, deliberately:

> *"persisting a row of all-nulls would be indistinguishable from a real ETF's genuinely-absent
> fields."*

That reasoning is still right about *nulls*. It is wrong about *giving up*, because the data is not
all behind the crumb. Measured on 2026-09-18 with yfinance 1.7.0:

**`yf.Ticker(t).get_history_metadata()`** — one request to the **chart** endpoint, 0.27s, no crumb.
This is the same endpoint `yf.download` already uses for bars and quotes, **so it is already proven
to work from Render**. It returns:

```
shortName, longName, instrumentType, currency, exchangeName, fullExchangeName,
regularMarketPrice, chartPreviousClose, fiftyTwoWeekHigh, fiftyTwoWeekLow
```

Verified values: `PBR → "Petroleo Brasileiro S.A. Petrob" / EQUITY / NYSE`,
`VOO → "Vanguard S&P 500 ETF" / ETF`, `SHNY → "MicroSectors Gold 3X Leveraged " / ETF`.

**`yf.Search(ticker).quotes`** — the search endpoint, no crumb. Returns `sector` and `industry` for
equities: `PBR → Energy / Oil & Gas Integrated`, `AAPL → Technology / Consumer Electronics`. ETFs
carry no sector, which is why every ETF in the table already shows `—`.

**What stays behind the crumb: `market_cap`, `trailing_pe`, `forward_pe`, `dividend_yield`, `beta`,
`average_volume`.** These live in `quoteSummary` and have no public crumb-free equivalent. Do not
invent one; do not compute market cap from a share count that itself comes from `quoteSummary`.

And yfinance 1.7.0 degrades rather than failing — `data.py:440-452` catches a 429 or transient error
from the crumb fetch, logs, and **continues without a crumb**, letting the endpoint decide. So
crumb-free endpoints keep working while the handshake is broken.

### Cause 2 — a new ticker cannot make the quote batch look stale

`quotes.refresh_quotes_if_stale` reads `get_newest_quote_fetched_at(tickers)`, which is
`MAX(fetched_at)` (`cache.py:163`). A ticker with **no quote row at all contributes nothing to a
MAX**, so adding one can never trigger a refresh. The other 22 tickers were quoted minutes earlier,
`needs_refresh` returns `False`, and the new ticker is skipped until the TTL lapses for everyone.

With no quote, the frontend falls back to `last_close`. Since these three were added today their
coverage runs to 2026-09-18 — today's partial bar — so price and last close are the same number.
Hence `0.00%`.

**Do not fix this by swapping `MAX` for `MIN`.** A ticker that permanently fails to quote would then
make the batch look stale forever, firing a network request on **every page load**. Gate on a
last-attempt timestamp instead — the same `app_state` claim pattern `autorefresh` already uses.

### Not a bug: the `Equity` pill on VOO

`TypePill` renders `null` as `Equity`. That is contract 0052, frontend, separate.

## Files

Modify:
- `backend/app/market_data.py` — the tiered fetch and its merge
- `backend/app/cache.py` — `store_fundamentals` gains partial-merge semantics
- `backend/app/quotes.py` — gate on a last-attempt claim, not on `MAX(fetched_at)`
- `backend/app/universe.py` — retry fundamentals when the row is *incomplete*, not only when absent
- `backend/app/autorefresh.py` — record per-tier outcomes into the `job_runs` detail
- `backend/tests/` — tests for everything below

**Touch nothing else.** No migration, no model change, no new column, no frontend file, nothing under
`reference files/` (read-only, and it never belongs on a file list). **No new dependency** — `yf.Search`
ships with the pinned yfinance.

## Environment

Run everything as `PATH="$PWD/backend/.venv/bin:$PATH" <cmd>` from the repo root. Path-named
executables are blocked by the sandbox.

**Every ad-hoc `python -c` must be prefixed `DATABASE_URL=""`.** `app/config.py` calls `load_dotenv()`
at import and `backend/.env` holds a live Render connection string, so an unprefixed script talks to
**production**. `tests/conftest.py` strips the variable for `pytest` only.

The suite is **hermetic** — `conftest.py` blocks `socket` *and* `curl_cffi`, because `curl_cffi`
bypasses `socket` entirely and yfinance uses it. It raises `RuntimeError`, not `OSError`, so the
several `except Exception: continue` handlers cannot absorb it. **Every new network call must be
mocked.** 405 tests currently pass in ~3s; keep it hermetic and keep it fast.

## `market_data.py` — the tiered fetch

```python
def fetch_chart_meta(ticker: str) -> dict | None:
    """Tier 1, crumb-free. yf.Ticker(t).get_history_metadata() — the chart endpoint, the same
    one yf.download already uses for bars and quotes, so this works from Render's IP where
    .info 401s. Returns TickerFundamentals-shaped keys, or None on any failure."""

def fetch_search_profile(ticker: str) -> dict | None:
    """Tier 2, crumb-free. yf.Search(ticker).quotes — sector and industry for equities. ETFs
    legitimately carry neither. Returns None on failure or when no quote's symbol matches
    ticker exactly."""
```

`fetch_search_profile` **must match the symbol exactly** (case-insensitively). A search for `PBR`
returns `PBR-A` second and `AAPL` returns `AAPU`; taking `quotes[0]` blindly will eventually write
one company's sector onto another's row. Match, or return `None`.

Both return `None` rather than raising — same contract as today's `fetch_fundamentals`. Catch
`YFException` and `CurlRequestException`, exactly as the existing code does.

### Field mapping, tier 1

| chart meta key | column |
|---|---|
| `shortName` | `short_name` |
| `longName` | `long_name` |
| `instrumentType` | `quote_type` |
| `currency` | `currency` |
| `exchangeName` | `exchange` |
| `regularMarketPrice` | `regular_market_price` |
| `chartPreviousClose` | `previous_close` |
| `fiftyTwoWeekHigh` / `fiftyTwoWeekLow` | `fifty_two_week_high` / `fifty_two_week_low` |

`instrumentType` uses the same vocabulary `.info`'s `quoteType` does — `EQUITY`, `ETF`, `INDEX` — so
stored values stay consistent with the 22 existing rows. Use `.get()` throughout; absent keys become
`None`, never a numeric stand-in. This is `extract_fundamentals`'s existing discipline and it applies
unchanged.

### `fetch_fundamentals` becomes a tiered composition

```python
def fetch_fundamentals(ticker: str) -> dict | None:
    """Best-effort enrichment, never a gate — price history remains the sole authority on
    whether a ticker exists (symbol_has_history). Returns the merged row, or None when every
    tier failed. Never raises."""
```

Order and semantics:

1. Try `.info` as today. **If it succeeds and `is_valid_symbol` passes, it is authoritative** — write
   the full row exactly as today, overwriting every column. Nothing below runs. This keeps the 22
   existing rows behaving identically and costs one request, as now.
2. Otherwise run tier 1 and tier 2. If **both** return `None`, return `None` and write nothing — the
   current behaviour, preserved for the genuinely-unreachable case.
3. Otherwise merge what came back (tier 2 over tier 1 for overlapping keys, though only
   `sector`/`industry` come from tier 2) and write it as a **partial**.

Return the dict that was written, so `universe.refresh` can tell what happened.

### The merge rule, and why it is not optional

`cache.store_fundamentals` currently upserts **every** column unconditionally (`cache.py:93-98`). A
partial write through that path would blank AAPL's `market_cap`, `trailing_pe` and `dividend_yield`
on the next refresh. So:

```python
def store_fundamentals(ticker: str, data: dict, *, partial: bool = False) -> None:
```

- `partial=False` (the default, and what the `.info` path passes) — today's behaviour, byte for byte.
  An authoritative source is allowed to clear a field, because a non-payer really can stop paying a
  dividend.
- `partial=True` — **never overwrite a non-null stored value with `None`.** Update only the keys
  whose incoming value is not `None`. `fetched_at` is always written; it is `NOT NULL` and records
  the last time anything succeeded.

A brand-new ticker with no row at all still gets one inserted under `partial=True`, with the
crumb-gated columns left `NULL` — which is exactly what an ETF's row looks like anyway, and is the
honest representation of "not reported or not fetched."

## `universe.py` — retry incomplete rows, not just absent ones

`refresh()` currently re-fetches only when the row is entirely missing:

```python
if get_fundamentals(key) is None:
    fetch_fundamentals(key)
```

Once partial rows exist that condition is never true again, and `.info` is never retried — the
opposite of self-healing. Replace it with a helper:

```python
def _fundamentals_incomplete(row: dict | None) -> bool:
    """True when the row is absent, has no short_name, or has none of the crumb-gated fields.
    Pure — takes the row, reads no clock and no database."""
```

Incomplete when `row is None`, or `row["short_name"] is None`, or **all** of `market_cap`,
`trailing_pe` and `dividend_yield` are `None`. Refresh calls `fetch_fundamentals` when incomplete.

**The cost, stated plainly:** a ticker added from Render will look incomplete forever (its
crumb-gated fields never arrive), so it re-attempts `.info` once per auto-refresh window — at most
3 extra requests per day per such ticker. That is the price of self-healing the moment Yahoo relents,
and it is small. Do not add a backoff; do not add a column to track attempts.

Note the genuine false positive: an ETF with no market cap, no P/E and no yield reads as incomplete
even when `.info` worked perfectly. It has a `short_name`, so it is only one wasted request per
window, and distinguishing the cases needs the provenance column this contract deliberately avoids.

## `quotes.py` — gate on a claim, not on `MAX(fetched_at)`

Add an `app_state` key and gate on it:

```python
QUOTE_ATTEMPT_KEY = "quote_refresh_attempt"
```

`refresh_quotes_if_stale` becomes: if the market is closed, return (unchanged — after the close the
Price column shows the most recent close by design). Otherwise read the last attempt from
`app_state`; if it is newer than `QUOTE_TTL_MINUTES`, return. Otherwise **write the claim first**,
then fetch and store.

Claim-before-work is the pattern `autorefresh.run_auto_refresh_if_due` already uses, for the reason
recorded there: two requests arriving milliseconds apart must not both pass the check. Follow it,
including the non-blocking module-level lock.

Keep `needs_refresh` pure and keep its signature — it still takes the timestamp and the two clocks
and decides. Only what is passed in changes: the **attempt** timestamp rather than
`MAX(fetched_at)` over rows. `get_newest_quote_fetched_at` may stay in `cache.py` unused, or be
removed if nothing else calls it — check before deleting.

This fixes the new-ticker case for free: the attempt timestamp is about the batch, not the rows, so
a ticker with no row is no longer invisible to the check. And an unquotable ticker can fire at most
one attempt per TTL, not one per page load.

## `autorefresh.py` — make the deployed app answer the question this laptop cannot

I cannot verify from here whether the **search** endpoint works from Render's IP. The chart endpoint
provably does (bars and quotes work). Tier 2 is the unknown, so record it.

The sweep already runs inside `record_run("universe_refresh", …)` with a mutable `detail` dict. Add a
count of how each ticker's fundamentals resolved:

```python
detail["fundamentals"] = {"info": 0, "partial": 0, "none": 0, "skipped": 0}
```

- `info` — `.info` succeeded, the authoritative path
- `partial` — at least one crumb-free tier succeeded
- `none` — every tier failed
- `skipped` — the row was already complete, nothing attempted

`/ops` renders `job_runs` detail through `summariseDetail`, which handles nested objects since the
0049 audit fix — so this shows up without a frontend change. **On the deployed app, `partial > 0`
with sectors appearing on equities is the proof that tier 2 works from Render.**

This means `refresh()` must report which path ran. Return it in the existing result dict under a new
key — `"fundamentals": "info" | "partial" | "none" | "skipped"` — rather than having the sweep
re-query.

## Out of scope

- **No migration, no new column.** Provenance stays inferable: a row with a name but no market cap
  came from the crumb-free tiers.
- **No `TypePill` change, no frontend file.** Contract 0052.
- No new endpoint, no manual per-ticker refresh button, no admin route.
- **No scraping and no third-party data source.** Not `.info` via a proxy, not a paid API, not HTML
  parsing of finance.yahoo.com.
- No attempt to reconstruct `market_cap`, `trailing_pe` or `dividend_yield` from crumb-free data.
- No change to `symbol_has_history`, to the add/remove flow, to the news pipeline, or to
  `schedule.py`'s windows.
- No concurrency or fan-out — tickers are walked one at a time, per contract 0013.

## Acceptance criteria

1. `PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q` passes, **405 or more** tests, still
   about 3 seconds. No test performs real network I/O.
2. `grep -rn "alembic\|migration" backend/alembic/versions/` shows **no new revision file**;
   `git status --porcelain backend/alembic/` is empty.
3. `git diff --stat frontend/` is **empty**.
4. A test proves `store_fundamentals(..., partial=True)` **does not** null an existing
   `market_cap`/`trailing_pe`/`dividend_yield`, and that `partial=False` **does** overwrite them.
   This is the regression that would silently destroy your 22 good rows.
5. A test proves `fetch_search_profile` returns `None` when the search result's symbol differs from
   the requested one — the `PBR` → `PBR-A` case, mocked.
6. A test proves `fetch_fundamentals` returns `None` and writes nothing when **all three** tiers fail.
7. A test proves that when `.info` succeeds, tiers 1 and 2 are **not called** (assert the mocks were
   not invoked) — one request, as today.
8. A test proves `_fundamentals_incomplete` is `True` for a row with `short_name` set but all three
   crumb-gated fields `None`, and `False` for a row with a `market_cap`.
9. A test proves `refresh_quotes_if_stale` **does** fetch when a ticker has no quote row but another
   ticker's row is fresh — the exact bug. And a second proving two calls inside one TTL window
   produce exactly **one** fetch.
10. `grep -n "get_newest_quote_fetched_at" backend/app/quotes.py` matches nothing — the `MAX` gate is
    gone, not merely supplemented.
11. `grep -n "fundamentals" backend/app/autorefresh.py` shows the four-key detail dict.

## Verification to run and paste

Paste the **complete, verbatim** output of each, including failures.

```bash
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q 2>&1 | tail -15
PATH="$PWD/backend/.venv/bin:$PATH" pytest backend/tests -q --durations=5 2>&1 | tail -10
git status --porcelain backend/alembic/ ; echo "(empty = no migration)"
git diff --stat frontend/ ; echo "(empty = untouched)"
grep -n "get_newest_quote_fetched_at" backend/app/quotes.py ; echo "(exit $? — 1 = correct)"
grep -n "partial" backend/app/cache.py
grep -n "fundamentals" backend/app/autorefresh.py
git status --porcelain
```

Then **one live probe**, which is allowed to hit the network because it is not a test — it is the
evidence that the mapping is right:

```bash
DATABASE_URL="" PATH="$PWD/backend/.venv/bin:$PATH" python -c "
from app.market_data import fetch_chart_meta, fetch_search_profile
for t in ('PBR','VOO','SHNY','AAPL'):
    print(t, fetch_chart_meta(t), fetch_search_profile(t))
"
```

`DATABASE_URL=""` is mandatory here — `store_fundamentals` no-ops with no database, which is exactly
what this probe wants. **Without it this writes to production.**

Expected: `PBR` shows `Petroleo Brasileiro S.A. Petrob` / `EQUITY` and sector `Energy`; `VOO` and
`SHNY` show `ETF` and `None` from search (ETFs have no sector); `AAPL` shows `Technology`.

## Human verification — does Gunnar need to run anything?

**Yes, and it is the deployed app that matters — this cannot be proven locally, because locally the
crumb works and `.info` succeeds, which is the one path that was never broken.**

1. Locally first: `alembic upgrade head` is **not** needed (no migration). Restart the backend with
   `--reload`; if port 8000 is bound, `lsof -nP -iTCP:8000 -sTCP:LISTEN` names the owner. A `uvicorn`
   started without `--reload` serves the code it was launched with, forever.
2. Local `/universe`: the 22 existing rows must look **exactly** as they do now. Any name, sector,
   market cap, P/E or yield that disappears is criterion 4 failing.
3. Deploy. On the deployed app, open `/universe`. **PBR should now show `Petroleo Brasileiro S.A.
   Petrob` and sector `Energy`; VOO `Vanguard S&P 500 ETF`; SHNY `MicroSectors Gold 3X Leveraged`.**
   Market cap, P/E and yield stay `—` for all three — that is expected and is not a failure.
4. If sector stays `—` on PBR while the name appears, **tier 2 does not work from Render** and tier 1
   does. That is a real result, not a bug; report it and we decide what to do with sector.
5. Add a fresh ticker on the deployed app during market hours. It should show a **live price with a
   non-zero change**, not `0.00%` — that is cause 2 fixed.
6. `/ops` → Recent Job Runs. The `universe_refresh` row's detail should carry the fundamentals
   counts. **This is the measurement the whole contract exists to produce — read it and report the
   numbers.**

## Open questions — do NOT resolve these yourself

- **Whether sector should fall back to something else if tier 2 fails from Render.** Decide after
  step 4 reports a real result.
- **Whether `market_cap`, `trailing_pe` and `dividend_yield` are worth keeping** if they only ever
  populate from Gunnar's laptop. Possibly they become laptop-only enrichment, possibly they go.
- **Whether a provenance column is eventually wanted** so "not reported" and "not fetched" stop
  being indistinguishable.
- `_cached_last_session` remains a single point of failure — one throttled reference fetch no-ops an
  entire sweep at any universe size. Unchanged by this contract, still unaddressed.
