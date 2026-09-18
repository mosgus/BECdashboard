# Contract 0044 — Ops backend: record job runs, expose system health

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Every automatic refresh records what it did, and one endpoint summarises the system's state.

Backend only. `GET /ops/status` and `GET /ops/job_runs`. The page that renders them is contract 0045.

## Why

Gunnar wants an `/ops` page forking two cards from the reference app: **System Health** and **Recent
Job Runs**. He explicitly does not want its Price Data Refresh card — that control no longer exists
here, since contract 0036 made refreshes automatic.

**"Recent Job Runs" is not a port — the data does not exist yet.** The reference had a real cron job
(`jobs/install_cron.sh`, `jobs/refresh_prices.py`) writing a row per nightly run into `job_runs`. This
rebuild has **no scheduler by design** — Render's free tier sleeps, so everything is lazy and
visit-triggered through the 09:30 / 12:00 / 16:00 ET windows.

Today those sweeps record only a bare timestamp in `app_state`. **If a sweep fails, it goes to
Render's stdout and nowhere else** — there is no way to answer "did the 09:30 refresh run, and did it
work?" That is the gap this closes, and it is worth closing before portfolios depend on the data
being current.

### What does not port from the reference

- **No `UNIQUE(job_name, asof_date)`.** The reference ran once a day so that constraint was free.
  Ours runs up to three times a day per job; one row per *attempt*.
- **No `POST /ops/job_runs`.** The reference exposed a write endpoint because an external cron script
  reported in. Nothing external calls us — the app records its own runs in-process.
- **No price-refresh endpoint, no digest, no auth dependency.** `require_write_key` has no analogue
  here.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network, no database and no `GEMINI_KEY`.** As of contract 0043 the suite
blocks outbound sockets — including `curl_cffi`, which is how yfinance escapes a plain `socket` patch.
A test that needs the network is a test that needs patching.

**If a command fails with `password authentication failed`, or the frontend shows "API offline" while
the server logs 200s**, your shell has a stale exported `DATABASE_URL` or `CORS_ORIGINS`; contract
0041 makes that raise at import and name the variable.

## Files

Create:
- `backend/migrations/versions/0008_job_runs.py`
- `backend/app/jobrun.py`
- `backend/app/ops.py`
- `backend/app/routers/ops.py`
- `backend/tests/test_jobrun.py`
- `backend/tests/test_ops.py`
- `backend/tests/test_api_ops.py`

Modify:
- `backend/app/models.py` — `JobRun`
- `backend/app/schemas.py` — ops response models
- `backend/app/main.py` — register the router
- `backend/app/autorefresh.py` — record the universe sweep
- `backend/app/news.py` — record the news refresh
- `backend/tests/test_autorefresh.py`
- `backend/tests/test_news.py`

**Touch nothing else.** Not `app/briefing.py`, `app/schedule.py`, `app/universe.py`, `app/cache.py`,
`app/quotes.py`, `app/strip.py`, `app/market_data.py`, `app/freshness.py`, `app/db.py`,
`app/config.py`, `app/routers/universe.py`, `app/routers/news.py`, `tests/conftest.py`, any existing
migration, or **anything under `frontend/`**.

**No new dependency.**

## Never expose a secret

`/ops/status` is unauthenticated on a public Render URL. It may report **booleans and counts only**:
`gemini_key_configured: true`, never the key, never its length, never a prefix. Never the
`DATABASE_URL`, its password, its username or its host. Never `CORS_ORIGINS`' contents.

Contract 0041's config guard already redacts these in its error messages; hold the same line here.

## Schema — `job_runs`

Migration revision **0008**, down-revision **0007**. Exactly eight afterwards.

| column | type | notes |
|---|---|---|
| `id` | `Integer` PK autoincrement | |
| `job_name` | `String` NOT NULL, indexed | `"universe_refresh"` or `"news_refresh"` |
| `started_at` | `DateTime(timezone=True)` NOT NULL, indexed | |
| `finished_at` | `DateTime(timezone=True)` | null only if the process died mid-run |
| `status` | `String` NOT NULL | `success` \| `partial` \| `failure` |
| `duration_ms` | `Integer` | |
| `detail` | `JSON` | per-job counts; SQLAlchemy's `JSON` maps to JSONB on Postgres and TEXT on SQLite |

## `app/jobrun.py`

```python
JOB_RETENTION_DAYS = 30

@contextmanager
def record_run(job_name: str, now_utc: datetime) -> Iterator[dict]:
    """Record one job run. Yields a mutable detail dict the caller fills in."""
```

- Yields a `dict`; the caller mutates it with whatever counts it has.
- On clean exit: `status = "partial"` when `detail.get("errors")` is truthy, otherwise `"success"`.
- On an exception: record `status = "failure"`, put `type(exc).__name__` and `str(exc)[:500]` into
  `detail["error"]`, **then re-raise**. Swallowing it would turn a crash into a green row.
