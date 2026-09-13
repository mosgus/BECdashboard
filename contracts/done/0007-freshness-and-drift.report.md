# Report — Contract 0007

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `backend/app/freshness.py` (new) — five pure functions, none of them touching the network, database, or wall clock:
  - `last_completed_session` (`:20-42`) — computes a single `cutoff` date (`today` if `now_et_hour >= 16`, else `today - 1`), then returns the max bar date `<= cutoff`. This one `cutoff` value does triple duty: it drops today's bar before 4pm ET, and it also drops any bar dated *after* the cutoff regardless of hour — which is what makes the holiday-gap case correct (a stray later-dated bar in the frame doesn't get picked over an earlier one just because it exists).
  - `is_stale` (`:45-51`) — `None`/empty → `True`; otherwise newest stored date `< last_session`.
  - `pick_drift_anchors` (`:54-74`) — first/middle/last of the stored index by position, deduplicated in order.
  - `detect_drift` (`:77-104`) — compares `adj_close` only, at whichever anchors are present in both frames; both-`NaN` at an anchor is treated as agreement, one-`NaN`-one-not as drift, otherwise `np.isclose(atol=1e-6, rtol=0.0)`.
  - `missing_range` (`:107-119`) — `(newest_stored_date, last_session)` when stale, `None` when current or when stored is empty/`None`.
- `backend/app/market_data.py` — added `refresh_ticker()` (`:99-165`ish) and a private `_now_et()` helper (`:99-102`), the one place in this module that reads the system clock. Order of operations exactly as specified: reference-ticker fetch → session derivation → idempotence check (no further network if fresh and not forced) → `missing_range` fetch → drift check against whatever anchors overlap that fetch → append-and-store, or on drift, one more fetch of the full stored span and store that instead.

## The anchor/drift mechanism — worth being explicit about, since the contract's wording is easy to misread

I initially read step 5 ("check `detect_drift(stored, fresh, anchors)` against the overlapping region") as meaning a *targeted* re-fetch of the anchor dates specifically — the reference `YF.py:149-201` does exactly that, fetching a dedicated `start`/`end` window around one check date. I went and re-read that file directly before committing to an approach.

What I implemented instead follows the contract's literal order of operations: there is exactly **one** fetch for the routine path (`missing_range`'s narrow window), and `detect_drift` is checked against whatever anchors happen to fall inside it — "against the overlapping region" means exactly that, not that a second fetch is made to cover all three anchors. This works because of *why* three anchors are needed at all: a split/dividend restates every date **before** its ex-date, so the most-recent stored bar (which `missing_range` always re-fetches, per the partial-bar guard) is exactly the anchor that would show drift if a split happened since the last update — the "last" anchor is reachable by the routine fetch precisely because it's the same date the partial-bar guard already re-fetches. The "first" and "middle" anchors only get checked when the fetch window happens to be wide enough to reach them (a long-stale ticker, or a short stored history) — that's a real, accepted gap, not an oversight; see Gaps below.

## How I built the split fixture for case 9

`tests/test_freshness.py::test_detect_drift_true_when_anchor_differs_beyond_tolerance_simulated_split` builds `stored` via the test file's own `_bars()` helper, then creates `fresh` as `stored.copy()` with `fresh["adj_close"] = fresh["adj_close"] / 4` — a second, independent frame, not a call to `pick_drift_anchors`/`detect_drift`/any implementation helper. This satisfies the contract's explicit caution that the fixture must be built by restating a separate frame rather than reusing implementation machinery to construct its own test data.

## What `refresh_ticker` does when the reference-ticker fetch fails

Two distinct failure shapes, handled differently because they *are* different:

- **`_download_history("SPY", ...)` raises** (network error, connection failure): the exception propagates uncaught. Nothing in this contract adds retry/backoff, and `is_valid_symbol`'s own design principle (validity is a key check, never a `try/except`) argues against swallowing errors here too — a caller that wants resilience should catch it, not have `refresh_ticker` silently do nothing.
- **`_download_history` returns successfully but with no usable data** (empty frame, e.g. a bad date range or an outage that yfinance itself absorbs into an empty response): `normalize_history` turns this into the canonical empty-columns shape, `last_completed_session` sees an empty `reference_bars` and returns `None` per its own spec, and `refresh_ticker` returns `{"action": "unknown_session", ...}` with no further network calls and no writes. This is the graceful path — no crash, no incorrect "stale"/"fresh" guess.

