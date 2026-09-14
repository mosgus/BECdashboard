# Contract 0013 — Validate on price history; make fundamentals best-effort

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Adding a ticker succeeds whenever Yahoo will serve its price history, even when the fundamentals
request fails — and a genuinely unknown symbol is still rejected as unknown, not confused with an
upstream outage.

## Why

**Production bug.** Nothing can be added to the universe on the deployed backend. Every attempt
returns `404 Unknown symbol`, including `SPY`. The Render logs show why:

```
Crumb fetch rate-limited (HTTP 429), continuing without crumb
HTTP Error 401: {"code":"Unauthorized","description":"Invalid Crumb"}
HTTP Error 401: {"code":"Unauthorized","description":"User is unable to access this feature"}
POST /universe → 404 Not Found
```

Yahoo's `quoteSummary` endpoint — the one behind `Ticker(...).info` — requires a "crumb" token.
Obtaining it fails from Render's shared datacenter IP, so `.info` returns an empty dict, which
`is_valid_symbol` cannot distinguish from a symbol that does not exist.

**The measured asymmetry is the whole fix.** Verified 2026-09-14 against the live deployment:

| path | endpoint | on Render |
|---|---|---|
| `Ticker(x).info` — fundamentals | `quoteSummary`, needs a crumb | **fails, 401** |
| `yf.download(x)` — price history | chart endpoint, no crumb | **works** |

`POST /universe/MSFT/refresh` returned `200` with real bars at the same moment `POST /universe`
returned `404` for SPY. So price history is reachable and fundamentals are not.

Contract 0006 asserted that an empty `info` dict means "bad ticker." The logs prove that assumption
false: it means *either* a bad ticker *or* a failed handshake, and the two must stop being conflated.

**Depends on contracts 0006, 0007, 0008.** If `app/universe.py` has no `add`, stop and report
`BLOCKED`. Contract 0012 should land first; it is independent but reduces the wasted Yahoo traffic
that likely aggravates this.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## Design

**Price history becomes the source of truth for whether a symbol exists.** If Yahoo serves bars, it
is real. Fundamentals become an enrichment that may be absent, exactly as they already may be absent
field-by-field for ETFs.

A ticker whose fundamentals are missing is **still useful** — price history is what every planned
analytic actually consumes. Refusing the whole add because a name and sector could not be fetched
throws away the valuable part to protect the decorative part.

## Files

Modify:
- `backend/app/market_data.py` — fundamentals fetch becomes non-fatal; add a history-based check
- `backend/app/universe.py` — reorder `add`; backfill fundamentals in `refresh`
- `backend/app/schemas.py` — one new response field
- `backend/tests/test_market_data.py`
- `backend/tests/test_universe.py`
- `backend/tests/test_api_universe.py`

**Touch nothing else.** Do not modify `app/freshness.py`, `app/cache.py`, `app/db.py`,
`app/models.py`, `app/routers/`, any migration, `tests/conftest.py`, `tests/test_cache.py`, or
anything under `frontend/`. No new dependencies — **specifically no retry or backoff library**. If
the work appears to require a file not on this list, stop and report `BLOCKED`.

## Interface

### `market_data.py`

```python
class UpstreamUnavailable(RuntimeError):
    """Yahoo was reachable but refused the request — not a statement about the symbol."""

def symbol_has_history(ticker: str) -> bool:
    """True when yf.download returns at least one bar. The crumb-free existence check."""

def fetch_fundamentals(ticker: str) -> dict | None:
    """Fetch and persist fundamentals. Returns None when Yahoo refuses the request
    (crumb/401), rather than raising. Still raises ValueError for a symbol confirmed absent."""
```

- `fetch_fundamentals` returning `None` means **"could not fetch"**, never "symbol is bad." Nothing
  is written when it returns `None` — do not persist a row of all-nulls, which would be
  indistinguishable from a real ETF.
- `symbol_has_history` uses a **short window** — roughly the last 10 days — not ten years. It is an
  existence probe, and it runs before the expensive fetch.
- Keep `is_valid_symbol(info)` as-is. It is still correct *given* a populated dict; it is simply no
  longer the gate. Its tests must keep passing.
- **Do not add a bare `except:` or `except Exception:`.** Catch what yfinance/`curl_cffi` actually
  raise, and treat an empty-or-sentinel `info` dict as "unavailable" rather than as proof of
  absence. Name the exception types you catch in the report.

### `universe.py` — `add` reorders

1. Already-active row → `AlreadyPresent`, as now.
2. **`symbol_has_history(ticker)` → if `False`, raise `UnknownSymbol`.** This is now the only thing
   that decides whether a symbol exists.
3. `fetch_history(ticker, start=<today - HISTORY_YEARS>, end=None)`.
4. `fetch_fundamentals(ticker)` — **best effort.** `None` is not an error.
5. Insert or reactivate membership.
6. Return the `get_one` shape.

Order still matters: nothing is written before step 2 succeeds, so an unknown symbol leaves no row.

### `universe.py` — `refresh` backfills

After `refresh_ticker`, if the ticker has **no** fundamentals row, attempt `fetch_fundamentals`
once, best-effort. This is how a ticker added during an outage heals itself: refresh it later and
the name and sector fill in.

Do not refetch fundamentals that already exist. Fundamentals staleness remains an open question in
`REBUILD.md` and this contract does not settle it.

### `schemas.py` — one field

