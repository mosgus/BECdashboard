# Contract 0021 — JSON price-history endpoint

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

`GET /universe/{ticker}/history` returns a ticker's stored daily bars as JSON, so the frontend can
chart them.

## Why

Contract 0022 adds a price chart in a dialog. Nothing currently serves bars as JSON — the only
export is `history.csv` (contract 0017), which is shaped for saving to disk rather than for a chart
to consume, and parsing CSV in the browser means hand-rolling a parser or adding a dependency.

**The chart fetches once and slices client-side.** Ten years is 2,689 bars; date plus two prices is
roughly 110KB of JSON. Sending it all on dialog open makes the range buttons (10Y/5Y/1Y/YTD/6M/3M/
1M/5D) switch **instantly with no round trip**, which is the entire point of having them. Range
filtering therefore belongs in the browser, and this endpoint has no range parameters at all.

This is deliberately a separate contract from the chart. The endpoint is mechanical; the chart is
full of judgement. Splitting keeps each diff reviewable.

**Depends on contracts 0008 and 0017.** If `app/routers/universe.py` has no `history.csv` route,
stop and report `BLOCKED`.

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
- `backend/app/schemas.py` — two response models
- `backend/app/routers/universe.py` — one new route
- `backend/tests/test_api_universe.py` — endpoint tests

**Touch nothing else.** Do not modify `app/cache.py`, `app/universe.py`, `app/market_data.py`,
`app/freshness.py`, `app/models.py`, `app/export.py`, any migration, `tests/conftest.py`,
`tests/test_cache.py`, or anything under `frontend/`. No new dependencies. No migration — this
serves data that already exists. If the work appears to require a file not on this list, stop and
report `BLOCKED`.

## Interface

### `schemas.py`

```python
class PriceBarOut(BaseModel):
    date: date
    close: float | None
    adj_close: float | None

class HistoryResponse(BaseModel):
    ticker: str
    bars: list[PriceBarOut]
```

- **Three fields per bar, not seven.** The chart plots a line; open/high/low/volume would roughly
  double the payload for data nothing renders. `history.csv` remains the full-fidelity export.
- `close` is what the chart draws. `adj_close` rides along because it is nearly free and is what a
  total-return view would need later.
- Both nullable — the columns are nullable in `price_bars` and a null must serialize as JSON `null`,
  never `NaN`. **`NaN` is not valid JSON** and will break `JSON.parse` in the browser; pandas will
  hand you `NaN` for missing values, so convert explicitly.
- `bars` is ordered **oldest first**. The chart reads left to right and should not have to sort.

### `routers/universe.py`

```
GET /universe/{ticker}/history  →  200 HistoryResponse
                                   404 not an active member, or no stored bars
                                   503 no database configured
```

- Read via `cache.get_cached(ticker)`. **Never fetch from yfinance** — this serves what is stored. A
  chart that triggers outbound requests is how contract 0013's rate-limiting returns, one dialog
  open at a time.
- Ticker is case-insensitive in the path; `ticker` in the response is uppercase.
- `404` when the ticker is not an active universe member **or** has no stored bars. The detail
  message names the ticker and leaks nothing else.
- **No range, limit, or downsampling parameters.** The client slices. Adding them here would be
  building for a requirement that does not exist.
- Path has two segments, so it cannot collide with `/{ticker}` — unlike `export.zip` in contract
  0020, declaration order is not a hazard here. Place it beside `history.csv`.

## Out of scope

- No range/date parameters, no pagination, no downsampling.
- No OHLC or volume in the response — three fields only.
- No caching headers, no ETag.
- No changes to `history.csv`, `export.zip`, or `export.py`.
- No frontend changes of any kind. Contract 0022 consumes this.
- No new dependencies, no migration.

## Testing

No network; SQLite `tmp_path` for persistence.

Required cases:

1. `200` with `ticker` uppercased and `bars` length equal to the stored bar count.
2. `bars` is ordered oldest first — assert `bars[0].date < bars[-1].date`.
3. Each bar has exactly `date`, `close`, `adj_close` — assert the key set, so an accidental extra
   field is caught.
4. `date` serializes as `YYYY-MM-DD`.
5. A null `close` serializes as JSON `null`. **Assert the raw response text contains no `NaN`** —
   this is the case that silently breaks the browser.
6. A lowercase path resolves the same ticker and returns it uppercased.
7. `404` for a ticker not in the universe.
8. `404` for an active member with no stored bars.
9. `503` with `DATABASE_URL` unset.
10. The endpoint makes **no** call to `_download_history` or `_download_info` — monkeypatch both to
    raise and assert the request still succeeds.

## Acceptance criteria

0. Only the three listed files changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 159.
2. All ten cases present.
3. `grep -rnE "except\s*:|except Exception" backend/app/routers/universe.py` matches nothing
   (exit 1).
4. `ls backend/migrations/versions/` shows exactly three revisions.
5. `git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/export.py backend/requirements.txt frontend/`
   is empty.
6. The response for a ticker with a null price contains `null` and not `NaN` — quote the raw text in
   the report.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "history" backend/app/routers/universe.py
grep -rnE "except\s*:|except Exception" backend/app/routers/universe.py ; echo "exit=$? (1 means clean)"
ls -1 backend/migrations/versions/
git diff --stat backend/app/cache.py backend/app/universe.py backend/app/market_data.py backend/app/freshness.py backend/app/models.py backend/app/export.py backend/requirements.txt frontend/ ; echo "(empty = untouched)"
```

State in the report: the response size in KB for a 2,689-bar ticker, so contract 0022 knows what it
is fetching.

## Human verification — does Gunnar need to run anything?

**Optional — it is a JSON endpoint with no visible surface.** If you want to see it:

```bash
curl -s localhost:8000/universe/AAPL/history | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(d['ticker'], len(d['bars']), 'bars'); print('first:', d['bars'][0]); print('last :', d['bars'][-1])"
```

Expect ~2,689 bars, first dated `2016-01-04`, last matching the Coverage column. The audit covers
the rest.

## Open questions — do NOT resolve these yourself

- **Whether OHLC should be available for candlestick charts later.** Out of scope; three fields now.
- **Server-side downsampling for very long ranges.** Not justified at 2,689 points; a line chart
  renders that fine.
- **Caching headers.** Undecided; the data changes only on refresh.