- `duration_ms` from a `time.monotonic()` pair, not from wall-clock subtraction — a clock adjustment
  mid-run must not produce a negative duration.

**Recording must never break the job it is recording.** Wrap the insert itself in
`try/except Exception: logger.exception(...)`. A `job_runs` write failing is worth a log line, not a
failed refresh — the reference did exactly this and was right to.

Prune rows older than `JOB_RETENTION_DAYS` after a successful insert, the same shape as
`_prune_old_summaries`: by age, never a wipe, and only after something new landed.

## Wiring

### `autorefresh.run_auto_refresh_if_due`

Wrap the work **after** the lock acquisition, the `needs_auto_refresh` gate and the claim write:

```python
with record_run("universe_refresh", now_utc) as detail:
    ...existing sweep...
    detail["tickers"] = len(tickers)
    detail["refreshed"] = <count whose action was not "none">
    detail["errors"] = [<ticker names that raised>]
```

**Only record a run that actually ran.** `GET /universe/strip` fires on every page load, and the
function returns early when the window is already claimed — recording there would write a row per
page view and drown the table. A test must prove a gated call records nothing.

The existing per-ticker `except Exception: continue` stays; collect the failing ticker names into
`detail["errors"]` so the run shows as `partial` rather than `success`.

### `news.run_news_refresh_if_due`

Same shape, `job_name="news_refresh"`:

```python
detail["feeds"] = len(MARKET_NEWS_TICKERS)
detail["stored"] = <articles upserted>
detail["errors"] = [<feeds that raised>]
detail["briefing"] = <True when refresh_briefing produced a new summary, else False>
```

`briefing` is best-effort — if determining it is awkward, record whether `refresh_briefing` was
reached at all and say so in the report. Do not change `app/briefing.py`.

## `app/ops.py`

```python
def system_health() -> dict
def recent_job_runs(limit: int) -> list[dict]
```

`system_health()` — a **bounded** set of queries, never per-ticker:

- `database`: `is_enabled()`, and the current Alembic revision from `alembic_version`
- `universe`: active ticker count, total `price_bars` rows, newest bar date
- `news`: article count, newest `fetched_at`
- `briefing`: whether one exists, its `model`, its `created_at`
- `gemini_key_configured`: bool — **the boolean only**
- `python`: `sys.version.split()[0]`, matching `/health`
- `windows`: `app_state["auto_refresh"]` and `app_state["news_refresh"]`, plus
  `current_window_start(now_et)` so the page can say which window is open

`recent_job_runs(limit)` — newest first, `limit` clamped to `[1, 100]`.

**Neither function may raise when a table is empty or a key is missing.** This page exists to be read
when things are wrong; a 500 from the health endpoint is the least useful possible response. Return
nulls and zeroes.

## Routers

New `app/routers/ops.py`, prefix `/ops`, registered in `main.py`:

```
GET /ops/status           → OpsStatus
GET /ops/job_runs?limit=  → {"job_runs": [...]}
503 on either when no database is configured
```

No new `/{something}` catch-all, so the route-ordering trap does not apply — **do not add one**.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **369**.
2. `ls backend/migrations/versions/` shows exactly **eight**; `0008` has `down_revision = "0007"`.
3. A test asserts a **gated** call — one where `needs_auto_refresh` is False — writes **no**
   `job_runs` row. This is the criterion that stops a row per page view.
4. A test asserts a sweep in which one ticker raises records `status="partial"` with that ticker in
   `detail["errors"]`, and that the other ticker still refreshed.
5. A test asserts a body that raises records `status="failure"` **and re-raises** —
   `pytest.raises` around it, plus an assertion on the stored row.
6. A test asserts a failing `job_runs` insert does **not** propagate: patch the insert to raise and
   assert the surrounding refresh still completes.
7. `GET /ops/status` returns 200 on an empty database — no tickers, no news, no briefing, no runs —
   with nulls and zeroes rather than an error.
8. `grep -rniE "gemini_key|database_url|password" backend/app/ops.py backend/app/routers/ops.py` —
   every match must be the `gemini_key_configured` **boolean**. Quote each one.
9. `GET /ops/job_runs?limit=500` clamps to 100; `?limit=0` clamps to 1.
10. A bounded-query test for `system_health()`, reusing contract 0008's counting approach: the query
    count must not scale with ticker count.
11. `git diff --stat backend/app/briefing.py backend/app/universe.py backend/app/schedule.py backend/app/cache.py backend/app/strip.py backend/app/quotes.py`
    is empty.
12. `git status --porcelain` lists nothing outside this contract's files and nothing under
    `frontend/`. **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "down_revision" backend/migrations/versions/0008_job_runs.py
