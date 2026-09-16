# Contract 0030 — Throwaway probe: does yfinance `.news` work from Render?

**Status:** implementation accepted with fixes (2026-09-15) — **awaiting the Render measurement**,
which is the actual deliverable. Do not archive until that JSON is in hand.
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

Answer one question with measured evidence from Render's IP: **does `yf.Ticker(t).news` return
articles from the deployed backend?** Then delete the probe.

This contract ships code that is meant to be removed two commits later. That is the point.

## Why

The news feature can take one of two shapes and they share almost nothing:

- **`.news` works from Render** → per-ticker news is free, no API key, no new service, no new
  dependency, and the article cards come straight off `ticker_fundamentals`' ticker list.
- **`.news` fails from Render** → we need Currents (an API key, a secret in two environments, a rate
  limit, a quota) or Yahoo's RSS feeds, and the contract is a different piece of work.

Guessing wrong costs a rewrite. **Contract 0013 is the precedent**: `.info` worked perfectly locally
and returned 401 from Render because Yahoo's cookie/crumb flow fails from that IP range. It cost a
rewrite of ticker validation. Local success proves nothing about Render.

**Measured locally 2026-09-15**, so the probe has a baseline to disagree with: `yf.Ticker("AAPL").news`
returns **10** items, each `{id, content}`, with `content` carrying `title`, `summary`, `description`,
`pubDate`, `provider`, `canonicalUrl`, `thumbnail`.

**What source reading already established — do not re-derive it.** `get_news` (`yfinance/base.py:591`)
POSTs to `{_ROOT_URL_}/xhr/ncp?queryRef=latestNews&serviceKey=ncp_fin` via `YfData.post` →
`_make_request` (`yfinance/data.py:421`), which **does** attempt the same cookie/crumb flow `.info`
uses. But it degrades: on `YFRateLimitError` or a transient error it logs a warning and continues
**without** a crumb, deliberately — the comment says "the target endpoint may not need a crumb".

So the open question is precisely: **does the crumb fetch fail from Render, and if it does, does
`/xhr/ncp` still return articles without one?** `/xhr/ncp` is a different service from `.info`'s
`quoteSummary`, which genuinely requires the crumb. That is why this is not already answered.

yfinance is pinned at **1.7.0**.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Restart the backend before any manual check.** A `uvicorn` without `--reload` serves the code it
was launched with. `lsof -nP -iTCP:8000 -sTCP:LISTEN` names whatever owns the port.

**If a command fails with `password authentication failed for user "<something not in .env>"`**, the
shell has a stale exported `DATABASE_URL` that `load_dotenv` will not override. `unset DATABASE_URL`.
See `REBUILD.md`.

## Files

Create:
- `backend/app/routers/debug.py`
- `backend/tests/test_debug_probe.py`

Modify:
- `backend/app/main.py` — register the router

**Touch nothing else.** No migration, no new dependency, no schema change, no frontend change, no
change to `app/market_data.py`, `app/universe.py`, `app/cache.py`, `app/quotes.py`, `app/strip.py`,
or any existing test file.

## The route must be off by default

A debug endpoint on a public backend that someone forgets to remove is a liability. Register the
router **only** when `os.getenv("DEBUG_PROBE") == "1"`. With the variable unset the path must 404 —
not 403, not an empty 200. That way a forgotten removal is inert rather than live.

Removal is still required (see "After the answer"). The gate is the backstop, not the plan.

## Interface

### `GET /debug/news/{ticker}`

Returns **200 with a report in every case, including failure.** An exception is the result, not an
error — a 500 with a stack trace in Render's log is harder to read than a JSON body.

```python
{
  "ticker": "AAPL",
  "yfinance_version": "1.7.0",
  "elapsed_seconds": 2.4,
  "news_count": 10,            # 0 when it failed or returned nothing
  "first_title": "...",        # null when news_count == 0
  "first_provider": "...",     # content.provider.displayName, null when absent
  "error": null,               # "YFRateLimitError: ..." when it raised
  "crumb_obtained": true,      # see below
  "log": ["WARNING yfinance ...", ...]
}
```

**`log` is the measurement that matters.** Attach a `logging.Handler` to the `yfinance` logger at
`DEBUG` for the duration of the call, collect `f"{levelname} {message}"` per record, and detach it in
a `finally`. The two records that decide the outcome are emitted by `data.py`:

- `"Crumb fetch rate-limited (HTTP 429), continuing without crumb"`
- `"Cookie/crumb fetch failed (...), continuing without crumb"`

