# Contract 0004 — Postgres persistence behind the cache interface

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Price bars and ticker fundamentals persist in Postgres, reachable through the existing
`get_cached()` / `store()` interface, with schema created by a migration and every data path
covered by tests that run without a database.

## Why

`REBUILD.md` reversed three earlier decisions on 2026-09-13: the backend is now stateful, a
database is required, and the universe is shared across users. The reason a shared universe needs
persistence is definitional; the reason it needs *this* persistence is that Render's free tier
sleeps and has an ephemeral filesystem, so an in-process cache is cold on every wake — which is
the traffic pattern most likely to get the server's single IP rate-limited by Yahoo.

`REBUILD.md` also recorded, months before it was needed, that the cache was built behind
`get_cached()` / `store()` *specifically so that adding persistence would be a change to one
module rather than a rewrite*. **This contract is the test of that claim.** If you find yourself
editing callers, stop — the boundary is wrong and that is a `BLOCKED` report, not something to work
around.

**Depends on contract 0001.** If `backend/app/cache.py` does not exist, stop and report `BLOCKED`.

## Environment

The venv at `backend/.venv` already exists. Invoke it by prepending to `PATH` on every command —
never activate, never use a bare `python`, never name the interpreter by path:

```bash
PATH="$PWD/backend/.venv/bin:$PATH" python -m pytest -q
```

From inside `backend/`, use `PATH="$PWD/.venv/bin:$PATH"`. An explicit path like
`backend/.venv/bin/python` is rejected by the tool sandbox; only `PATH`-resolved names run.

**A running Postgres is NOT required to execute this contract.** Tests must pass without one — see
Testing below. Gunnar will provision the Render instance separately; you never need its credentials.

## Files

Create:
- `backend/app/db.py` — engine, session factory, `DATABASE_URL` handling
- `backend/app/models.py` — the two tables
- `backend/alembic.ini` — Alembic config
- `backend/migrations/env.py` — Alembic environment
- `backend/migrations/script.py.mako` — Alembic template
- `backend/migrations/versions/0001_initial.py` — creates both tables
- `backend/tests/test_models.py` — schema-level tests
- `backend/tests/test_cache_backend.py` — cache-interface-over-database tests

Modify:
- `backend/requirements.txt` — add `sqlalchemy` and `psycopg[binary]`, pinned with `==`
- `backend/requirements-dev.txt` — add `alembic`, pinned with `==`
- `backend/app/config.py` — add `database_url`
- `backend/app/cache.py` — back the existing functions with the database
- `backend/.env.example` — document `DATABASE_URL`

**Touch nothing else.** Do not modify `app/main.py`, anything under `frontend/`, or any contract
file. If the work appears to require a file not on this list, stop and report `BLOCKED`.

Note on `.env.example`: the planner cannot read it (`.claude/settings.json` denies `Read(.env.*)`),
so describe your change to it in the report rather than assuming the audit will see it.

## Interface

### `app/config.py`

Add to the existing `Settings` class, without disturbing `cors_origins`:

```python
database_url: str | None   # from DATABASE_URL env var; None when unset
```

`None` when unset is deliberate — see Degraded mode below. Do not raise at import.

### `app/db.py`

```python
def get_engine() -> Engine | None:
    """Process-wide SQLAlchemy engine, created lazily on first call.
    Returns None when settings.database_url is None."""

def session() -> ContextManager[Session]:
    """Transactional scope. Commits on clean exit, rolls back on exception.
    Raises RuntimeError if no database is configured — callers must check is_enabled() first."""

def is_enabled() -> bool:
    """True when a database is configured and an engine could be created."""
```

- `psycopg` v3 driver. If `DATABASE_URL` begins `postgres://`, rewrite it to `postgresql+psycopg://`
  — Render supplies the short form and SQLAlchemy will not accept it. This is a real, known
  papercut; handle it rather than assuming the URL is well-formed.
- `pool_pre_ping=True`. Render free instances drop idle connections, and without this the first
  request after an idle period fails with a stale-connection error.
- Never log, print, or include the connection string in an exception message. It contains a
  password.

### `app/models.py`

SQLAlchemy declarative models. Two tables, and **no others in this contract or any future one
without a decision** (`REBUILD.md`).

```python
class PriceBar(Base):
    __tablename__ = "price_bars"
    ticker: str        # primary key, uppercase
    date:   date       # primary key
    open, high, low, close: float | None
    volume: int | None
    updated_at: datetime   # server default now(), updated on upsert
```

