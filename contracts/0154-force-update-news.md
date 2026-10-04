# Contract 0154 — Force update also refreshes news and forces a new briefing

**Status:** open
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

Make the Ops page's **Force update** button (`POST /ops/universe/refresh`) do three things:
1. Fetch the latest news articles.
2. Write a new briefing, ignoring the 90-minute age floor.
3. Run the universe price sweep it already runs.

Do them in that order, so the briefing lands within seconds and doesn't wait several minutes for
the price sweep. A news or briefing failure must never stop the price sweep.

## Background, from the planner's reading

- **What the button does now.** `routers/ops.py::force_universe_refresh` takes
  `autorefresh._LOCK`, then schedules `autorefresh.run_manual_refresh` as a background task. That
  function sweeps prices and quotes under `record_run("universe_refresh_manual")`, then releases
  the lock in `finally`. The frontend polls `sweep_active` (which is `_LOCK.locked()`) and shows
  "Updating…" until the lock is released.
- **News.** News refreshes only from `GET /universe/strip`, through
  `news.run_news_refresh_if_due`. That function is gated by `needs_news_refresh` and the news
  window claim, and guarded by the separate `news._LOCK`.
- **Briefing.** `briefing.refresh_briefing(now_utc, now_et, articles_refreshed)` is gated by
  `needs_summary`, which requires the last summary to be at least 90 minutes old. It already
  no-ops when there is no `GEMINI_KEY` or no stored articles, and it never wipes the existing
  briefing on failure.
- **A test pins the scheduled call.** `test_briefing.py::test_refresh_news_if_stale_always_reaches_refresh_briefing_with_articles_refreshed_true`
  asserts the scheduled path calls `refresh_briefing` with exactly `(now_utc, now_et, True)`,
  with no keyword arguments. The scheduled path must keep that call byte-for-byte.

## Files

Modify only:
- `backend/app/briefing.py`
- `backend/app/news.py`
- `backend/app/autorefresh.py`
- `backend/tests/test_briefing.py` (add tests only)
- `backend/tests/test_news.py` (add tests only)
- `backend/tests/test_autorefresh_manual.py` (one autouse fixture plus new tests; see below)
- `frontend/src/components/SystemHealthCard.tsx` (tooltip text only)

Touch nothing else:
- No router changes, schema changes or new endpoints.
- No changes to the scheduled windows, `needs_summary`, `needs_news_refresh`, the prompt or the
  publisher list.

## Backend

### 1. `briefing.refresh_briefing` gains a `force` keyword

Change the signature to:

```python
def refresh_briefing(now_utc, now_et, articles_refreshed, *, force: bool = False) -> None
```

Make one change in the body: replace the `needs_summary` gate with
`if not force and not needs_summary(...): return`. Leave everything else as is. In particular,
`force=True` still no-ops with no Gemini key, no articles, or a failed or empty generation.

Add one sentence to the docstring: `force` exists for the Ops page's manual update and bypasses
only the age and articles-moved gate.

### 2. `news.refresh_news_if_stale` gains `force_briefing`

Change the signature to:

```python
def refresh_news_if_stale(tickers, now_utc, now_et, detail=None, *, force_briefing: bool = False) -> None
```

At the existing `refresh_briefing` call, use an explicit branch:

```python
if force_briefing:
    refresh_briefing(now_utc, now_et, True, force=True)
else:
    refresh_briefing(now_utc, now_et, True)
```

The plain branch must stay a three-positional-argument call, because of the test described under
Background.

### 3. New `news.run_forced_news_refresh(now_utc, now_et) -> None`

This is the manual counterpart of `run_news_refresh_if_due`, with the same structure:
1. `if not _LOCK.acquire(blocking=False): return`. A scheduled news refresh is already running,
   so skip it; don't wait.
2. In `try`, `if not is_enabled(): return`.
3. Call `_set_news_claim(now_utc)`. This claims the current window, so the next page load doesn't
   immediately fetch again.
4. Then:
   ```python
   with record_run("news_refresh", now_utc) as detail:
       detail["forced"] = True
       refresh_news_if_stale(list(MARKET_NEWS_TICKERS), now_utc, now_et, detail=detail, force_briefing=True)
   ```
5. Release `_LOCK` in `finally`.

It doesn't consult `needs_news_refresh`. Being forced is the point.

Write a short docstring that says:
- it is called from `autorefresh.run_manual_refresh`;
- it skips rather than waits when a scheduled refresh holds the lock;
- it is recorded as `news_refresh` with `detail["forced"] = True`.

### 4. `autorefresh.run_manual_refresh` calls it first

- Add `from app.news import run_forced_news_refresh` at module top. `app.news` doesn't import
  `app.autorefresh`, so there is no cycle. If the import does turn out circular, use a deferred
  import inside the function, and report that you did.
- Inside the existing `try`, directly after the `if not is_enabled(): return` check, and before
  `clear_last_session_cache()`, add:

  ```python
  try:
      run_forced_news_refresh(now_utc, now_et)
  except Exception:
      # Broad on purpose: news and the briefing are extras on a manual update; they must never
      # stop the price sweep or leave _LOCK held.
      logger.exception("app.autorefresh: forced news refresh failed; continuing with the sweep")
  ```
- Leave the rest of the function unchanged. Update the docstring to say it refreshes news and the
  briefing first.

## Backend tests

