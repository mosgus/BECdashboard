# Contract 0006 — yfinance fetch and persist

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Real market data enters the system: price history and fundamentals are fetched from yfinance,
normalized to the project's canonical shapes, and persisted — with the network boundary isolated
behind pure functions that are tested without touching the network.

## Why

Everything so far has been plumbing with no data in it. This contract is the first that fetches.

It is deliberately scoped to **getting data in correctly, once**. Keeping it *correct over time* —
the freshness rule, partial-bar guards, and split/dividend drift detection — is contract 0007.
Those were split out because drift detection is the piece where a wrong answer is invisible, and it
deserves its own audit rather than being the sixth thing checked in a large diff.

`REBUILD.md` records every measurement this contract depends on, taken live on 2026-09-13. Do not
re-derive them and do not assume a field exists; the traps are specific and enumerated below.

**Depends on contracts 0004 and 0005.** If `backend/app/models.py` lacks `adj_close`, stop and
report `BLOCKED`.

## Environment

The venv at `backend/.venv` exists. Prepend it to `PATH` on every command — never activate, never
bare `python`, never name the interpreter by path (the sandbox rejects path-named executables):

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no database and no network.** See Testing.

## Files

Create:
- `backend/app/market_data.py` — the yfinance boundary and its pure transformations
- `backend/tests/test_market_data.py` — tests for the pure functions
- `backend/tests/fixtures/__init__.py` — empty
- `backend/tests/fixtures/yf_samples.py` — captured yfinance shapes as literals

Modify:
- `backend/requirements.txt` — add `yfinance`, pinned with `==`
- `backend/app/cache.py` — add `store_fundamentals()` / `get_fundamentals()`

**Touch nothing else.** Do not modify `app/main.py`, `app/db.py`, `app/models.py`,
`app/config.py`, any migration, `backend/tests/test_cache.py`, or anything under `frontend/`. No
router changes, no endpoints. If the work appears to require a file not on this list, stop and
report `BLOCKED`.

## Architecture — this part is not negotiable

Separate I/O from transformation. Network functions stay thin enough to be obviously correct;
everything with logic in it is pure and tested.

```python
# --- network boundary: thin, no logic, not unit-tested ---
def _download_history(ticker: str, start: date | None, end: date | None) -> pd.DataFrame
def _download_info(ticker: str) -> dict

# --- pure: all the logic, fully tested, no network ---
def normalize_history(raw: pd.DataFrame) -> pd.DataFrame
def extract_fundamentals(ticker: str, info: dict, fetched_at: datetime) -> dict
def is_valid_symbol(info: dict) -> bool

# --- composition: fetch, transform, persist ---
def fetch_history(ticker: str, start: date | None = None, end: date | None = None) -> pd.DataFrame
def fetch_fundamentals(ticker: str) -> dict
```

If a bug can only be caught by hitting the network, it is in the wrong function. Move it.

## Interface

### `_download_history`

```python
yf.download(ticker, start=start, end=end, auto_adjust=False, progress=False, threads=False)
```

**`auto_adjust=False` is required**, not a default to leave alone. `REBUILD.md` decided to store
raw OHLC as an invariant plus `adj_close` as the restatement-prone value. `auto_adjust=True`
collapses them and makes contract 0007's drift detection impossible.

### `normalize_history(raw)` — pure

Returns the canonical six-column shape defined in `REBUILD.md`: `DatetimeIndex` named `date` at
`datetime64[us]`; `open, high, low, close, adj_close` as `float64`; `volume` as `Int64`; all six
always present, in that order.

- Flatten `MultiIndex` columns first — yfinance returns one for single-ticker downloads. Measured:
  `isinstance(raw.columns, pd.MultiIndex)` is `True` for `yf.download('AAPL', ...)`.
- `Adj Close` → `adj_close`. `app/cache.py:_normalize_ohlcv` already does the lowercase +
  space/hyphen-to-underscore mapping and the `reindex` fill. **Reuse it — import it, do not
  reimplement.** Two normalizers that drift apart is the failure this project has already hit twice.
- Empty input returns an empty frame with the canonical columns, not a bare `pd.DataFrame()`.

### `is_valid_symbol(info)` — pure

```python
def is_valid_symbol(info: dict) -> bool:
    """True when yfinance returned a real security."""
```

**Measured behaviour, do not use `try/except`:** an invalid symbol does **not** raise.
`yf.Ticker("NOTAREALTICKER").info` returns `{'trailingPegRatio': None}` and logs an HTTP 404 to
stderr. A `try/except` here silently turns every user typo into a server error.

Test for a required key — `regularMarketPrice` or `shortName` present and non-`None`. A valid
equity returns ~180 keys, a valid ETF ~103.

### `extract_fundamentals(ticker, info, fetched_at)` — pure

Returns a dict keyed by `TickerFundamentals` column names. Exact mapping, measured live:

