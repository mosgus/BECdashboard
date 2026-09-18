# Contract 0041 — Resilience: transient-failure retry, config conflict guard, refresh lock

**Status:** accepted (2026-09-17) — audited by planner. Human verification of Part 1 outstanding.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Three independent hardening fixes, all found by the 2026-09-17 audit:

1. The launch page recovers from a transient backend failure instead of latching broken.
2. A shell environment variable that silently overrides `backend/.env` fails loudly at import.
3. Two concurrent visitors cannot run the same refresh twice.

No migration, no new dependency, no visual change.

## Why

The audit found no errors — 342 tests green, no unused imports, no bare `except`, no `any` in the
frontend, clean data integrity. These are the three behaviours that degrade badly under conditions
tests do not reproduce.

### 1. The launch page latches on any transient failure

`BackendStatus`, `TickerStrip` and `NewsSection` each fetch once in `useEffect(…, [])` with no retry
and no recovery affordance. The Universe page has a Retry button; these have nothing. One failed
request at mount leaves "API offline", no ticker strip and no news — **permanently, until a manual
reload**, even once the backend is healthy again.

This is not hypothetical. Gunnar hit it locally when uvicorn restarted, and a Render **deploy**
returns 502/503 for several seconds while the new instance boots. Anyone loading the site during a
deploy sees a broken page and no reason why.

### 2. An exported variable silently beats `.env` — twice, ~2 evenings

- A stale `DATABASE_URL` presented as `password authentication failed for user "<a user not in
  .env>"` — read as a rotated-password problem for an hour.
- A stale `CORS_ORIGINS` presented as "API offline" while the server logged `200 OK` for every
  request — the browser was discarding responses for a missing header.

`load_dotenv` does not override an already-set variable, and neither symptom names the cause.

There is also a **latent second bug**: `os.getenv("CORS_ORIGINS", "http://localhost:5173")` returns
`""` for an exported-but-empty variable — not `None` — so the default never applies and
`cors_origins` becomes `[""]`, a list matching no origin at all, with no error anywhere.

### 3. Claim-first is a narrow window, not a lock

`run_auto_refresh_if_due` and `run_news_refresh_if_due` both read state, then write a claim, then
work. Two visitors landing in the same millisecond can both pass the check. It was acceptable when
the cost was a duplicated fetch; **contract 0034 put a paid Gemini call at the end of the news path**,
so a duplicate now costs an API call as well as ~20 wasted requests.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

Frontend typecheck is `npx tsc -p tsconfig.app.json --noEmit`. **Not bare `tsc --noEmit`.**
The frontend linter is `npm run lint` (oxlint). It currently reports **exactly one** warning,
`UniversePage.tsx:53 set-state-in-effect`. **Do not fix that one** — state already initialises to
`loading`, so it is a false positive, and it is the baseline this contract must not exceed.

**Tests must pass with no network, no database and no `GEMINI_KEY`.**

## Files

Modify:
- `frontend/src/api/client.ts`
- `backend/app/config.py`
- `backend/app/autorefresh.py`
- `backend/app/news.py`
- `backend/tests/test_config.py` *(create if absent)*
- `backend/tests/test_autorefresh.py`
- `backend/tests/test_news.py`

**Touch nothing else.** Not `app/db.py`, `app/universe.py`, `app/cache.py`, `app/quotes.py`,
`app/strip.py`, `app/briefing.py`, `app/schedule.py`, `app/models.py`, `app/schemas.py`, `app/main.py`,
any router, any migration, `tests/conftest.py`, or **any frontend file other than `client.ts`**.

In particular **do not edit `BackendStatus.tsx`, `TickerStrip.tsx` or `NewsSection.tsx`** — fixing
`request` fixes all three at once, and touching them risks the carousel and hover-expander work.

**No migration. No new dependency. No schema change.**

## Part 1 — retry transient failures in `client.ts`

Inside `request`, retry **only** when all of these hold:

- the method is **`GET`**. Never retry `POST` or `DELETE` — `POST /universe` is not idempotent and a
  retried add would double-fetch ten years of history.
- the failure is transient: either `fetch` itself rejected (a `TypeError`, i.e. the connection was
  refused or dropped), or the response status is **502, 503 or 504**.

**Do not retry 4xx, and do not retry 500.** A 404 for an unknown ticker must fail immediately, and a
500 means the request reached the app and the app raised — retrying cannot help and doubles the load.

Two retries, delays **1000ms then 3000ms**. Worst case adds ~4s before a genuine failure surfaces,
which is acceptable against a ~43s Render cold start, and covers a uvicorn restart or a short deploy
blip. Sleep with `new Promise(r => setTimeout(r, ms))` — no dependency.

The thrown error on final failure must be **unchanged** in type and message: `ApiError` with the same
status and detail. Callers already discriminate on `ApiError.status === 503`, and `UniversePage`
renders `err.message`.

**This is the whole of Part 1.** Every caller — health, strip, news, universe, history — inherits it.

## Part 2 — `config.py`