```python
class TickerFundamentals(Base):
    __tablename__ = "ticker_fundamentals"
    ticker: str        # primary key, uppercase
    short_name, long_name, sector, industry, currency, exchange, quote_type: str | None
    regular_market_price, previous_close, market_cap, trailing_pe, forward_pe: float | None
    dividend_yield, fifty_two_week_high, fifty_two_week_low, beta: float | None
    average_volume: int | None
    fetched_at: datetime   # not null — when this row was last pulled from the source
```

Hard requirements:

- **`price_bars` has NO foreign key to any universe or ticker table.** The old app had
  `ticker → universe_tickers.ticker ON DELETE CASCADE`, so de-listing a ticker silently destroyed
  its price history. Cached market data must not depend on a curated list existing. `REBUILD.md`
  records this.
- `market_cap` and `average_volume` are `BigInteger` — they exceed 32-bit. AAPL's market cap is
  ~4.8e12.
- All fundamentals columns except `ticker` and `fetched_at` are nullable. **ETFs genuinely lack
  five of them** (`sector`, `industry`, `market_cap`, `beta`, and `currentPrice`) — measured, and
  recorded in `REBUILD.md`. A `NOT NULL` here means SPY cannot be stored.
- Index on `price_bars.date`.

### `app/cache.py` — extend, do not replace

The three existing functions keep their exact signatures and semantics. Callers must not change.

```python
def get_cached(ticker: str) -> pd.DataFrame | None
def store(ticker: str, df: pd.DataFrame) -> None
def clear() -> None
```

New behaviour:

- `store()` writes through to `price_bars` **and** updates the in-process TTL cache.
- `get_cached()` checks the TTL cache first; on a miss, reads from `price_bars` and repopulates the
  TTL cache before returning. Returns `None` only when both are empty.
- `clear()` empties **only the in-process cache**. It must never issue a `DELETE`. It exists for
  tests, and a test that silently wipes a shared database is the worst outcome this contract can
  produce.
- Writes are **upserts** keyed on `(ticker, date)` — `INSERT ... ON CONFLICT DO UPDATE`. Never
  blind-insert. `REBUILD.md`'s freshness rule requires refetching the most recent stored bar
  *inclusive* and overwriting it, because yfinance can return a partial in-progress bar during
  market hours; a blind insert either crashes on the conflict or leaves the partial bar forever.
- The DataFrame contract: index is a `DatetimeIndex` named `date`; columns are lowercase
  `open, high, low, close, volume`. Normalize on write, reconstruct on read, and make the round trip
  lossless for dtypes — `assert_frame_equal` is the standard, as in 0001.

### Degraded mode — required, not optional

When `DATABASE_URL` is unset, the app must start and `/health` must still return 200, with
`get_cached`/`store` falling back to TTL-cache-only behaviour exactly as they behave today.

This is not defensive padding. It is how contract 0001's tests keep passing, how the frontend
contracts keep working locally without anyone running Postgres, and how a bad connection string on
Render produces a degraded service rather than a boot loop. Gunnar deploys today.

## Migrations

- Alembic, initialized under `backend/migrations/`.
- `migrations/env.py` reads `DATABASE_URL` from the environment. Do not hardcode a URL anywhere,
  and do not commit one.
- One revision, `0001_initial`, creating both tables and the index. Both `upgrade()` and
  `downgrade()` implemented — an empty `downgrade()` is not acceptable.
- Do **not** run `alembic upgrade` against a real database as part of this contract. Generating the
  revision and verifying it is syntactically valid is the deliverable.

## Testing

**Tests must pass with no database running.** Use SQLite in-memory for schema and round-trip tests
via SQLAlchemy, and skip anything genuinely Postgres-specific with an explicit
`pytest.mark.skipif`, naming the reason.

Required cases:

1. `get_cached` returns `None` for an unknown ticker, in degraded mode and in database mode.
2. `store` → `get_cached` round-trips a DataFrame intact (`assert_frame_equal`), database mode.
3. Case-insensitivity survives the database: `store("aapl", df)` then `get_cached("AAPL")`.
4. **Upsert**: storing overlapping dates twice leaves one row per `(ticker, date)`, with the second
   write's values. This is the partial-bar guard; it is the most important test here.
5. `clear()` empties the in-process cache and leaves database rows intact.
6. Degraded mode: with no `DATABASE_URL`, `is_enabled()` is `False`, the app imports, and
   `get_cached`/`store` behave as TTL-only.
7. A `postgres://` URL is rewritten to `postgresql+psycopg://`.
8. Fundamentals with ETF-shaped data — `sector`, `industry`, `market_cap`, `beta` all `None` —
   insert and read back without error.

A test that asserts nothing, or that asserts against the implementation rather than the
requirement, fails this contract.