**`test_briefing.py`** (+2):
1. **`test_refresh_briefing_force_bypasses_a_recent_summary`.** Set up the same way as
   `test_refresh_briefing_skips_when_summary_is_recent`: a summary 5 minutes old, plus one
   article. Use `_fake_client_returning("Forced briefing")`. Call
   `refresh_briefing(now, now.astimezone(ET), True, force=True)`, then check that
   `latest_briefing()["summary"] == "Forced briefing"`.
2. **`test_refresh_briefing_force_still_noops_without_gemini_key`.**
   - Delete `GEMINI_KEY` from the environment and add one article.
   - Call with `force=True`.
   - Check that `latest_briefing() is None`.

**`test_news.py`** (+2):
3. **`test_forced_news_refresh_claims_records_and_forces_the_briefing`.**
   - Set an existing news claim to `now_utc - timedelta(minutes=5)` with `_set_news_claim`. That
     window is already claimed, so the scheduled path would not run.
   - Fake `fetch_news_for` as `lambda ticker: [_raw_item(f"{ticker}-1")]`.
   - Monkeypatch `app.briefing.refresh_briefing` with
     `lambda *a, **k: calls.append((a, k))`.
   - Call `run_forced_news_refresh(now_utc, now_et)`. Then check:
     - `calls == [((now_utc, now_et, True), {"force": True})]`;
     - the latest job run has `job_name == "news_refresh"`, `status == "success"`,
       `detail["forced"] is True` and `detail["stored"] == len(MARKET_NEWS_TICKERS)`;
     - `_get_news_claim() == now_utc`.
4. **`test_forced_news_refresh_skips_while_a_news_refresh_holds_the_lock`.** Acquire `news._LOCK`,
   call the function with a `fetch_news_for` fake that appends to a list, then release `_LOCK` in
   `finally`. The list is empty, and no job run is recorded.

**`test_autorefresh_manual.py`:**
- **Add one autouse fixture** that monkeypatches `app.autorefresh.run_forced_news_refresh` to a
  no-op, so the 7 existing tests never reach Yahoo. That is the only change allowed to existing
  code in this file.
- **Add 2 tests**, each using its own `monkeypatch.setattr`, which overrides the autouse no-op:
  5. **`test_manual_refresh_runs_news_before_the_sweep`.**
     - Add ticker AAPL.
     - Patch `run_forced_news_refresh` to append `"news"` to an `order` list, and
       `app.autorefresh.refresh` to append `f"sweep:{ticker}"` and return `{"action": "none"}`.
     - Stub `clear_last_session_cache` and `fetch_quotes` as the existing tests do.
     - Then `_begin()` and `run_manual_refresh(...)`.
     - Check `order == ["news", "sweep:AAPL"]` and `_LOCK.locked() is False`.
  6. **`test_manual_refresh_sweeps_even_when_news_raises`.** Patch `run_forced_news_refresh` to
     raise `RuntimeError("yahoo down")`. Then check:
     - the sweep still ran;
     - the latest run is `universe_refresh_manual` with status `success`;
     - `_LOCK.locked() is False`.

Baseline: **751**. After this contract: **751 + 6**.

## Frontend — `SystemHealthCard.tsx`

Change only the Force update `<Tooltip label=…>` text to:

`Bring every universe ticker's price history and quotes up to date, fetch the latest news and write a fresh briefing now, without waiting for the next refresh window`

**Do not run Prettier on this file.** Then check:
- `awk 'length > 300' frontend/src/components/SystemHealthCard.tsx` prints nothing;
- no frontend test asserts the old tooltip text (the planner grepped and found none), so vitest
  stays at 312.

## Out of scope

- A separate "Refresh news" button.
- Refetching the launch page's news after a forced run. The launch page fetches on mount, so
  opening it after the update shows the new content.
- Rate-limiting the button. Each click costs one Gemini flash-lite call, seven Yahoo Search calls
  and the existing sweep. `autorefresh._LOCK` already returns 409 for overlapping clicks.

## Acceptance criteria

Run these in bash from the repo root.

1. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes with 751 + 6 tests.
   Paste the tail of the output.
2. `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_briefing.py tests/test_news.py tests/test_autorefresh_manual.py tests/test_api_ops.py)`
   passes.
3. `grep -n "refresh_briefing(now_utc, now_et, True)$" backend/app/news.py` prints 1 line: the
   unforced call is unchanged.
4. `grep -n "def run_forced_news_refresh" backend/app/news.py` prints 1 line, and
   `grep -n "run_forced_news_refresh(now_utc, now_et)" backend/app/autorefresh.py` prints 1 line.
5. Frontend:
   - `(cd frontend && npx vitest run)` gives 312 passed;
   - `npx tsc -p tsconfig.app.json --noEmit` is clean;
   - `npm run lint` shows only the 2 known warnings;
   - `npm run build` succeeds.
6. `grep -c "fetch the latest news and write a fresh briefing" frontend/src/components/SystemHealthCard.tsx`
   prints 1.

Don't press the button or call `POST /ops/universe/refresh` yourself. The local backend writes to
the production database.

`BLOCKED` is a valid answer. Report every deviation.

## Human verification (Gunnar)

1. **On Render after deploying**, press Force update. Locally you have no Gemini key, so the
   briefing step no-ops there.
2. **Check Job history.** Expect a `news_refresh` row with `forced: true` and `stored > 0`, then
   the `universe_refresh_manual` row.
3. **Open the launch page.** The briefing's "x minutes ago" should show the time you pressed the
   button.

## Open questions

None.
