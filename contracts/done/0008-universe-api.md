# Contract 0008 — Universe table and API

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The universe becomes a real, shared, queryable thing: a membership table, and four HTTP endpoints
to add a ticker, refresh one, list them all, and read one in detail.

## Why

Everything underneath is built and audited — persistence (0004/0005), fetching (0006), freshness
and drift repair (0007). None of it is reachable from outside Python. This contract is the seam
between the working backend and a frontend that can use it.

It is **orchestration, not new logic**. Every hard problem — partial bars, restatement, dtype
normalization, degraded mode — is already solved in a tested module. If you find yourself writing
market-data logic here, it belongs in `freshness.py` or `market_data.py` and this contract is the
wrong place for it.

`REBUILD.md` decided 2026-09-13 that membership is its own table rather than implied by presence in
`ticker_fundamentals`, so that de-listing can be a flag flip that preserves price history.

**Depends on contracts 0004–0007.** If `app/freshness.py` or `market_data.refresh_ticker` does not
exist, stop and report `BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — **do not remove or weaken it.** It exists because `pytest` was caught writing
to the production database on 2026-09-13.

## Files

Create:
- `backend/app/universe.py` — membership operations and orchestration
- `backend/app/schemas.py` — Pydantic response models
- `backend/app/routers/__init__.py` — empty
- `backend/app/routers/universe.py` — the four endpoints
- `backend/migrations/versions/0003_universe_tickers.py` — `revision = "0003"`, `down_revision = "0002"`
- `backend/tests/test_universe.py` — service-layer tests
- `backend/tests/test_api_universe.py` — endpoint tests via `TestClient`

Modify:
- `backend/app/models.py` — add `UniverseTicker`
- `backend/app/main.py` — include the router

**Touch nothing else.** Do not modify `app/cache.py`, `app/db.py`, `app/config.py`,
`app/market_data.py`, `app/freshness.py`, existing migrations, `tests/conftest.py`,
`tests/test_cache.py`, or anything under `frontend/`. No new dependencies. If the work appears to
require a file not on this list, stop and report `BLOCKED`.

## Interface

### `app/models.py` — one new model

```python
class UniverseTicker(Base):
    __tablename__ = "universe_tickers"
    ticker:   Mapped[str]      = mapped_column(String, primary_key=True)   # uppercase
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    active:   Mapped[bool]     = mapped_column(Boolean, nullable=False, default=True, index=True)
```

**No foreign keys, in either direction.** `price_bars` and `ticker_fundamentals` must not reference
this table and it must not reference them. `REBUILD.md` records why: the old app's cascade meant
de-listing a ticker silently destroyed its price history.

### Migration `0003_universe_tickers.py`

`revision = "0003"`, `down_revision = "0002"`. Creates the table and the index on `active`.
`downgrade()` drops it. Hand-written, mirroring `0002`'s style. **Do not run `alembic upgrade`** —
a valid revision is the deliverable; Gunnar applies it.

### `app/universe.py`

```python
HISTORY_YEARS = 10

def add(ticker: str) -> dict          # raises UnknownSymbol, AlreadyPresent
def refresh(ticker: str) -> dict      # raises NotInUniverse
def list_all() -> list[dict]
def get_one(ticker: str) -> dict      # raises NotInUniverse
```

Plus three exception types — `UnknownSymbol`, `AlreadyPresent`, `NotInUniverse` — defined here, not
in the router. The service layer must be usable without FastAPI.

**`add(ticker)`** — uppercase, then in this order:

1. If an `active` row already exists → raise `AlreadyPresent`. (An `inactive` row is reactivated
   rather than rejected.)
2. `market_data.fetch_fundamentals(ticker)` — this raises `ValueError` for an unknown symbol; catch
   *that specific* exception and re-raise as `UnknownSymbol`. Do not use a bare `except`.
3. `market_data.fetch_history(ticker, start=<today - HISTORY_YEARS years>, end=None)`.
4. Insert or reactivate the membership row.
5. Return the same shape as `get_one`.

**Order matters: validate before writing.** An unknown symbol must leave no membership row behind.

`HISTORY_YEARS = 10` is decided (`REBUILD.md`). Measured 2026-09-13: `yf.download` with no `start`
returns ~22 bars, which is useless for covariance or volatility. Ten years spans the 2020 and 2022
drawdowns, which is what makes risk numbers mean anything. **The default lives here, at the call
site — not inside `fetch_history`**, which contract 0006 deliberately left parameterized.

**`refresh(ticker)`** — raise `NotInUniverse` if there is no active row, else return
`market_data.refresh_ticker(ticker)`'s summary merged into the `get_one` shape. Do not reimplement
freshness or drift logic; `refresh_ticker` owns it.

**`list_all()`** — active rows only, ordered by ticker. One row per ticker with the summary fields
below. This must be **one query per table, not one per ticker** — a 50-ticker universe issuing 150
queries is the shape that makes a page feel broken.

**`get_one(ticker)`** — active row or `NotInUniverse`.

### `app/schemas.py`

```python
class UniverseEntry(BaseModel):        # list rows
    ticker: str
    short_name: str | None
    sector: str | None
    quote_type: str | None
    regular_market_price: float | None
    bar_count: int
    first_bar: date | None
    last_bar: date | None
    fetched_at: datetime | None
    added_at: datetime

