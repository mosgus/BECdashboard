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

A virtualenv at `backend/.venv` on Python 3.13.15 already exists — Gunnar created it. Do not
create, modify, or delete virtualenvs, and do not `brew install` anything.

**How to invoke it.** Prepend the venv's `bin` to `PATH` inside each command and call `python` by
name. From the repo root:

```bash
PATH="$PWD/backend/.venv/bin:$PATH" python --version      # must report 3.13.x
```

From inside `backend/`:

```bash
PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

If the first command does not report 3.13.x, stop and report `BLOCKED`.

Three ways of doing this are wrong, and each fails differently:

- **`source .venv/bin/activate` in one command, then `pytest` in the next.** Shell state does not
  persist between your tool calls. The second command silently runs against the system Python.
- **Bare `python` or `python3`.** `python` does not exist on `PATH`; `python3` is the macOS system
  3.9.6. Neither has this project's dependencies.
- **`backend/.venv/bin/python` as an explicit path.** Verified 2026-09-11: the tool sandbox
  rejects any executable named by path — including relative paths inside the repo — with "Access
  to a sensitive path is not allowed." Only `PATH`-resolved command names run. The `PATH=` prefix
  form above is the one that works, and it works in an unsandboxed shell too.

Setting `PATH` inline on each command is deliberate: it makes every command self-contained, so it
cannot be broken by the non-persistence above.

There is no conda in this project. An earlier draft of this contract specified a conda env; that
was reversed — see `REBUILD.md`, "Environment: a `venv` at `backend/.venv`, not conda."

## Files

Create:
- `backend/requirements.txt` — pinned runtime deps only, the file Render installs
- `backend/requirements-dev.txt` — pinned test-only deps, never installed in production
- `backend/.python-version` — a single line, `3.13`
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

### `requirements.txt` and `requirements-dev.txt`

Two files. Top-level only, every line pinned with `==`.

`requirements.txt` — what Render installs. Exactly these, nothing more:

```
fastapi
uvicorn[standard]
pandas
cachetools
```

`requirements-dev.txt` — local and CI only. First line is `-r requirements.txt`, then:

```
pytest
httpx
```

`httpx` is for FastAPI's `TestClient`, which is why it is a dev dep and not a runtime one. Resolve
each package to the current version that supports Python 3.13 and pin it — do not invent version
numbers; install and read back what pip actually resolved. Do not add `yfinance`, `scipy`,
`statsmodels`, or `numpy` — they arrive when a contract actually needs them.

### `.python-version`

One line, no trailing content:

```
3.13
```

Render's native Python runtime reads this to select the interpreter. Without it, Render picks its
own default and the deployed Python silently differs from local.

## Out of scope

- No `yfinance`, no network calls of any kind.
- No `GET /tickers`, no `POST /portfolio/analyze`. Those are later contracts.
- No Dockerfile, no `render.yaml`. Render uses its native Python runtime — this was decided.
- No database, no ORM, no migrations, no SQLite.
- No logging framework, no middleware beyond CORS.
- Do not port any code from `main`. The old backend is a reference for later contracts, not this
  one.

## Acceptance criteria

1. `PATH="$PWD/backend/.venv/bin:$PATH" python --version` reports 3.13.x.
2. `PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt`
   completes without error. (That file pulls in `requirements.txt`, so this covers both.)
3. `requirements.txt` contains no test-only package. `pytest` and `httpx` appear in
   `requirements-dev.txt` and nowhere else.
4. `PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` from `backend/` passes, with at least these
   cases in `test_cache.py`:
   - `get_cached` returns `None` for a ticker never stored
   - `store` then `get_cached` round-trips a DataFrame intact (compare with
     `pandas.testing.assert_frame_equal`)
   - lookup is case-insensitive: `store("aapl", df)` then `get_cached("AAPL")` returns `df`
   - `clear()` empties the cache
5. `PATH="$PWD/.venv/bin:$PATH" python -m uvicorn app.main:app --port 8000` from `backend/` starts
   without error.
6. `curl -s localhost:8000/health` returns JSON with `"status": "ok"` and a `"python"` field
   beginning `3.13`.
7. A browser request from `http://localhost:5173` is not CORS-blocked — verify with the
   `Origin` header below and check for `access-control-allow-origin` in the response.
8. `backend/.python-version` contains exactly `3.13`.

## Verification to run and paste

Run each and paste the **complete, verbatim** output, including any failures. Run from the repo
root unless a command says otherwise. Copy the `PATH=` prefixes exactly — do not substitute bare
`python`/`pip`/`pytest`/`uvicorn`, and do not rewrite them as `backend/.venv/bin/...`.

```bash
PATH="$PWD/backend/.venv/bin:$PATH" python --version
PATH="$PWD/backend/.venv/bin:$PATH" python -m pip install -r backend/requirements-dev.txt
PATH="$PWD/backend/.venv/bin:$PATH" python -c "import sys; print(sys.prefix)"
cat backend/requirements.txt backend/requirements-dev.txt backend/.python-version
grep -nE '^(pytest|httpx)' backend/requirements.txt ; echo "exit=$? (1 means clean)"
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
cd backend && (PATH="$PWD/.venv/bin:$PATH" python -m uvicorn app.main:app --port 8000 & sleep 3; curl -s localhost:8000/health; echo; curl -s -D- -o /dev/null -H "Origin: http://localhost:5173" localhost:8000/health | grep -i access-control; kill %1)
```

The third command must print a path ending in `backend/.venv`. If it prints anything else, the
`PATH` prefix did not take effect and every result after it is against the wrong interpreter —
stop and report `BLOCKED` rather than continuing.

## Open questions — do NOT resolve these yourself

- Where the symbol list for `GET /tickers` comes from. Not part of this contract; do not add a
  symbols module, a data file, or a placeholder endpoint in anticipation of it.
- Whether the cache ever gains real persistence. Build the interface, not the future.