## Out of scope

- **No yfinance.** No network calls of any kind. Fetching is contract 0005.
- No universe table, no API endpoints, no router changes. Contracts 0005 and 0006.
- No connection to a real Postgres instance, no `alembic upgrade`, no Render configuration.
- No caching of analysis results, no query-result caching.
- No async SQLAlchemy. Sync engine and sync sessions.
- No ORM relationships, no cascades, no foreign keys at all in this schema.
- Do not modify `app/main.py` — no startup hooks, no connection-on-boot.
- Do not port code from `main`. Its `db/models.py` is a 16-table relational schema built for
  multi-user concurrency; its `PriceBar` is useful only as a column-list reference, and its foreign
  key is the specific thing being dropped.

## Acceptance criteria

0. Every file in the Files list exists — see the `ls` command in verification.
1. `PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt`
   completes without error.
2. `requirements.txt` contains `sqlalchemy` and `psycopg[binary]`, pinned with `==`; `alembic`
   appears **only** in `requirements-dev.txt`. Migrations are a build-time tool, not a runtime
   dependency.
3. `PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` from `backend/` passes with **no database
   running**, covering all eight cases above.
4. The 0001 cache tests still pass, unmodified. If you had to edit `tests/test_cache.py`, the
   interface changed and that is a contract violation — report it.
5. `grep -rn "ForeignKey" backend/app/models.py` matches nothing (exit 1).
6. `grep -rn "DELETE\|delete()" backend/app/cache.py` matches nothing (exit 1) — `clear()` must not
   touch the database.
7. With `DATABASE_URL` unset, the app imports **and** `/health` still returns 200 — proven with
   `TestClient`, not by import alone:
   `python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200, r.status_code; print('health 200 with no DATABASE_URL')"`
8. With `DATABASE_URL` unset, `is_enabled()` returns `False` and `get_engine()` returns `None`,
   and importing `app.models` raises nothing:
   `python -c "import app.models; from app.db import is_enabled, get_engine; assert is_enabled() is False; assert get_engine() is None; print('degraded mode confirmed')"`
   (The earlier wording of this criterion — "does not attempt a connection" — was unverifiable:
   no command can prove that negative, so it would have been reported as passing by default.)
9. The migration file defines both `upgrade()` and `downgrade()`, and neither body is `pass`.
10. `app/db.py` never passes the connection string to a logger, `print`, or exception:
    `grep -nE 'print\(|logger\.|logging\.|raise .*(url|dsn|database_url)' backend/app/db.py`
    — any match must be inspected in the report and shown not to include the URL. This one is a
    read-and-justify criterion, not a pass/fail grep; say explicitly in the report which lines
    matched and why each is safe.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including failures.

```bash
ls -1 backend/app/db.py backend/app/models.py backend/alembic.ini backend/migrations/env.py backend/migrations/script.py.mako backend/tests/test_models.py backend/tests/test_cache_backend.py
ls -1 backend/migrations/versions/
PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt
cat backend/requirements.txt backend/requirements-dev.txt
grep -cE '^(sqlalchemy|psycopg\[binary\])==' backend/requirements.txt ; echo "(must print 2)"
grep -nE '^alembic==' backend/requirements.txt ; echo "exit=$? (1 means alembic correctly absent from runtime deps)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; r = TestClient(app).get('/health'); assert r.status_code == 200, r.status_code; print('health 200 with no DATABASE_URL')"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "import app.models; from app.db import is_enabled, get_engine; assert is_enabled() is False; assert get_engine() is None; print('degraded mode confirmed')"
grep -nE 'print\(|logger\.|logging\.|raise .*(url|dsn|database_url)' backend/app/db.py ; echo "(inspect each match in the report)"
grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
grep -rnE "DELETE|delete\(\)" backend/app/cache.py ; echo "exit=$? (1 means clean)"
grep -rn "def upgrade\|def downgrade" backend/migrations/versions/
```

Also state in the report, in words: what you added to `backend/.env.example`, and which tests you
skipped and why.

## Open questions — do NOT resolve these yourself

- **The universe table itself.** This contract creates *cache* tables only. Whether the curated
  ticker list is a third table, a query over `ticker_fundamentals`, or something else is undecided.
  Do not create it, do not add an `active` or `is_in_universe` column in anticipation.
- **Whether tickers can be removed from the universe**, and whether removal deletes price history.
  Open in `REBUILD.md`. Do not add delete paths.
- **Connection pool sizing and Render's connection limits.** Use SQLAlchemy defaults plus
  `pool_pre_ping`. Do not tune what has not been measured.