| column | yfinance key |
|---|---|
| `ticker` | *(the argument, uppercased)* |
| `short_name` | `shortName` |
| `long_name` | `longName` |
| `sector` | `sector` |
| `industry` | `industry` |
| `currency` | `currency` |
| `exchange` | `exchange` |
| `quote_type` | `quoteType` |
| `regular_market_price` | `regularMarketPrice` |
| `previous_close` | `previousClose` |
| `market_cap` | `marketCap` |
| `trailing_pe` | `trailingPE` |
| `forward_pe` | `forwardPE` |
| `dividend_yield` | `dividendYield` |
| `fifty_two_week_high` | `fiftyTwoWeekHigh` |
| `fifty_two_week_low` | `fiftyTwoWeekLow` |
| `beta` | `beta` |
| `average_volume` | `averageVolume` |
| `fetched_at` | *(the argument)* |

Four traps, all measured, all with tests below:

1. **Use `regularMarketPrice`, never `currentPrice`.** `currentPrice` is absent for ETFs — SPY has
   no `currentPrice` — and present for equities. Using it blanks the price for every fund.
2. **`dividendYield` is already in percent units.** AAPL returns `0.33` meaning 0.33%. **Do not
   multiply by 100.** (Older yfinance returned a fraction; it changed.)
3. **Absent keys become `None`, never `0`.** TSLA and BRK-B omit `dividendYield` entirely rather
   than returning zero. `0.0` would render as a real 0.00% yield, which is a different claim.
4. **ETFs lack five fields**: `sector`, `industry`, `market_cap`, `beta`, `currentPrice`. All must
   extract as `None` without error.

Use `info.get(key)` throughout. Do not coerce, do not default, do not `or 0`.

### `app/cache.py` additions

```python
def store_fundamentals(ticker: str, data: dict) -> None:
    """Upsert one row into ticker_fundamentals. No-op when no database is configured."""

def get_fundamentals(ticker: str) -> dict | None:
    """Read one row back, or None. Case-insensitive on ticker."""
```

- Same dialect-aware `INSERT ... ON CONFLICT DO UPDATE` pattern as `_write_to_db`, keyed on
  `ticker`. Reuse the existing approach; do not invent a second one.
- Uppercase the ticker on both paths, matching `get_cached`/`store`.
- No-op (not an exception) when `is_enabled()` is `False`, matching how `store()` behaves.
- **`clear()` must not touch fundamentals in the database.** It stays TTL-only.

### `fetch_history` / `fetch_fundamentals`

Compose download + transform. `fetch_history` calls `store()` with the normalized frame;
`fetch_fundamentals` calls `store_fundamentals()`. Both return what they fetched.

`fetch_fundamentals` raises `ValueError(f"Unknown symbol: {ticker}")` when `is_valid_symbol()` is
`False`. That message must not include the raw `info` dict.

## Testing

**No network, no database.** Capture real yfinance shapes as literals in
`tests/fixtures/yf_samples.py` and test the pure functions against them. SQLite `tmp_path` for
persistence, as in 0004 and 0005.

The fixtures must be *real* shapes, not idealized ones — capture them by actually calling yfinance
once while writing the contract, then paste the literals. Required fixtures:

- `AAPL_INFO` — a full equity `info` dict (the ~18 keys in the mapping table above are enough)
- `SPY_INFO` — an ETF: **no** `sector`, `industry`, `marketCap`, `beta`, `currentPrice`
- `TSLA_INFO` — an equity with **no** `dividendYield` key at all
- `INVALID_INFO` — literally `{'trailingPegRatio': None}`
- `AAPL_HISTORY_RAW` — a `yf.download(..., auto_adjust=False)` frame: `MultiIndex` columns,
  `Adj Close` present, index named `Date` at `datetime64[s]`, `Volume` as `int64`

Required cases:

1. `normalize_history(AAPL_HISTORY_RAW)` produces the canonical six-column shape, `MultiIndex`
   flattened, `Adj Close` landing in `adj_close` with values intact.
2. `normalize_history` on an empty frame returns an empty frame with canonical columns.
3. `extract_fundamentals(AAPL_INFO)` maps every column in the table correctly.
4. `extract_fundamentals(SPY_INFO)` yields `None` for all five ETF-absent fields and a real
   `regular_market_price` — **the test that proves trap 1 is handled.**
5. `extract_fundamentals(TSLA_INFO)` yields `dividend_yield is None`, **not `0`** — assert
   `is None` explicitly, since `assert not x` passes for both.
6. `dividend_yield` equals the raw value — for `AAPL_INFO` with `dividendYield: 0.33`, the result
   is `0.33`, not `33.0` and not `0.0033`.
7. `is_valid_symbol(INVALID_INFO)` is `False`; `is_valid_symbol(AAPL_INFO)` and
   `is_valid_symbol(SPY_INFO)` are `True`.
8. `store_fundamentals` → `get_fundamentals` round-trips, including `None`s for ETF fields.
9. `store_fundamentals` twice for one ticker leaves exactly one row, with the second write's values.
10. `clear()` leaves fundamentals rows intact in the database.
11. Degraded mode: with no `DATABASE_URL`, `store_fundamentals` is a no-op and does not raise.
12. `fetch_fundamentals` raises `ValueError` for an invalid symbol, and the message does not contain
    the `info` dict.