Set `crumb_obtained` to `False` when either substring appears in any captured record, `True`
otherwise. **Cap `log` at the last 60 records** so a chatty DEBUG run cannot return a megabyte.

**Never include the crumb value, a cookie, or any header in the response.** The `crumb = '...'` DEBUG
line from `data.py:282` leaks the crumb — drop any record containing `crumb = '`.

Catching a broad exception **is correct here and is the one place in this codebase it is** — the
route's entire purpose is to report what went wrong. Put `# noqa` on it if the linter objects and say
so in the report; do not narrow it to guess at the failure mode in advance.

Wrap the `.news` call with `time.monotonic()` on both sides. Latency is a real signal: contract 0013's
failure was fast, whereas a slow success tells us the launch page must never block on this.

### Also probe `.info` — the control

Same route, add `"info_works": true|false` and `"info_error": null|"..."`. One `yf.Ticker(t).info`
call in its own try/except, its `quote_type` key read and discarded.

Without it a `.news` failure is ambiguous: Yahoo-blocks-Render and Yahoo-is-having-a-bad-day look
identical. If `.info` fails the way 0013 documented and `.news` succeeds, that is a clean result. If
both fail, retry later before concluding anything.

## Tests

Tests **must pass with no network and no database.** Never call yfinance for real in a test.

1. With `DEBUG_PROBE` unset, `GET /debug/news/AAPL` returns **404**.
2. With `DEBUG_PROBE=1`, patching `yfinance.Ticker` so `.news` returns two fake items: the response
   is 200, `news_count == 2`, `first_title` matches, `error is None`.
3. With `DEBUG_PROBE=1`, patching `.news` to raise: the response is still **200**, `news_count == 0`,
   and `error` contains the exception type name. **This is the criterion that matters** — the probe
   is worthless if a failure on Render produces a 500 instead of a report.
4. A record containing `crumb = 'abc123'` is **absent** from the returned `log`.

Import-time registration gated on an env var is awkward to test — set the variable and build a fresh
app instance inside the test rather than relying on the module-level import. If that proves
impossible without editing `main.py` beyond the registration line, **report BLOCKED and say so**;
do not restructure `main.py` to make the test convenient.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **211**.
2. `grep -n "DEBUG_PROBE" backend/app/main.py backend/app/routers/debug.py` matches in both.
3. A test asserts 404 when `DEBUG_PROBE` is unset.
4. A test asserts **HTTP 200 with `error` populated** when `.news` raises.
5. `grep -rn "crumb = '" backend/app/routers/debug.py` matches — the redaction exists and is
   deliberate. Quote the surrounding line in the report.
6. `ls backend/migrations/versions/` shows exactly four revisions.
7. `git diff --stat backend/app/universe.py backend/app/quotes.py backend/app/cache.py backend/app/strip.py backend/app/market_data.py backend/requirements.txt` is empty.
8. `git status --porcelain` shows no new untracked files under `frontend/`.
9. Local smoke test, pasted verbatim:
   ```bash
   cd backend && DEBUG_PROBE=1 PATH="$PWD/.venv/bin:$PATH" uvicorn app.main:app --port 8001 &
   curl -s localhost:8001/debug/news/AAPL
   ```
   Expect `news_count: 10` and `crumb_obtained: true` **from your machine**. That is the baseline the
   Render run gets compared against — it is not evidence about Render.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "DEBUG_PROBE" backend/app/main.py backend/app/routers/debug.py
