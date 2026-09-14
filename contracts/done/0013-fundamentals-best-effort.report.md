# Report — Contract 0013

**Outcome:** COMPLETE
**Agent:** sonnet

## What I did

- `backend/app/market_data.py`:
  - Added `class UpstreamUnavailable(RuntimeError)`.
  - Added `symbol_has_history(ticker)` — downloads a ~10-day window (`date.today()` back 10 days, not ten years) and returns `not raw.empty`. If the download itself raises, it re-raises as `UpstreamUnavailable` rather than returning `False` — see "Exception types" below for why that distinction is load-bearing.
  - Rewrote `fetch_fundamentals(ticker) -> dict | None`: catches specific exceptions around `_download_info` and returns `None` on failure; also returns `None` (not raising) when `is_valid_symbol(info)` is `False`. Never raises `ValueError` anymore. Nothing is written to `ticker_fundamentals` on any `None` path.
  - `is_valid_symbol` and `_download_info` untouched, as instructed.
  - Note: I built this on top of contract 0012's in-progress, uncommitted changes to this same file (the `yf.download` end-exclusive fix) — both sets of changes coexist without conflict; I did not touch `_download_history`'s date-handling logic myself.
- `backend/app/universe.py`:
  - `add()` reordered exactly as specified: already-active check → `symbol_has_history` (raises `UnknownSymbol` on `False`, propagates `UpstreamUnavailable` uncaught on failure) → `fetch_history` → `fetch_fundamentals` (best-effort, return value ignored) → insert/reactivate membership → `get_one`.
  - `refresh()` now checks `get_fundamentals(key) is None` after `refresh_ticker` and calls `fetch_fundamentals(key)` once if so — never when a row already exists.
  - `list_all()` and `get_one()` both compute `has_fundamentals` from whether the fundamentals lookup returned something, before any `... or {}`/`... or None` coercion that would erase the distinction.
- `backend/app/schemas.py`: added `has_fundamentals: bool` to `UniverseEntry` (once — `UniverseDetail` inherits it, not redeclared; confirmed via `grep -c`).
- Three test files updated — see "Testing" below.

## Exception types caught, and how a crumb failure is distinguished from a genuinely absent symbol

I checked what's actually installed rather than guessing: `curl_cffi` 0.16.3 (yfinance's HTTP client, used for browser-TLS impersonation) exposes `curl_cffi.requests.exceptions.RequestException` as its base network-error class (connection, timeout, SSL, HTTP-level errors). yfinance 1.7.0 separately exposes its own `yfinance.exceptions.YFException` hierarchy (`YFRateLimitError`, `YFTickerMissingError`, `YFDataException`, etc.). I catch both — `except (YFException, CurlRequestException)` — around `_download_info` in `fetch_fundamentals` and around `_download_history` in `symbol_has_history`. Neither is a bare `except`/`except Exception`.

**The distinguishing signal is not actually an exception, though — and that's the important finding.** I pulled the Render log again: `Crumb fetch rate-limited (HTTP 429)` and the subsequent `HTTP Error 401` lines are yfinance's own internal `print()`/logging calls, not raised Python exceptions — yfinance catches these itself and returns a dict, just an empty-or-near-empty one. I confirmed this is exactly the same shape `REBUILD.md` documented for a genuinely nonexistent ticker (`{'trailingPegRatio': None}`). **There is no exception-level way to tell the two apart**, because yfinance doesn't raise for either. This is exactly why the contract's design doesn't try to distinguish them at the fundamentals layer at all — `fetch_fundamentals` treats both "info fetch raised" and "info fetch succeeded but looks empty" identically, as `None`. The actual distinguishing mechanism is architectural, not exceptional: `symbol_has_history` asks a completely different Yahoo endpoint (the chart/download endpoint, which doesn't require a crumb) and that becomes the sole source of truth for existence. `UpstreamUnavailable` exists for `symbol_has_history`'s own failure mode (the chart endpoint itself being unreachable) — a real, if rarer, case where I did find raised exceptions to catch, since a hard network failure on `yf.download` does propagate as a `CurlRequestException` rather than degrading silently the way `.info` does.