Add to `UniverseEntry`:

```python
has_fundamentals: bool
```

`True` when a `ticker_fundamentals` row exists for that ticker. The frontend needs to distinguish
"this is an ETF with no market cap" from "we never got this ticker's fundamentals" — both currently
render as `—` and mean very different things.

No migration: this is derived from the existing join, not stored.

`UniverseDetail` inherits it. Do not redeclare.

## Out of scope

- **No retry, backoff, or rate limiting.** `REBUILD.md` defers it and this contract does not
  justify it — the fix is to stop depending on the failing endpoint, not to hammer it more politely.
- No proxy, no alternate data provider, no scraping.
- No changes to `freshness.py` or the drift logic.
- No frontend changes. A follow-up contract surfaces `has_fundamentals`; adding the field is enough
  here.
- No migration, no model changes.
- No delete endpoint, no bulk refresh.
- Do not remove `is_valid_symbol` or `_download_info`.

## Testing

No network, no database. Monkeypatch `_download_info` and `_download_history`.

Required cases:

1. `symbol_has_history` is `True` when the downloader returns bars, `False` for an empty frame.
2. `add` succeeds when history exists and `fetch_fundamentals` returns `None` — membership row
   created, history stored, no fundamentals row.
3. `add` raises `UnknownSymbol` when `symbol_has_history` is `False`, **even if** `_download_info`
   would have returned something. History is the authority.
4. `add` leaves **no** membership row when it raises `UnknownSymbol` — assert the table is empty.
5. `add` still stores fundamentals normally when they are available.
6. `fetch_fundamentals` returns `None` — not raising — when `_download_info` returns the
   crumb-failure shape (an empty dict, and separately `{'trailingPegRatio': None}`).
7. `fetch_fundamentals` writes **nothing** when it returns `None`. Assert no all-null row appears.
8. `list_all` reports `has_fundamentals: False` for a ticker added without them, `True` otherwise.
9. `refresh` backfills fundamentals when absent, and **does not** refetch when present — assert the
   fetch was not called in the second case.
10. An ETF still round-trips with six null fields and `has_fundamentals: True` — absent fields and
    absent row are different things.
11. `GET /universe` includes `has_fundamentals` on every row.
12. No regression: the existing `is_valid_symbol` tests still pass unmodified.

## Acceptance criteria

0. Only the six listed files changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from contract 0012's total.
2. All twelve cases present.
3. `grep -rnE "except\s*:|except Exception" backend/app/market_data.py backend/app/universe.py`
   matches nothing (exit 1).
4. `git diff --stat backend/app/freshness.py backend/app/cache.py backend/app/models.py backend/app/db.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt`
   is empty.
5. `ls backend/migrations/versions/` still shows exactly three revisions.
6. `grep -cE '^\s+has_fundamentals\s*:' backend/app/schemas.py` prints `1`, not `2`.
7. No frontend file changed: `git diff --stat frontend/` is empty.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -rnE "except\s*:|except Exception" backend/app/market_data.py backend/app/universe.py ; echo "exit=$? (1 means clean)"
grep -cE '^\s+has_fundamentals\s*:' backend/app/schemas.py ; echo "(must print 1)"
ls -1 backend/migrations/versions/
git diff --stat frontend/ backend/app/freshness.py backend/app/cache.py backend/app/models.py backend/tests/conftest.py backend/requirements.txt ; echo "(empty = untouched)"
```

State in the report: exactly which exception types you catch around the fundamentals fetch, and how
you distinguish a crumb failure from a genuinely absent symbol.

## Human verification — does Gunnar need to run anything?

**Yes — against the live deployment, since that is the only place the bug reproduces.** It does not
reproduce locally; fundamentals work fine from a home IP.

```bash
curl -s -X POST https://blue-eagle-backend.onrender.com/universe \
  -H 'Content-Type: application/json' -d '{"ticker":"SPY"}' -w "\nHTTP %{http_code}\n" | head -c 400
curl -s -X POST https://blue-eagle-backend.onrender.com/universe \
  -H 'Content-Type: application/json' -d '{"ticker":"NOTAREALTICKER"}' -o /dev/null -w 'bad symbol -> %{http_code}\n'
curl -s https://blue-eagle-backend.onrender.com/universe | python3 -m json.tool | grep -E 'ticker|has_fundamentals'
```

What proves it worked:

- **SPY returns `201`**, with `bar_count` around 2,500 — even if `short_name` is `null`.
- **`NOTAREALTICKER` still returns `404`.** If it returns `201`, the existence check is broken and
  the universe will accept anything.
- `has_fundamentals` is `false` for anything added during the outage and `true` for the tickers
  added before it.

Then `POST /universe/SPY/refresh` later — if Yahoo's crumb is working by then, the name and sector
should fill in, which is the self-healing path.

## Open questions — do NOT resolve these yourself

- **Whether the crumb failure is IP throttling or `curl_cffi` TLS fingerprinting on Linux.**
  Unresolved and not worth resolving — the fix is to not depend on that endpoint. Do not add a
  proxy, a user-agent override, or a `curl_cffi` impersonation setting to chase it.
- **Fundamentals staleness.** Prices and fundamentals go stale on different clocks; `refresh` only
  backfills when absent. Still unscoped.
- **Surfacing `has_fundamentals` in the UI.** A follow-up frontend contract, not this one.
- **Retry and backoff.** Still deferred.