grep -rn "crumb = '" backend/app/routers/debug.py
ls -1 backend/migrations/versions/
git diff --stat backend/app/universe.py backend/app/quotes.py backend/app/cache.py backend/app/strip.py backend/requirements.txt ; echo "(empty = untouched)"
git status --porcelain
```

Plus the port-8001 smoke test above. Kill that server when done and say that you did.

## Human verification — does Gunnar need to run anything?

**Yes, and it is the entire point of the contract.** Nothing here is answered locally.

1. Commit and push.
2. In the Render dashboard, set `DEBUG_PROBE=1` on the backend service. Let it redeploy.
3. Wait out the cold start (~43s), then:
   ```bash
   curl -s https://<your-backend>.onrender.com/debug/news/AAPL | python3 -m json.tool
   ```
4. Paste the whole JSON body back. Do not summarise it — `log` and `crumb_obtained` are the answer
   and are easy to trim by accident.
5. If `news_count` is 0 **and** `info_works` is false, wait an hour and run it again before we
   conclude anything. Both failing at once is as consistent with a bad afternoon at Yahoo as with an
   IP block.
6. **Remove `DEBUG_PROBE` from Render** once you have the output.

## After the answer

The probe is deleted, not kept. Once the JSON is in hand:

- `backend/app/routers/debug.py` and `backend/tests/test_debug_probe.py` are removed
- the registration line comes out of `backend/app/main.py`
- the measured result is recorded in `REBUILD.md` — **the number, the log lines, and the date**, not
  "news works"

The next contract writes the real news feature against whichever shape the answer forces.

## Out of scope

- **Do not build any part of the news feature.** No storage, no schema, no summarization, no cards,
  no frontend, no scheduled fetch.
- No caching of the probe result.
- No Currents integration, no RSS fallback, no LLM.
- No retry loop, no backoff — one call each, report what happened.
- No new dependency. No migration.

## Open questions — do NOT resolve these yourself

- **Whether news gets stored or fetched live.** Depends on the latency this probe measures.
- **Whether news is per-ticker or one market-wide feed.** Yahoo's `latestNews` tab is only loosely
  tied to the ticker — AAPL's top story on 2026-09-15 was about TSMC and MediaTek — which may change
  the answer. Not this contract's call.
- **Currents vs Yahoo RSS**, if `.news` turns out to be unusable from Render.

---

## Audit (planner, 2026-09-15)

Re-run against the working tree: **215 passed**, 4 migrations, scope empty for `universe.py`,
`quotes.py`, `cache.py`, `strip.py`, `market_data.py`, `requirements.txt`, nothing new under
`frontend/`. Redaction present at `debug.py:85`. `main.py` changed by exactly the registration block
plus `import os`.

### Criterion 2 failed, and the report marked it passed

`grep -n "DEBUG_PROBE" backend/app/main.py backend/app/routers/debug.py` matches **main.py only**.
The report pasted `backend/app/routers/debug.py:14:import yfinance as yf` as evidence — a line that
does not contain the searched string — under a ✓.

The substance is fine: gating at the single registration point is correct and `DEBUG_PROBE` has no
business being referenced inside the router. **The criterion was badly chosen by the planner.** The
defect is the report asserting a match that does not exist; that is what makes audits necessary
rather than optional.

### Four fixes applied by the planner rather than sent back

Throwaway file, ~10 lines, and a round trip would have cost more than the fix:

1. **`yf_logger.setLevel(logging.DEBUG)` was never restored.** The `finally` removed the handler but
   left the `yfinance` logger at DEBUG for the life of the process — on Render, one probe call would
   have flooded the log for every later yfinance call, including universe refreshes. Now saved to
   `previous_level` and restored.
2. **`elapsed_seconds` measured `.news` *and* the `.info` control together.** The contract said to
   wrap the `.news` call specifically, because news latency is what decides whether the real feature
   stores or fetches live. Added `news_elapsed_seconds`. Locally the split is **0.34s news vs 0.61s
   total** — the conflated number was nearly double.
3. **Test fixtures mutated `os.environ` directly** (`del os.environ["DEBUG_PROBE"]`, bare
   `os.environ[...] = "1"`) with no restore, making every later test in the session order-dependent.
   Now `monkeypatch.delenv`/`setenv`.
4. Unused imports `os` and `HTTPException` in `debug.py`.

### Known-vacuous test — planner's fault, recorded not fixed

`test_debug_probe_404_when_debug_probe_unset` builds a `FastAPI` app, never adds the debug router,
and asserts 404. That is tautological: it tests that an app without a route 404s. `app_with_probe`
likewise **re-implements** the gate inline instead of exercising `main.py`.

So the safety property the gate exists for — *if someone forgets to remove this, it is inert* — is
**not tested anywhere**. The contract told the implementer to "build a fresh app instance inside the
test rather than relying on the module-level import", and that instruction is what produced this.
Testing it properly needs `importlib.reload` of `app.main` under a patched environment.

Not fixed because this file is deleted once the Render answer lands. If the gate ever outlives the
probe, the test has to be made real first.

### Local smoke test after fixes

```
yfinance_version: 1.7.0     news_count: 10          crumb_obtained: True
elapsed_seconds: 0.61       news_elapsed: 0.34      info_works: True
log records: 60             any leaked crumb: False
```

**This is the baseline, not evidence about Render.** `.info` succeeding here is exactly what it did
before contract 0013 discovered it returns 401 from Render.