### 2a. Empty means unset, for `CORS_ORIGINS` only

```python
cors_origins_str = os.getenv("CORS_ORIGINS") or "http://localhost:5173"
```

**Do not generalise this to `DATABASE_URL`.** `Settings.database_url` already does
`os.getenv("DATABASE_URL") or None`, and `DATABASE_URL=""` meaning *"no database"* is the safety
convention every ad-hoc command in this project relies on to stay off production. Changing it would
invert that guard into a live production connection. Leave that line exactly as it is.

### 2b. Raise on a conflicting ambient variable

Before `load_dotenv` takes effect, compare the process environment against the `.env` file for a
named set of keys and raise when they disagree:

```python
_GUARDED = ("DATABASE_URL", "CORS_ORIGINS", "GEMINI_KEY", "GEMINI_MODEL")
```

Raise **only** when, for the same key: the ambient value is **non-empty**, the `.env` value is
**non-empty**, and they differ.

- An **empty** ambient value is a deliberate opt-out (`DATABASE_URL=""`), never a conflict.
- A key absent from `.env` is not a conflict — that is how Render runs, with no `.env` file at all.
  Use `dotenv_values(path)` to read the file without mutating the environment; it returns `{}` when
  the file is missing, so **Render must be unaffected**. Say in the report how you confirmed that.

The exception message must name the variable and make the mismatch obvious, but **must never print a
secret**. For `DATABASE_URL` show only the parsed username and host; for `GEMINI_KEY` show only the
length. Something like:

```
Environment variable DATABASE_URL is set in your shell and differs from backend/.env.
  shell : user=blueeagledb_hgvb_user host=dpg-....render.com
  .env  : user=bec_db             host=dpg-....render.com
load_dotenv will not override an exported variable — `unset DATABASE_URL` or fix .env.
```

A `RuntimeError` at import is correct here. Failing at startup with the cause named is strictly
better than the two symptoms this actually produced.

## Part 3 — non-blocking refresh locks

A module-level `threading.Lock` in each of `app/autorefresh.py` and `app/news.py`, separate locks —
a running universe sweep must not block a news refresh.

```python
_LOCK = threading.Lock()

def run_..._if_due(now_utc, now_et) -> None:
    if not _LOCK.acquire(blocking=False):
        return          # another visitor's sweep is already running
    try:
        ...existing body, unchanged...
    finally:
        _LOCK.release()
```

`threading.Lock`, not `asyncio.Lock` — these run as sync functions in FastAPI's threadpool.

**Non-blocking.** A second visitor returns immediately; it must never wait for a 20-ticker sweep to
finish inside a background task.

**Keep claim-first exactly as it is.** The lock covers one process; the `app_state` claim is what
survives a restart and what would cover multiple workers. They are complementary — do not remove the
claim write, and do not move it.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network, no
   database and no `GEMINI_KEY`. Count increases from **342**.
2. `cd frontend && npx tsc -p tsconfig.app.json --noEmit` exits 0; `npm run build` succeeds.
3. `npm run lint` reports **exactly one** warning, still `UniversePage.tsx:53`. More is a regression.
4. `client.ts` tests are not required (there is no frontend test runner), but the report must quote
   the retry block and state plainly which statuses and which methods retry.
5. `grep -n "502\|503\|504" frontend/src/api/client.ts` matches, and
   `grep -n "'POST'" frontend/src/api/client.ts` shows POST is **not** in the retry path — quote the
   guard.
6. `config.py` tests, using `monkeypatch.setenv`/`delenv` and a temporary `.env`:
   - ambient and `.env` both set and **different** → raises, and the message contains the variable
     name
   - ambient set, `.env` **absent** → no raise (the Render case)
   - ambient **empty**, `.env` set → **no raise** (the `DATABASE_URL=""` opt-out)
   - ambient and `.env` identical → no raise
   - `CORS_ORIGINS=""` → `cors_origins == ["http://localhost:5173"]`, **not** `[""]`
7. A test asserts the raised message for `DATABASE_URL` **does not contain the password** — build a
   URL with a recognisable password and assert that substring is absent.
8. A test per lock: while the lock is held, a second call to `run_auto_refresh_if_due` /
   `run_news_refresh_if_due` returns without fetching. Assert on a spy, not on source.
9. A test asserts the lock is **released** after the body raises — acquire it again afterwards.
10. `grep -n "acquire(blocking=False)" backend/app/autorefresh.py backend/app/news.py` matches in
    both.
11. `grep -rn "DATABASE_URL" backend/app/config.py` — the `or None` on `database_url` is unchanged.
    Quote the line.
12. `git diff --stat backend/app/db.py backend/app/universe.py backend/app/cache.py backend/app/briefing.py backend/app/schedule.py backend/app/models.py frontend/src/components/ frontend/src/pages/`
    is empty.
13. `ls backend/migrations/versions/` still shows exactly **seven**.
14. `git status --porcelain` lists nothing outside this contract's Files list.
    **Do not use `git diff --name-only`** — untracked files are invisible to it.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "acquire(blocking=False)" backend/app/autorefresh.py backend/app/news.py