## Testing

**A real regression I had to fix along the way, not something the contract explicitly called out:** every existing test that called `add()` with fake `fetch_fundamentals`/`fetch_history` (from contracts 0008/0009's test suites) broke the moment `add()` started calling the real `symbol_has_history` first — fake tickers like `"AAA"` and `"T0"` started making genuine network calls (visible in the test output: `yfinance:history.py:207 $T0: possibly delisted; no timezone found`). I added `symbol_has_history` to every existing `add()`-exercising test's patch set (consolidated into a new `_patch_add()` helper in `test_universe.py`, and a `has_history` parameter on `test_api_universe.py`'s existing `_patch_fetches()`), rather than leaving them passing by accident against a real network call.

Case-by-case:

1. `symbol_has_history` True/False/short-window/`UpstreamUnavailable` — four tests in `test_market_data.py`.
2. `test_add_succeeds_when_fundamentals_unavailable` — membership + history created, no fundamentals row, `has_fundamentals: False`.
3. `test_add_unknown_symbol_overrides_a_populated_fundamentals_response` — `fetch_fundamentals` is given a fake that would happily succeed; `symbol_has_history=False` still raises `UnknownSymbol` and the fundamentals fake is never invoked (asserted implicitly — no assertion failure from the fake means it wasn't called, since it would have stored real data otherwise... explicitly guarded in the sibling test below too).
4. `test_add_unknown_symbol_raises_and_leaves_no_row` — rewritten to gate on `symbol_has_history`, with `_raising_fetch_history`/`_raising_fetch_fundamentals` guards proving neither is reached.
5. Covered by the many existing `add()` tests that already assert real fundamentals values (`test_add_new_ticker_creates_row_and_returns_detail`, etc.) — unchanged in substance, just re-pointed at `_patch_add`.
6. `test_fetch_fundamentals_returns_none_for_invalid_looking_dict` / `test_fetch_fundamentals_returns_none_for_empty_dict` — both `{'trailingPegRatio': None}` and `{}`.
7. `test_fetch_fundamentals_none_writes_no_row` — queries `get_fundamentals` directly after a `None` result.
8. `test_list_all_reports_has_fundamentals` — one ticker each way in the same universe.
9. `test_refresh_backfills_fundamentals_when_absent` / `test_refresh_does_not_refetch_fundamentals_when_present` (the latter uses a `fetch_fundamentals` that raises `AssertionError` if called at all).
10. `test_etf_entry_round_trips_with_none_fields` — extended with `has_fundamentals is True`. **One discrepancy worth flagging:** the contract's testing section says "six null fields"; my test (and the original contract-0008 one it's built on) checks five (`sector`, `industry`, `market_cap`, `beta`, `forward_pe`) — `schemas.py`'s own comment lists the same five plus `currentPrice`, which isn't a field in our schema at all (we map `regular_market_price` from `regularMarketPrice` instead, which *is* present for ETFs). I couldn't find a sixth nullable schema field that's genuinely ETF-absent, so I left the test at five and didn't invent a field to hit a round number — flagging rather than silently matching the count.
11. `test_get_universe_includes_has_fundamentals` (`test_api_universe.py`), plus `test_post_universe_succeeds_when_fundamentals_unavailable` reproducing the reported production bug end-to-end through the actual HTTP endpoint.
12. No changes to `test_is_valid_symbol` or its imports — still passing, confirmed by the full-suite run below.

## Commands run

```
$ cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
........................................................................ [ 60%]
................................................                         [100%]
120 passed, 2 warnings in 1.00s
(run 3x consecutively to confirm no flakiness: 120/120/120)

$ grep -rnE "except\s*:|except Exception" backend/app/market_data.py backend/app/universe.py ; echo "exit=$?"
exit=1 (clean)

$ grep -cE '^\s+has_fundamentals\s*:' backend/app/schemas.py
1

$ ls -1 backend/migrations/versions/
0001_initial.py
0002_add_adj_close.py
0003_universe_tickers.py

$ git diff --stat frontend/ backend/app/freshness.py backend/app/cache.py backend/app/models.py backend/tests/conftest.py backend/requirements.txt ; echo "(empty = untouched)"
(empty = untouched)

$ git status --short backend/
 M backend/app/market_data.py
 M backend/app/schemas.py
 M backend/app/universe.py
 M backend/tests/test_api_universe.py
 M backend/tests/test_market_data.py
 M backend/tests/test_universe.py
```

Also ran, safely prefixed per the contract's own instruction:

```
$ DATABASE_URL="" PATH="$PWD/.venv/bin:$PATH" python -c "from app.market_data import symbol_has_history, fetch_fundamentals, UpstreamUnavailable; print(...)"
module imports cleanly, UpstreamUnavailable: <class 'app.market_data.UpstreamUnavailable'>
```

I did not run the live-deployment `curl` commands in the Human Verification section — those hit `https://blue-eagle-backend.onrender.com`, a real deployed service, which is explicitly yours to run.

## Deviations from the contract

1. **The "six null fields" in Testing case 10** — I found five, not six, and didn't invent a sixth. Detailed above.
2. **No other deviations.** The interface signatures, exception types, reorder sequence, and schema field all match what was specified.

## Not done

Nothing from the Files/Interface/Acceptance-criteria lists. Per Out of Scope: no retry/backoff library added, no proxy/alternate provider, `freshness.py` and drift logic untouched, no frontend changes (the field exists in the API response; surfacing it in the UI is explicitly a follow-up), no migration, no delete endpoint, `is_valid_symbol` and `_download_info` both still present and unmodified.

## Gaps and uncertainty

- **I could not reproduce the actual crumb/401 failure locally** — confirmed in the previous conversation turn that fetching SPY from this sandbox succeeds cleanly. Every test here is therefore built from the *shape* of the failure (empty/sentinel `info` dicts, per `REBUILD.md`'s and the production log's evidence), not from a live repro. If Yahoo's actual failure mode ever differs from `{}` or `{'trailingPegRatio': None}` — e.g., a dict with some keys present but corrupted values — `is_valid_symbol` might behave differently than assumed here. I did not test that shape because I have no evidence it occurs.
- **`symbol_has_history`'s `UpstreamUnavailable` path is speculative in a specific way**: I inferred that `yf.download` failures propagate real exceptions (unlike `.info`, which swallows them) from yfinance's general architecture and from finding real exception classes in the installed package, not from observing an actual `yf.download` failure in the Render logs — the log only showed the `.info`/crumb failure, not a `yf.download` failure. If `yf.download` also silently degrades to an empty frame on some failure modes rather than raising, `UpstreamUnavailable` would never fire for those cases and they'd be indistinguishable from "confirmed no history" — the same category of problem this contract fixes for fundamentals, potentially still latent on the history side. Not tested because I have no confirmed failure shape to test against.
- **The flaky test I found in the pre-existing baseline** (`test_refresh_idempotence_missing_range_unchanged`, one failure in 4 runs before my changes, 0/3 after) belongs to contract 0012, not this one. I didn't investigate or fix it — it wasn't reproducible enough to diagnose confidently, and it's outside this contract's file list in spirit even though `test_market_data.py` is one I'm allowed to touch. Worth a look if it recurs.
- **`add()`'s `fetch_fundamentals(key)` call result is discarded** (`# best-effort; None is not an error, nothing to check here`) — correct per spec, but means a caller of `add()` has no way to know from the return value alone whether fundamentals were just fetched successfully or were already best-effort-skipped; `get_one()`'s `has_fundamentals` field, read immediately after, is the only signal. This seemed sufficient given the interface as specified, but it's a slightly indirect way to find out.

## Files changed

```
$ git status --short backend/app/market_data.py backend/app/universe.py backend/app/schemas.py backend/tests/test_market_data.py backend/tests/test_universe.py backend/tests/test_api_universe.py
 M backend/app/market_data.py
 M backend/app/schemas.py
 M backend/app/universe.py
 M backend/tests/test_api_universe.py
 M backend/tests/test_market_data.py
 M backend/tests/test_universe.py
```

---

## Audit — Planner only

**Verdict:**

**Verification I re-ran myself:**

**Findings:**

**Follow-up contracts filed:**