grep -rniE "gemini_key|database_url|password" backend/app/ops.py backend/app/routers/ops.py
git diff --stat backend/app/briefing.py backend/app/universe.py backend/app/schedule.py ; echo "(empty = untouched)"
git status --porcelain
```

Plus a real round trip — **deliberately not `DATABASE_URL=""`**, and it writes a real row:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" alembic upgrade head
cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from sqlalchemy import delete
from app.db import session
from app.models import AppState
from app.autorefresh import run_auto_refresh_if_due
from app.ops import recent_job_runs, system_health
import json
with session() as db:
    db.execute(delete(AppState).where(AppState.key == 'auto_refresh'))
run_auto_refresh_if_due(datetime.now(timezone.utc), datetime.now(ZoneInfo('America/New_York')))
print(json.dumps(recent_job_runs(3), indent=2, default=str))
print(json.dumps(system_health(), indent=2, default=str))"
```

Expect one `universe_refresh` row with a duration and a `detail`, and a health blob containing **no
secret of any kind**. Paste both.

## Human verification — does Gunnar need to run anything?

**Light — there is no UI yet.**

1. `alembic upgrade head` (adds `job_runs`).
2. Restart uvicorn with `--reload`, load `localhost:5173/` to trigger a window, then:
   ```bash
   curl -s 'http://127.0.0.1:8000/ops/job_runs?limit=5' | python3 -m json.tool
   curl -s http://127.0.0.1:8000/ops/status | python3 -m json.tool
   ```
3. **Reload the page several times and re-check `/ops/job_runs`** — the count must not climb. One row
   per window, not one per visit. That is the thing most likely to be wrong.
4. Read `/ops/status` and confirm it contains no key, no connection string, no host.

## Out of scope

- **No frontend.** Contract 0045 builds the page and wires the gear icon.
- No price-refresh control, no digest endpoint, no auth — none of the reference's other ops surface.
- No scheduler. Runs are recorded when a visit triggers a window, exactly as now.
- No change to the windows, the claim keys, the locks, or `briefing.py`.
- No alerting, email or notification on failure.

## Open questions — do NOT resolve these yourself

- **Whether `/ops` should require a secret** once it is on a public URL. It exposes no secrets, but it
  does expose system internals.
- **Whether a failed run should be retried sooner** than the next window. Today a window that errors
  waits; that is deliberate, and changing it risks the rate-limiting this app already fights.
- **Whether `refresh_briefing` should record its own job run** separately from the news refresh it
  hangs off.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-18)

- `pytest -q` → **405 passed** (from 369)
- Eight migrations; `0008` has `down_revision = "0007"`
- Scope exact; `briefing.py`, `universe.py`, `schedule.py`, `cache.py`, `strip.py`, `quotes.py` all
  untouched

### Criterion 3 verified twice — in tests and live

The one that stops a row per page view. `test_autorefresh.py` asserts `_job_run_count() == 0` in both
gated cases: before 09:30, and with the window already claimed. The planner then checked it over HTTP,
which the implementer had skipped:

```
job_runs before: 1
6 page loads (each hitting /universe/strip)
job_runs after:  1
```

Partial and failure are pinned too: a sweep where one ticker raises records `status="partial"` with
that ticker in `detail["errors"]` **and the other ticker still refreshed**; a raising body records
`status="failure"` with the exception type under `pytest.raises`.

### The no-secrets rule verified against the real values, not by grep

`grep -rniE "gemini_key|database_url|password|cors"` over `ops.py` and `routers/ops.py` returns only
`settings.gemini_key is not None` (twice) and docstring prose. The planner also fetched
`/ops/status` from a live server and scanned the response against the **actual** Gemini key, database
password, username, hostname and CORS origins:

```
leaked: NOTHING
```

### The implementer found a bug its own tests caught

Its first `_prune_old_runs()` did not exclude the row just inserted — unlike `_prune_old_summaries`,
which this contract told it to mirror. A run recorded with an old caller-supplied `started_at` would
have deleted itself in the same breath. Fixed by flushing and threading `keep_id` through, matching
the summaries prune exactly. Worth noting that the *reason* the contract named that function as the
model is precisely this: the keep-the-new-row detail is not obvious and had already been got right
once.

### Disclosed and accepted

`detail["briefing"]` records whether `refresh_briefing()` completed without raising, **not** whether a
new summary was produced — `refresh_briefing` returns `None` either way and may legitimately no-op
when `needs_summary` says a regeneration is not due. The contract permitted this and asked for it to
be said; it was.

Two tickers (`SETM`, `CEG`) emit yfinance's own "Data doesn't exist" stderr noise during a sweep
without raising a Python exception, so they do not appear in `detail["errors"]`. Pre-existing,
unrelated to this contract, and correct as recorded — that list only holds tickers whose `refresh()`
actually raised. Worth knowing when reading a `success` run that printed warnings.

### Module map updated

`REBUILD.md`'s map gained `jobrun.py` (tier 2), `ops.py` (tier 5) and the eighth table, and was
re-verified: every module in the map exists on disk, every module on disk appears in the map.