grep -rn "DATABASE_URL" backend/app/config.py
grep -n "502\|503\|504" frontend/src/api/client.ts
ls -1 backend/migrations/versions/
cd frontend && npx tsc -p tsconfig.app.json --noEmit && echo "typecheck clean"
cd frontend && npm run build
cd frontend && npm run lint
git status --porcelain
```

Plus the guard firing for real — **deliberately exporting a conflicting value**:

```bash
cd backend && CORS_ORIGINS="https://example.com" PATH="$PWD/.venv/bin:$PATH" python -c "
from app.config import Settings; print('NO RAISE — wrong')" 2>&1 | tail -4
```

Expect a `RuntimeError` naming `CORS_ORIGINS`. Then confirm the opt-out still works:

```bash
cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
from app.config import Settings; print('database_url:', Settings().database_url)"
```

Expect `database_url: None` and **no raise**.

## Human verification — does Gunnar need to run anything?

**Yes — Part 1 cannot be judged from source.**

1. Start the frontend. Load `localhost:5173/`.
2. **Stop the backend.** Reload. The page renders (hero, cards); after ~4s the dot reads
   `API offline`, and the strip and news are absent. That delay is the retries.
3. **Start the backend, then reload.** Everything returns.
4. **The real test:** with the page open, restart uvicorn, and reload *while it is booting*. Before
   this contract that left a permanently broken page; now it should recover on its own.
5. `unset CORS_ORIGINS` and `unset DATABASE_URL` in the shell you run uvicorn from, then start it.
   It must start normally — if the guard raises on a clean shell, it is too strict.

## Out of scope

- **Do not delete `POST /universe/{ticker}/refresh` or `POST /universe/quotes/refresh`.** Nothing in
  the UI calls them, but they are the only remaining way to force a bar or quote refresh. Tidiness is
  not worth removing the capability.
- **Do not drop the `active` column.** Nothing sets it to `False` since delete became a hard delete,
  but `add()` still reads it when re-adding, and removing it needs a migration.
- No polling, websockets or server-sent events. Retry only.
- No change to the refresh windows, the claim keys, retention, the briefing, or any UI.
- No fix for `UniversePage.tsx:53` — see Environment.

## Open questions — do NOT resolve these yourself

- **`_cached_last_session` is a single point of failure.** If that one reference-ticker fetch is
  throttled, `refresh_ticker` returns `unknown_session` for **every** ticker and the whole sweep
  no-ops, at any universe size. A retry or a fallback reference ticker would fix it; both need design.
- **Whether the retry belongs in `request` or per-caller.** This contract puts it in `request` so all
  callers benefit; a caller that should fail fast would need an opt-out.
- **Whether `BackendStatus` should poll** rather than check once. Retry covers a blip at mount; it
  does not recover a page left open across an outage.
- **What happens to the four `Coming soon` cards.** Still open.

---

## Audit (planner, 2026-09-17)

- `pytest -q` → **354 passed** (from 342)
- **`import app.main` succeeds in a normal shell** — the blast radius of an import-time raise was the
  main risk in Part 2 and it is clear
- Guard with a nonexistent `.env` and ambient vars set → no raise. That is how Render runs, verified
  directly rather than reasoned about.
- `config.py:75` — `os.getenv("DATABASE_URL") or None` unchanged, so `DATABASE_URL=""` still means
  "no database" and every ad-hoc command in this project stays off production
- `acquire(blocking=False)` in both `autorefresh.py:89` and `news.py:329`, separate locks
- `npm run lint` still exactly **1** warning (the `UniversePage.tsx:53` false positive baseline)
- Scope is exactly the contract's file list; forbidden files empty; seven migrations

### The retry loop is correct in the two places it could have been subtly wrong

```ts
const retryDelaysMs = method === 'GET' ? [1000, 3000] : []
```

A non-GET gets an empty array, so `isLastAttempt` is true on attempt 0 and nothing can retry — the
idempotency guarantee comes from the data, not from a conditional that could drift. And on the final
attempt a transient status falls through to the ordinary `!response.ok` branch, so the thrown
`ApiError` keeps its status and message exactly as before. `response.text()` is read once, after the
retry decision — reading it earlier would consume the body and break the retry.

### Deviation, correct

The contract's sample verification command exported a conflicting `CORS_ORIGINS`, but Gunnar's local
`.env` does not define that key — and a key absent from `.env` is deliberately never a conflict, so
the sample could not fire. The implementer substituted `DATABASE_URL` to exercise the same path and
said so. The contract's sample was wrong for this machine; the behaviour is right.

### Disclosed and assessed

The implementer flagged that the guard's error message printed the real database username and
hostname into the transcript. Correct to raise. No password was shown, the same host had already
appeared in this session from two earlier connection-string incidents, and the message only ever
renders in the developer's own terminal. Reducing it further would defeat the diagnosis it exists to
provide.