class UniverseDetail(UniverseEntry):   # single-ticker view
    long_name: str | None
    industry: str | None
    currency: str | None
    exchange: str | None
    previous_close: float | None
    market_cap: int | None
    trailing_pe: float | None
    forward_pe: float | None
    dividend_yield: float | None
    fifty_two_week_high: float | None
    fifty_two_week_low: float | None
    beta: float | None
    average_volume: int | None

class RefreshResult(BaseModel):
    ticker: str
    action: str
    last_session: date | None
    bars_before: int
    bars_after: int
    drift_detected: bool
    detail: UniverseDetail
```

**Every fundamentals field is `| None`.** ETFs genuinely lack six of them — `sector`, `industry`,
`market_cap`, `beta`, `forward_pe`, and `currentPrice` (which is why `regular_market_price` is used
instead). Measured across SPY, QQQ and VTI. A non-optional field here means SPY cannot be returned.

**`dividend_yield` is already in percent units** — AAPL returns `0.33` meaning 0.33%. Pass it
through untouched. Do not multiply, do not divide, do not default absent to `0`.

### `app/routers/universe.py`

| method | path | success | errors |
|---|---|---|---|
| `GET` | `/universe` | `200` → `list[UniverseEntry]` | — |
| `POST` | `/universe` | `201` → `UniverseDetail` | `404` unknown symbol, `409` already present |
| `GET` | `/universe/{ticker}` | `200` → `UniverseDetail` | `404` not in universe |
| `POST` | `/universe/{ticker}/refresh` | `200` → `RefreshResult` | `404` not in universe |

- `POST /universe` body: `{"ticker": "AAPL"}`. Reject empty/whitespace with `422` (Pydantic).
- Map the three service exceptions to `HTTPException` in the router. The service layer raises
  domain errors; only the router knows about HTTP.
- Error bodies: `{"detail": "<message>"}`. The message names the ticker. It must **never** contain
  the connection string or a raw yfinance payload.
- **No write gate.** `REBUILD.md` decided this explicitly as an accepted risk — do not add an API
  key, a header check, or auth of any kind.

### `app/main.py`

`app.include_router(universe.router)`. Nothing else changes — do not touch CORS, `/health`, or add
startup hooks.

### Degraded mode

With no `DATABASE_URL`, membership cannot work. Every universe endpoint returns **`503`** with
`{"detail": "Database not configured"}`. The app must still import and `/health` must still return
`200` — that property is load-bearing for local frontend work and for a bad connection string on
Render producing a degraded service rather than a boot loop.

## Testing

No network, no database. SQLite `tmp_path` for persistence; monkeypatch `market_data._download_info`
and `_download_history`, or `universe`'s calls into `market_data`, so nothing fetches.

Required cases:

1. `add` on a new ticker creates a membership row and returns the detail shape.
2. `add` fetches ten years of history — assert the `start` passed to the fetch is ~10 years before
   today, not `None`. **This is the criterion that catches a 22-bar default.**
3. `add` on an already-active ticker raises `AlreadyPresent` and does **not** refetch.
4. `add` on an unknown symbol raises `UnknownSymbol` and leaves **no** membership row — assert the
   table is empty afterwards.
5. `add` on an inactive ticker reactivates it.
6. `list_all` returns only active rows, ordered by ticker.
7. `list_all` on an empty universe returns `[]`, not an error.
8. `list_all` issues a bounded number of queries — assert it does not scale per ticker. Count via a
   SQLAlchemy event listener or a wrapped session.
9. `get_one` raises `NotInUniverse` for an absent or inactive ticker.
10. `refresh` raises `NotInUniverse` for a ticker not in the universe.
11. `refresh` returns `refresh_ticker`'s action verbatim — assert it is not recomputed locally.
12. An ETF entry round-trips with `sector`, `industry`, `market_cap`, `beta` and `forward_pe` all
    `None` and a real `regular_market_price`.
13. `dividend_yield` passes through unscaled: `0.33` in, `0.33` out.
14. `GET /universe` returns `200` and a JSON list.
15. `POST /universe` returns `201`; a duplicate returns `409`; an unknown symbol returns `404`.
16. `GET /universe/{ticker}` returns `404` for an unknown ticker.
17. `POST /universe/{ticker}/refresh` returns `200` with the action.
18. With no `DATABASE_URL`, every universe endpoint returns `503` and `/health` still returns `200`.
19. No error body contains a connection string.

## Out of scope

- **No delete endpoint.** Whether removal de-lists or deletes history is an open question in
  `REBUILD.md`. Do not add `DELETE`, and do not add a route that sets `active=False`.
- **No bulk refresh.** "Update all" is unscoped and would fan out into one Yahoo request per stale
  ticker.
- No CSV import. No portfolio endpoints. No frontend, no router config, no `react-router-dom`.
- No pagination, sorting, or filtering beyond `active` and ticker order.
- No background jobs, no scheduling, no async endpoints — sync `def` handlers.
- No caching of endpoint responses.
- No auth, no API key, no rate limiting.
- Do not modify `market_data.py` or `freshness.py`. If an endpoint needs behaviour they don't have,
  that is a `BLOCKED` report, not a local reimplementation.

## Acceptance criteria

0. Every file in the Files list exists.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 74.
2. All nineteen cases above are present and meaningful.
3. `grep -rn "ForeignKey" backend/app/models.py` matches nothing (exit 1).
4. `grep -rnE "DELETE|delete\(\)" backend/app/` matches nothing (exit 1).
5. `grep -nE "^\s*HISTORY_YEARS\s*=\s*10\b" backend/app/universe.py` matches.
6. `git diff --stat backend/app/cache.py backend/app/market_data.py backend/app/freshness.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt` is empty.
7. `grep -rnE "except\s*:|except Exception" backend/app/universe.py backend/app/routers/` matches
   nothing (exit 1) — catch `ValueError` specifically.
8. The migration declares `revision = "0003"` / `down_revision = "0002"` and a non-`pass`
   `downgrade()`.
9. Degraded mode: `/health` returns `200` and `GET /universe` returns `503` with `DATABASE_URL`
   unset.

## Verification to run and paste

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
grep -rnE "DELETE|delete\(\)" backend/app/ ; echo "exit=$? (1 means clean)"
grep -nE "^\s*HISTORY_YEARS\s*=\s*10\b" backend/app/universe.py
grep -rnE "except\s*:|except Exception" backend/app/universe.py backend/app/routers/ ; echo "exit=$? (1 means clean)"
grep -n "revision\|down_revision" backend/migrations/versions/0003_universe_tickers.py
git diff --stat backend/app/cache.py backend/app/market_data.py backend/app/freshness.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from fastapi.testclient import TestClient; from app.main import app
c = TestClient(app)
print('health:', c.get('/health').status_code)
print('universe (no DB):', c.get('/universe').status_code, c.get('/universe').json())"
```

