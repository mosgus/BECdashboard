# Contract 0001 — Backend scaffold

**Status:** open
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

A runnable FastAPI backend with a health endpoint, the price-cache interface behind which real
caching will later live, and pytest wired up — so every later contract has somewhere to put code
and something objective to verify against.

## Why

Nothing exists in `backend/` yet. `REBUILD.md` decided: Python 3.13, FastAPI, stateless, no
database, no Docker, in-process TTL cache via `cachetools`, deployed on Render's native Python
runtime. This contract builds the smallest thing that is actually runnable and testable under
those decisions. No business logic — that starts at 0003.

The cache interface matters more than it looks. `REBUILD.md` commits to building it behind
`get_cached` / `store` specifically so that adding real persistence later is a change to one
module rather than a rewrite. Get the boundary right even though the implementation is trivial.

## Environment

Assume conda env `blue-eagle` on Python 3.13 exists and is active. Verify first:

```bash
python --version        # must report 3.13.x
```

If it does not report 3.13.x, stop and report `BLOCKED`. Do not create, modify, or switch conda
environments — that is Gunnar's to do.

## Files

Create:
- `backend/requirements.txt` — pinned top-level deps only
- `backend/app/__init__.py` — empty
- `backend/app/main.py` — FastAPI app, CORS, `/health`
- `backend/app/config.py` — settings read from environment
- `backend/app/cache.py` — the price-cache interface
- `backend/tests/__init__.py` — empty
- `backend/tests/test_cache.py` — tests for `app/cache.py`
- `backend/.env.example` — documented, no real values
- `backend/pytest.ini` — so `pytest` works from `backend/`

**Touch nothing else.** Do not modify `README.md`, `REBUILD.md`, `.gitignore`, or anything under
`agent_prompts/`. If the work appears to require a file not on this list, stop and report
`BLOCKED`.

## Interface

### `app/cache.py`

An in-process TTL cache keyed by ticker. `cachetools.TTLCache`, 24-hour TTL, `maxsize=512`.

```python
import pandas as pd

def get_cached(ticker: str) -> pd.DataFrame | None:
    """Return cached price history for ticker, or None if absent or expired.
    Ticker lookup is case-insensitive; normalize to uppercase internally."""

def store(ticker: str, df: pd.DataFrame) -> None:
    """Cache price history for ticker. Overwrites any existing entry."""

def clear() -> None:
    """Drop all cached entries. Exists for tests; do not call from app code."""
```

Callers must never see the underlying cache object. No module-level mutable state other than the
cache instance itself.

### `app/config.py`

```python
class Settings:
    cors_origins: list[str]   # from CORS_ORIGINS env var, comma-separated
                              # default: ["http://localhost:5173"]
```

Plain class or Pydantic `BaseSettings` — your call, but no new dependency for it beyond what is
already in `requirements.txt`.

### `app/main.py`

```python
app = FastAPI(title="Blue Eagle API")
# CORSMiddleware using settings.cors_origins; allow_credentials=False,
# allow_methods=["*"], allow_headers=["*"]

@app.get("/health")
def health() -> dict:
    """Returns {"status": "ok", "python": "<major.minor.patch>"}"""
```

### `requirements.txt`

Top-level only, pinned with `==`. Exactly these, nothing more:

```
fastapi
uvicorn[standard]
pandas
cachetools
pytest
httpx
```

`httpx` is for FastAPI's `TestClient`. Resolve each to the current version that supports Python
3.13 and pin it. Do not add `yfinance`, `scipy`, `statsmodels`, or `numpy` — they arrive when a
contract actually needs them.

## Out of scope

- No `yfinance`, no network calls of any kind.
- No `GET /tickers`, no `POST /portfolio/analyze`. Those are later contracts.
- No Dockerfile, no `render.yaml`. Render uses its native Python runtime — this was decided.
- No database, no ORM, no migrations, no SQLite.
- No logging framework, no middleware beyond CORS.
- Do not port any code from `main`. The old backend is a reference for later contracts, not this
  one.

## Acceptance criteria

1. `python --version` reports 3.13.x.
2. `pip install -r backend/requirements.txt` completes without error.
3. `pytest -q` from `backend/` passes, with at least these cases in `test_cache.py`:
   - `get_cached` returns `None` for a ticker never stored
   - `store` then `get_cached` round-trips a DataFrame intact (compare with
     `pandas.testing.assert_frame_equal`)
   - lookup is case-insensitive: `store("aapl", df)` then `get_cached("AAPL")` returns `df`
   - `clear()` empties the cache
4. `uvicorn app.main:app --port 8000` from `backend/` starts without error.
5. `curl -s localhost:8000/health` returns JSON with `"status": "ok"` and a `"python"` field
   beginning `3.13`.
6. A browser request from `http://localhost:5173` is not CORS-blocked — verify with the
   `Origin` header below and check for `access-control-allow-origin` in the response.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including any failures.

```bash
python --version
pip install -r backend/requirements.txt
cd backend && pytest -q
cd backend && (uvicorn app.main:app --port 8000 & sleep 3; curl -s localhost:8000/health; echo; curl -s -D- -o /dev/null -H "Origin: http://localhost:5173" localhost:8000/health | grep -i access-control; kill %1)
```

## Open questions — do NOT resolve these yourself

- Where the symbol list for `GET /tickers` comes from. Not part of this contract; do not add a
  symbols module, a data file, or a placeholder endpoint in anticipation of it.
- Whether the cache ever gains real persistence. Build the interface, not the future.