For 1–7 and 12, monkeypatch `_download_info` / `_download_history` to return fixtures. Do not hit
the network in any test.

## Out of scope

- **No freshness logic.** No "is this stale", no last-trading-session derivation, no incremental
  append, no partial-bar guard. Contract 0007.
- **No split/dividend drift detection.** Contract 0007. This contract only makes `adj_close`
  available for it.
- No universe table, no add/remove/list. Contract 0008.
- No API endpoints, no router, no frontend.
- No caching of `info` beyond what `store_fundamentals` persists.
- No retry, backoff, or rate limiting. Not yet justified by a measured problem.
- No `pandas_market_calendars` — `REBUILD.md` rejects it.
- Do not modify `_looks_like_ohlcv` or `_normalize_ohlcv`. Reuse; do not refactor.
- Do not port `reference files/old_yfinance_project/YF.py`. Its CSV layer, CLI, `_OLD.csv` backups,
  and stdout-redirect error handling are all explicitly not carried. Its *ideas* arrive in 0007.

## Acceptance criteria

0. Every file in the Files list exists.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with **no network and no
   database**. Count increases from 24.
2. `yfinance` is pinned with `==` in `requirements.txt` and absent from `requirements-dev.txt`.
3. `grep -rn "auto_adjust" backend/app/market_data.py` shows `auto_adjust=False` and no `True`.
4. `grep -rn "currentPrice" backend/app/market_data.py` matches nothing (exit 1) — trap 1.
5. `grep -rnE "dividendYield.*\*\s*100|\*\s*100.*dividend" backend/app/market_data.py` matches
   nothing (exit 1) — trap 2.
6. `grep -rnE "except\s*:|except Exception" backend/app/market_data.py` matches nothing (exit 1) —
   symbol validity is a key check, not an exception handler.
7. `backend/tests/test_cache.py` unmodified: `git diff --stat backend/tests/test_cache.py` empty.
8. No network in tests: `grep -rnE "yf\.|yfinance" backend/tests/` matches nothing (exit 1).
9. `grep -rnE "DELETE|delete\(\)" backend/app/cache.py` matches nothing (exit 1).
10. Degraded mode intact: app imports and `/health` returns 200 with `DATABASE_URL` unset.

## Verification to run and paste

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "yfinance" backend/requirements.txt backend/requirements-dev.txt
grep -rn "auto_adjust" backend/app/market_data.py
grep -rn "currentPrice" backend/app/market_data.py ; echo "exit=$? (1 means clean)"
grep -rnE "dividendYield.*\*\s*100|\*\s*100.*dividend" backend/app/market_data.py ; echo "exit=$? (1 means clean)"
grep -rnE "except\s*:|except Exception" backend/app/market_data.py ; echo "exit=$? (1 means clean)"
grep -rnE "yf\.|yfinance" backend/tests/ ; echo "exit=$? (1 means no network in tests)"
grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$? (1 means clean)"
git diff --stat backend/tests/test_cache.py ; echo "(empty = 0001 tests untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; assert TestClient(app).get('/health').status_code == 200; print('health 200, degraded mode intact')"
```

State in the report: how you captured the fixtures, and every yfinance key you found missing from a
sample that the mapping table expects.

## Human verification — does Gunnar need to run anything?

**Yes — run it against the real service. This is the first contract where that matters.**

Nothing in this contract's tests touches the network or Postgres. Both are mocked or SQLite. The
Postgres code path from contract 0004 (`pg_insert`, `pool_pre_ping`, the `postgres://` rewrite) has
**never executed against a real server**, and yfinance has never been called from this codebase.

Once the Render instance exists, with `DATABASE_URL` set in `backend/.env`:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m alembic upgrade head
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from app.market_data import fetch_fundamentals, fetch_history
from app.cache import get_fundamentals, get_cached
for t in ['AAPL', 'SPY']:
    f = fetch_fundamentals(t); h = fetch_history(t)
    print(t, '| name:', f['short_name'], '| price:', f['regular_market_price'],
          '| sector:', f['sector'], '| yield:', f['dividend_yield'], '| bars:', len(h))
print('AAPL from DB:', len(get_cached('AAPL')), 'bars,', get_fundamentals('AAPL')['short_name'])
"
```

What proves it worked: **SPY shows a real price with `sector: None`** (trap 1 — a blank price means
`currentPrice` crept in), AAPL's yield reads like `0.33` rather than `33.0` or `0.0033` (trap 2),
and the second read comes from the database rather than the fetch.

## Open questions — do NOT resolve these yourself

- **How much history to fetch by default.** `fetch_history` takes `start`/`end`; what the *caller*
  passes when a ticker is first added is undecided. Do not invent a default window inside
  `fetch_history` beyond passing `None` through to yfinance.
- **Whether fundamentals and history are fetched together** when a ticker is added. That is
  contract 0008's orchestration.
- **What happens when a ticker is valid but has no price history** (a recent IPO). `YF.py:88-108`
  retries without a start date; whether that behaviour is wanted is undecided. Do not add a retry.
- **Rate limiting and retry policy.** Undecided; no measured problem yet.