State in the report: how you counted queries for case 8, and what `list_all` does when a membership
row exists but its fundamentals row does not.

## Human verification — does Gunnar need to run anything?

**Yes — against the real database, after applying the migration.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m alembic upgrade head
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m uvicorn app.main:app --port 8000
```

Then, in a second terminal:

```bash
curl -s -X POST localhost:8000/universe -H 'Content-Type: application/json' -d '{"ticker":"MSFT"}' | head -c 400; echo
curl -s localhost:8000/universe | head -c 600; echo
curl -s -X POST localhost:8000/universe -H 'Content-Type: application/json' -d '{"ticker":"MSFT"}' -o /dev/null -w 'duplicate -> %{http_code}\n'
curl -s -X POST localhost:8000/universe -H 'Content-Type: application/json' -d '{"ticker":"NOTREAL"}' -o /dev/null -w 'bad symbol -> %{http_code}\n'
curl -s -X POST localhost:8000/universe/MSFT/refresh | head -c 300; echo
```

What proves it worked: **MSFT comes back with `bar_count` in the low thousands, not ~22** — ten
years of daily bars is roughly 2,500. A count near 22 means the default window leaked back in.
Duplicate must be `409`, bad symbol `404`, and the refresh should report `action: "none"` because
the data was just fetched.

Expect the first `POST` to take several seconds. Ten years of history is a real download.

## Open questions — do NOT resolve these yourself

- **Removing a ticker.** De-list versus delete history is undecided in `REBUILD.md`. No `DELETE`
  route, and no route that flips `active`.
- **Bulk refresh.** Undecided, and it fans out into one request per stale ticker.
- **Fundamentals staleness.** `refresh` currently updates price history via `refresh_ticker`.
  Whether it should also refetch fundamentals, and on what schedule, is unscoped — prices and
  fundamentals go stale on different clocks.
- **What a long `add` should do about HTTP timeouts.** Ten years is a multi-second request. Async
  jobs, streaming, and progress reporting are all out of scope; a synchronous request is accepted
  for now.