## Commands run

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
........................................................................ [ 98%]
.                                                                        [100%]
73 passed in 0.57s
(51 → 73: +22 in test_freshness.py, exceeding the 18 required cases by 4 — the extra four are refresh_ticker's four scenarios split slightly more granularly than the minimum, plus assertions on the exact fetch ranges used)

$ grep -rnE "datetime\.now|date\.today|utcnow" backend/app/freshness.py ; echo "exit=$? (1 means clean)"
backend/app/freshness.py:2:no database, no datetime.now() — so `today` and `now_et_hour` are arguments, not computed
exit=0

$ grep -rn "pandas_market_calendars\|mcal" backend/app/ ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ grep -rnE "DELETE|delete\(\)" backend/app/ ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ git diff --stat backend/app/cache.py backend/tests/conftest.py backend/tests/test_cache.py ; echo "(empty = untouched)"
(empty = untouched)

$ git diff --stat backend/requirements.txt ; echo "(empty = no new deps)"
(empty = no new deps)

$ grep -rnE "yf\.(download|Ticker)\(" backend/tests/test_freshness.py ; echo "exit=$? (1 means clean)"
exit=1 (1 means clean)

$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -c "from fastapi.testclient import TestClient; from app.main import app; assert TestClient(app).get('/health').status_code == 200; print('health 200, degraded mode intact')"
health 200, degraded mode intact
```

## Deviations from the contract

**Criterion 3's grep fails literally, on a comment, not a violation.** `freshness.py:2` — the module's top-level docstring — contains the literal substring `datetime.now()`, inside the sentence explaining *why* this file doesn't call it ("no database, no datetime.now() — so `today` and `now_et_hour` are arguments, not computed"). There is no actual call anywhere in the file; every one of the five functions receives time as a parameter, and the one place this module's logic needs the real clock (`market_data._now_et()`) deliberately lives outside it. I did not reword the docstring to dodge the grep, for the same reason as contract 0006's `currentPrice`/`yfinance` comments: the sentence is accurate documentation of an architectural constraint, and obscuring it to pass a naive string match would make the code worse, not better.

No other deviations. `cache.py`, `conftest.py`, `test_cache.py`, `db.py`, `models.py`, `config.py`, `main.py`, migrations, and `frontend/` are all untouched — confirmed via `git status`, not just by memory of what I edited.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists. Per Out of Scope: no universe table, no prepending, no fundamentals refresh, no scheduling, no `pandas_market_calendars`, no `DELETE`, `cache.py` untouched, and no repair of a raw-`close`-only mismatch (case 10 explicitly proves this — `close` differing alone does not trigger `refetched`).

## Gaps and uncertainty

- **The "first" and "middle" drift anchors are only checked when the routine `missing_range` fetch happens to be wide enough to cover them.** For a ticker updated daily, that fetch is typically 1-2 days wide, so in practice only the "most recent" anchor gets checked on a normal update — which, per the reasoning above, is sufficient to catch a split that happened since the last update, but would **not** by itself catch an old, already-existing restatement in stored history that predates any tracked update (e.g., data seeded incorrectly from the start, or a ticker that went stale for a very long time and its `missing_range` window still doesn't reach back far enough on the first stale check after some data gap). I believe this matches the contract's literal order-of-operations section, but I want to flag it explicitly rather than let "three anchors" imply stronger coverage than the routine path actually provides.
- **`refresh_ticker`'s `force=True`-but-already-fresh path re-fetches only the single most recent stored bar**, not the full three-anchor span, for the same "one fetch, check the overlap" reasoning above. If the intent of `force=True` was closer to "do a full drift audit right now," this under-delivers; I read it as "bypass the staleness short-circuit," which is what test 18 as written checks for (a fetch happens at all), not a specific range.
- **I did not test what happens if `_download_history` for the actual ticker (not the reference ticker) returns an empty frame** during the stale/append path — `normalize_history` of an empty frame yields a canonical-empty six-column frame, `pd.concat([stored, empty_fresh])` would just leave `stored` unchanged (deduplication keeps the last occurrence per date, and an empty frame contributes no dates), so `bars_after` would equal `bars_before` and the action would still report `"appended"` even though nothing was actually added. This isn't wrong, exactly, but the action label might read misleadingly in that edge case — untested and unresolved here.
- **SQLite's timezone-dropping behavior (noted in the 0006 report) doesn't surface here** since `refresh_ticker`'s tests run entirely through the TTL cache (`conftest.py` strips `DATABASE_URL` from every test, so `is_enabled()` is `False` throughout) — no database round trip happens in any of these 22 tests. That's consistent with "no network, no database" for this contract, but it does mean the interaction between `refresh_ticker`'s upsert-via-`store()` and a real Postgres-backed cache is still unexercised, same gap contract 0006 already flagged.

## Files changed

```
$ git status --short backend/app/freshness.py backend/app/market_data.py backend/tests/test_freshness.py
?? backend/app/freshness.py
 M backend/app/market_data.py
?? backend/tests/test_freshness.py
```

---

## Fix applied (round 2) — cache the derived last_session across tickers

`refresh_ticker` was calling `_download_history(REFERENCE_TICKER, ...)` on every invocation, including when the target ticker was already fresh — refreshing N tickers cost N full SPY downloads. `REBUILD.md` explicitly says this value "changes once a day" and should be cached; the contract omitted it and I built exactly what was specified, without noticing the gap myself.

`app/market_data.py`:
- Added a module-level `_last_session_cache: TTLCache = TTLCache(maxsize=8, ttl=3600)` (`cachetools` was already a dependency via `app/cache.py` — no new requirement added, confirmed by `git diff --stat backend/requirements.txt` staying empty).
- Added `_cached_last_session(today, now_et_hour)`, keyed on `(today, now_et_hour >= 16)` rather than a plain rolling TTL — the boolean means the cache invalidates itself the instant 16:00 ET passes, rather than serving a pre-4pm answer for up to an hour into the evening session. On a cache miss it does exactly what `refresh_ticker` used to do inline (fetch SPY, normalize, call `last_completed_session`); on a hit, zero network.
- `refresh_ticker` now calls `_cached_last_session(...)` instead of fetching and deriving inline. No change to the anchor logic, `detect_drift`, `missing_range`, or anything in `freshness.py` — that reasoning was correct and untouched, per your instruction.

Added `test_refresh_ticker_caches_reference_session_across_tickers` (`tests/test_freshness.py`): stores fresh data for two different tickers (AAPL, MSFT) at the same simulated moment, calls `refresh_ticker` on each, and asserts a plain integer call counter on the SPY branch of the monkeypatched downloader equals `1` — not a timing-based assertion. Both tickers' own `action == "none"` is asserted too, so the test also confirms the cache doesn't accidentally short-circuit the per-ticker staleness check itself.

**One test-isolation issue this surfaced:** `_last_session_cache` is module-level state that persists across test functions within the same pytest process. Several of the existing `refresh_ticker` tests reuse the same `(date, hour)` combination (e.g., both the "fresh data" test and the new caching test use 2026-09-09 at 17:00 ET), so without a reset, a later test could silently get a cached answer from an earlier test instead of exercising its own fake downloader — the assertions would still happen to pass (the cached value and the freshly-computed one are identical in every case I have), but it would mean some tests weren't actually testing what they claim to. Added `_last_session_cache.clear()` to the existing `reset_ttl_cache` autouse fixture (alongside the pre-existing `clear()` for the TTL price cache) so every test starts with a cold session cache.

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
........................................................................ [ 97%]
..                                                                       [100%]
74 passed in 0.67s

$ git diff --stat backend/requirements.txt ; echo "(empty = no new deps)"
(empty = no new deps)

$ git diff --stat backend/app/cache.py backend/tests/conftest.py backend/tests/test_cache.py ; echo "(empty = untouched)"
(empty = untouched)
```

---

## Audit — Planner only

**Verdict:**

**Verification I re-ran myself:**

**Findings:**

**Follow-up contracts filed:**
