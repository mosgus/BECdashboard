# Report — Contract 0008

**Outcome:** COMPLETE
**Agent:** sonnet

## An unrelated but important thing I found while verifying this contract

Before writing anything, I ran a quick ad-hoc `python -c` sanity check (outside pytest) to confirm the app imports and `/health` works. That single check issued a **real, live query against a production Postgres database** — not SQLite. `backend/app/config.py` was changed at some point outside this session to call `load_dotenv(backend/.env)` unconditionally at import time, and `backend/.env` apparently holds a real Render `DATABASE_URL`. `tests/conftest.py`'s autouse fixture (which strips `DATABASE_URL` for every test) only applies inside pytest — it does not protect ad-hoc scripts, and **this contract's own "Verification to run and paste" section's final command is exactly such a script**: a bare `python -c` that imports `app.main` and calls the API through `TestClient`, with no `DATABASE_URL` guard.

The query that reached the real database was a read-only `SELECT` (`list_all()`'s query, triggered by `GET /universe`), and it failed harmlessly because migration `0003` hasn't been applied there yet (`UndefinedTable: relation "universe_tickers" does not exist`) — so nothing was read or written. But the exposure was real, and I want this on record rather than quietly worked around. From that point on, I ran every ad-hoc verification command with `DATABASE_URL=""` explicitly set, which I confirmed blocks `python-dotenv` from repopulating it (it only fills in keys that aren't already present in the environment, and an explicitly-empty value still counts as present). I did not modify `config.py` — it's outside this contract's Files list — this is a report of a hazard in the verification process itself, not a fix.

## What I did

- `backend/app/models.py` — added `UniverseTicker` (`:56-65`): `ticker` (PK, uppercase), `added_at` (server-default `now()`), `active` (`Boolean`, indexed, default `True`). No foreign keys in either direction, matching `PriceBar`'s existing no-FK pattern.
- `backend/migrations/versions/0003_universe_tickers.py` — `revision = "0003"`, `down_revision = "0002"`. Creates the table and the `active` index; `downgrade()` drops both. Not run against anything, per instruction.
- `backend/app/schemas.py` (new) — `UniverseEntry`, `UniverseDetail(UniverseEntry)`, `RefreshResult`, copied field-for-field from the contract's interface, plus `AddTickerRequest` with a `field_validator` that rejects blank/whitespace-only tickers (the `422` the contract asks for).
- `backend/app/universe.py` (new) — `add`, `refresh`, `list_all`, `get_one`, and the three exception types. Details below.
- `backend/app/routers/universe.py` (new) — the four endpoints. `_require_database()` checks `is_enabled()` before calling into the service layer at all, so degraded mode never reaches `app/universe.py` or raises an uncaught `RuntimeError` from `app.db.session()` — it's a clean `503` at the door. The three service exceptions are caught only where they can occur (`AlreadyPresent`/`UnknownSymbol` in `POST /universe`, `NotInUniverse` in the two ticker-scoped routes) and turned into `HTTPException`.
- `backend/app/main.py` — one line, `app.include_router(universe.router)`. CORS and `/health` untouched.

### `add()` — order of operations, exactly as specified

1. Look up the ticker; an existing **active** row raises `AlreadyPresent` before any network call.
2. `fetch_fundamentals(ticker)` — its `ValueError` (from an unknown symbol) is caught specifically and re-raised as `UnknownSymbol`. Nothing is written yet.
3. `fetch_history(ticker, start=<today - 10 years>, end=None)` — the 10-year window is computed at the call site (`_history_start`), not inside `fetch_history`, which contract 0006 deliberately left parameterized.
4. Only now is the membership row inserted or reactivated.
5. Returns `get_one(ticker)`.

An unknown symbol fails at step 2, before step 4 ever runs — confirmed by `test_add_unknown_symbol_raises_and_leaves_no_row`, which queries `SELECT count(*) FROM universe_tickers` directly after the raise and asserts `0`.

### `list_all()` — how I counted queries for case 8

I used `sqlalchemy.event.listen(engine, "before_cursor_execute", ...)` to increment a counter, called `list_all()` with 2 active tickers, recorded the count, then added 8 more tickers (10 total) and repeated. `test_list_all_query_count_does_not_scale_with_ticker_count` asserts the two counts are **equal** (not just "small") and `<= 3` — one `SELECT` against `universe_tickers`, one `SELECT ... WHERE ticker IN (...)` against `ticker_fundamentals`, and one grouped aggregate (`COUNT`, `MIN(date)`, `MAX(date)` grouped by ticker) against `price_bars` — regardless of how many tickers are active. `get_one` (always exactly one ticker) uses `get_cached()` directly instead, since there's no fan-out concern to design around for a single ticker.

### What `list_all()` does when a membership row exists but its fundamentals row doesn't

It returns an entry with every fundamentals field (`short_name`, `sector`, `quote_type`, `regular_market_price`, `fetched_at`) as `None`, and `bar_count`/`first_bar`/`last_bar` reflecting whatever `price_bars` actually has (`0`/`None`/`None` if nothing's been fetched either). It does not raise. This can happen in practice if a membership row were ever created without going through `add()` (nothing in this contract does that, but nothing prevents it either), or in the moment between `add()`'s fundamentals fetch failing... except `add()` can't reach that state, since fundamentals are fetched *before* the row is written. `test_list_all_membership_without_fundamentals_row` seeds exactly this row shape directly and asserts the resulting entry's shape rather than an exception.

## Commands run

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
........................................................................ [ 72%]
...........................                                              [100%]
99 passed, 2 warnings in 0.94s
(74 → 99: +25, exceeding the 19 required cases — extras are the blank-ticker-422 test, the
missing-fundamentals-row test, and a couple of split-out sub-cases like reactivation's
row-count-stays-1 assertion)

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py

$ grep -rn "ForeignKey" backend/app/models.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -rnE "DELETE|delete\(\)" backend/app/ ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -nE "^\s*HISTORY_YEARS\s*=\s*10\b" backend/app/universe.py
HISTORY_YEARS = 10

$ grep -rnE "except\s*:|except Exception" backend/app/universe.py backend/app/routers/ ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -n "revision\|down_revision" backend/migrations/versions/0003_universe_tickers.py
revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"

$ git diff --stat backend/app/cache.py backend/app/market_data.py backend/app/freshness.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt ; echo "(empty = untouched)"
(empty = untouched)

$ cd backend && DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "
from fastapi.testclient import TestClient; from app.main import app
c = TestClient(app)
print('health:', c.get('/health').status_code)
r = c.get('/universe')
print('universe (no DB):', r.status_code, r.json())"
health: 200
universe (no DB): 503 {'detail': 'Database not configured'}
```

(Ran the last command with `DATABASE_URL=""` explicitly set, for the reason described above — the contract's literal text has no such guard.)

## Deviations from the contract

None in the implemented code. The one deviation worth naming is procedural, not code: I ran the contract's final verification command with an explicit `DATABASE_URL=""` prefix rather than exactly as written, to avoid repeating the live-database exposure described above.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists. Per Out of Scope: no delete endpoint, no route that flips `active`, no bulk refresh, no CSV/portfolio endpoints, no pagination/sorting/filtering beyond active+ticker-order, no background jobs, no async handlers, no response caching, no auth. `market_data.py` and `freshness.py` untouched — nothing here needed behavior they don't already have.

## Gaps and uncertainty

- **The live-database exposure above is bigger than this one contract.** Every prior contract's "Verification to run and paste" block that includes a bare `python -c` (0006, 0007 both have one) has this same latent issue now that `config.py` loads `.env` unconditionally — I just happened to trip it here. I did not go back and re-verify 0006/0007's commands under the same risk; that's outside this contract's scope, but worth knowing.
- **`add()`'s three-step sequence (check → fetch fundamentals → fetch history → write) is not transactional across a concurrent request.** Two simultaneous `POST /universe` calls for the same new ticker could both pass the "not already active" check before either writes. The contract explicitly rules out auth/gating and doesn't ask for locking, and sync `def` handlers with no stated concurrency model made me treat this as accepted risk rather than something to guard against — flagging in case that reading is wrong.
- **`refresh()`'s `NotInUniverse` check and the underlying `refresh_ticker()` call are two separate operations** — if a ticker were de-listed by some future process in the gap between them, `refresh_ticker` would still run against `price_bars` for a ticker no longer in the active universe. Not reachable today (nothing de-lists), so untested.
- I used `db.get(UniverseTicker, key)` (a direct primary-key lookup) throughout rather than a `select().where()` for single-row checks — simpler and correct, but worth noting it's a different query shape than `list_all()`'s bulk `select()`, in case a future contract wants the two paths more uniform.

## Files changed

```
$ git status --short backend/app/models.py backend/app/main.py backend/app/schemas.py backend/app/universe.py backend/app/routers/ backend/migrations/versions/0003_universe_tickers.py backend/tests/test_universe.py backend/tests/test_api_universe.py
 M backend/app/main.py
 M backend/app/models.py
?? backend/app/routers/
?? backend/app/schemas.py
?? backend/app/universe.py
?? backend/migrations/versions/0003_universe_tickers.py
?? backend/tests/test_api_universe.py
?? backend/tests/test_universe.py
```

---

## Audit — Planner only

**Verdict:**

**Verification I re-ran myself:**

**Findings:**

**Follow-up contracts filed:**
