# Contract 0012 — yfinance's `end` is exclusive; refresh never terminates

**Status:** accepted
**Assigned to:** haiku
**Author:** planner (opus)

## Goal

`refresh` reaches the last completed session and becomes idempotent again: a ticker refreshed twice
in a row returns `action: "none"` the second time.

## Why

**Production bug, planner defect.** `yf.download`'s `end` parameter is **exclusive**. `missing_range`
returns `(newest_stored, last_session)` and that tuple is passed straight through, so the last
session is never actually fetched. The stored bar can therefore never reach `last_session`,
`is_stale` stays permanently `True`, and every refresh re-fetches, stores nothing new, and reports
`"appended"` again.

Measured against the live deployment on 2026-09-14:

```
last_session = 2026-09-14   MSFT last_bar = 2026-09-11   refresh → "appended", 2513 → 2513
repeat        → "appended", 2513 → 2513        (never terminates)
```

And proven directly against yfinance:

```
start=2026-09-11 end=2026-09-14 → ['2026-09-11']                  ← Monday missing
start=2026-09-11 end=2026-09-15 → ['2026-09-11', '2026-09-14']    ← end + 1 day
```

This destroys the idempotence property contract 0007 was built around, and every wasted request
makes Render's shared IP look more abusive to Yahoo — which is plausibly contributing to the
separate crumb/401 failure that contract 0013 addresses.

`reference files/old_yfinance_project/YF.py:258` documents this exactly — *"yfinance 'end' is
exclusive"* — and adds a day at every call site. Contract 0007 carried over that file's drift
detection and 4pm rule and missed its most important line.

**Depends on contract 0007.** If `app/freshness.py` has no `missing_range`, stop and report
`BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## The fix: convert at the boundary, keep dates inclusive everywhere else

**All date parameters in this codebase are inclusive.** `_download_history` is the adapter to
yfinance and is the one place that knows about its exclusive-`end` convention.

```python
def _download_history(ticker: str, start: date | None, end: date | None) -> pd.DataFrame:
    """...
    `end` is INCLUSIVE here. yfinance's end is exclusive, so one day is added on the way out.
    Every other date in this codebase is inclusive; this function is the only place that
    converts."""
    yf_end = end + timedelta(days=1) if end is not None else None
    return yf.download(ticker, start=start, end=yf_end, auto_adjust=False, progress=False, threads=False)
```

- `end=None` must stay `None`. The reference-ticker fetch and the first history fetch both pass
  `None`, and `None + timedelta` raises.
- **Do not change `missing_range`.** Its `(newest_stored, last_session)` return is semantically
  correct — those are the dates we want *stored*. The bug is in the translation, not the intent.
- **Do not fix this at the call site in `refresh_ticker`.** Any other caller of `fetch_history`
  would keep the bug. Contract 0006 called `_download_history` "thin, no logic" — vendor convention
  adaptation is precisely what a boundary function is for, and this is the exception to that line.

## Files

Modify:
- `backend/app/market_data.py` — the `+ 1 day` conversion and its docstring
- `backend/tests/test_market_data.py` — boundary tests
- `backend/tests/test_freshness.py` — the idempotence regression test

**Touch nothing else.** Do not modify `app/freshness.py`, `app/cache.py`, `app/db.py`,
`app/models.py`, `app/universe.py`, `app/routers/`, `app/schemas.py`, any migration,
`tests/conftest.py`, `tests/test_cache.py`, or anything under `frontend/`. No new dependencies. If
the work appears to require a file not on this list, stop and report `BLOCKED`.

## Testing

No network. Monkeypatch `yf.download` and assert on the arguments it receives.

Required cases:

1. `_download_history("X", date(2026,9,11), date(2026,9,14))` calls `yf.download` with
   `end=date(2026,9,15)` — **one day later than the argument**. Assert the exact value passed.
2. `_download_history("X", None, None)` passes `end=None`, not a date and not a crash.
3. `_download_history("X", date(2026,1,1), None)` passes `start` unchanged and `end=None`.
4. `start` is never modified — only `end`.
5. **The regression test, and the reason this contract exists.** Stored history through
   2026-09-11, `last_session` 2026-09-14, a fake downloader that honours yfinance's exclusive-end
   semantics (returns bars where `start <= d < end`). After one `refresh_ticker`, the stored newest
   bar is 2026-09-14, and a **second** `refresh_ticker` returns `action: "none"`.

   The fake downloader must model exclusivity, not inclusivity. A fixture that returns everything
   in `[start, end]` inclusive passes whether or not the bug is fixed — that is how this shipped.

6. `missing_range` still returns `(newest_stored, last_session)` unchanged — the existing contract
   0007 tests must pass untouched.

## Out of scope

- No changes to `missing_range`, `is_stale`, `last_completed_session`, `pick_drift_anchors` or
  `detect_drift`.
- No changes to the crumb/401 fundamentals failure — that is contract 0013.
- No retry, backoff or rate limiting.
- No API, schema, or frontend changes.
- Do not "improve" the `action` labels. Whether `"appended"` should say something else when the bar
  count is unchanged is cosmetic; criterion 5 covers the behaviour that matters.

## Acceptance criteria

0. Only the three listed files changed.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 102.
2. All six cases above present.
3. `grep -n "timedelta" backend/app/market_data.py` shows the conversion.
4. `git diff --stat backend/app/freshness.py backend/app/cache.py backend/app/universe.py backend/app/schemas.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt`
   is empty.
5. The existing contract 0007 freshness tests still pass unmodified — `missing_range`'s semantics
   did not change.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string, so an
> unprefixed script talks to the **production database**.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
grep -n "timedelta" backend/app/market_data.py
git diff --stat backend/app/freshness.py backend/app/cache.py backend/app/universe.py backend/app/schemas.py backend/tests/conftest.py backend/tests/test_cache.py backend/requirements.txt ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "
from datetime import date
import app.market_data as md
seen = {}
md.yf.download = lambda t, **kw: seen.update(kw) or __import__('pandas').DataFrame()
md._download_history('X', date(2026,9,11), date(2026,9,14))
print('start passed:', seen['start'], '| end passed:', seen['end'], '| expected end: 2026-09-15')
md._download_history('X', None, None)
print('end when None:', seen['end'])"
```

## Human verification — does Gunnar need to run anything?

**Yes — against the live deployment, because that is where it was observed.** After this deploys:

```bash
curl -s -X POST https://blue-eagle-backend.onrender.com/universe/MSFT/refresh | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['action'], d['bars_before'],'->',d['bars_after'],'| last_session',d['last_session'])"
curl -s -X POST https://blue-eagle-backend.onrender.com/universe/MSFT/refresh | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['action'], d['bars_before'],'->',d['bars_after'])"
```

What proves it: the first call **increases** the bar count and the second returns **`action: none`**.
Before this fix both calls returned `"appended"` with the count unchanged, forever. Also check
`GET /universe` shows `last_bar` equal to `last_session` rather than stuck days behind.

## Open questions — do NOT resolve these yourself

- **Whether `refresh` should report something other than `"appended"` when nothing changed.**
  Cosmetic; do not change the labels.
- **Retry and backoff against Yahoo.** Still deferred, and now entangled with contract 0013.
