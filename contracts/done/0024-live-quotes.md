# Contract 0024 — Live quotes during market hours, and no more partial bars

**Status:** accepted
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The API serves a live intraday price for every universe ticker during market hours, refreshed at
most once per 10 minutes from a single batched request — and stops persisting daily bars that have
no close.

## Why

**Two problems, one boundary.**

**1. Partial bars are being stored.** AAPL currently holds this row:

```
date 2026-09-14  open 334.83  high 335.50  low 331.34  volume 38,702,066  close NULL  adj_close NULL
```

That is an **in-progress intraday bar**, fetched at 00:28 UTC before the session's close was
published. Contract 0007's partial-bar guard re-fetches the newest stored bar so it gets *overwritten
next time*, but nothing stops it being written in the first place. Until the next refresh it
corrupts `bar_count`, `last_bar` and the Coverage column, and — worse — `is_stale` sees a bar dated
09-14 and reports AAPL **current when it holds no price**.

**2. The Price column shows a stale close.** It should show the live price while the market is open.

These belong together: once a bar with no close is never stored, "the most recent close" is always a
real number, which is exactly what the Price column needs outside market hours.

**Measured 2026-09-15, and it decides the design:**

```
yf.download([17 tickers], period='1d', interval='1m')  →  ONE request, 0.5s
```

One batched call covers the whole universe, and it uses the **chart endpoint — crumb-free**, unlike
`.info`, which is what fails from Render's IP (contract 0013). Seventeen tickers cost one request.

**No scheduler.** Render's free tier sleeps after ~15 minutes idle, so a background job dies with
it. Refresh lazily on request when the stored quote is older than the TTL — the same pattern as
`_cached_last_session`. Nobody visiting means zero requests, which beats a timer outright.

**A table, not an in-process cache.** In-process state dies on every Render sleep, so each cold start
would refetch. `ticker_quotes` survives and is shared across users.

This is a **fourth table**, which `REBUILD.md` says requires a decision rather than a default. This
is that decision: quotes have a different lifecycle from everything else — they expire in minutes,
not sessions — and mixing them into `price_bars` is what caused problem 1.

**Named `ticker_quotes`, not `todays_price`.** At 9pm the stored value is the previous session's; a
table called "today's price" holding yesterday's price misleads whoever reads it next.

**Depends on contracts 0004 and 0021.** If `app/cache.py` has no `_write_to_db`, stop and report
`BLOCKED`.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** `tests/conftest.py` strips `DATABASE_URL` via
an autouse fixture — do not remove or weaken it.

## Files

Create:
- `backend/app/quotes.py` — market-hours logic and the batched quote fetch
- `backend/migrations/versions/0004_ticker_quotes.py` — `revision = "0004"`, `down_revision = "0003"`
- `backend/tests/test_quotes.py`

Modify:
- `backend/app/models.py` — `TickerQuote`
- `backend/app/cache.py` — reject null-close bars; quote read/write
- `backend/app/universe.py` — surface quotes in `list_all` / `get_one`
- `backend/app/schemas.py` — two new fields on `UniverseEntry`
- `backend/tests/test_cache.py` — **allowed only for the null-close guard**, see below
- `backend/tests/test_universe.py`

**Touch nothing else.** Do not modify `app/market_data.py`, `app/freshness.py`, `app/db.py`,
`app/export.py`, `app/routers/`, existing migrations, `tests/conftest.py`, or anything under
`frontend/`. No new dependencies. If the work appears to require a file not on this list, stop and
report `BLOCKED`.

**`tests/test_cache.py` has been untouchable since contract 0004.** It may be edited here **only**
if the null-close guard breaks one of its fixtures, and only minimally. If you change it, quote the
diff in the report and say which fixture forced it.

## Interface

### Part 1 — reject bars with no close

In `cache.py`'s write path: **a row whose `close` is null is not stored.** Filter before the upsert.

- Drop the row entirely. Do not store OHLV-with-null-close, do not interpolate, do not carry the
  previous close forward.
- A frame that is *entirely* null-close becomes a no-op write, not an error.
- The in-process TTL cache must hold the **same filtered frame** that goes to the database.
  Contract 0004's audit found the two diverging once already; do not recreate it.
- `adj_close` may remain null on its own — only `close` gates the row.

Consequence, and it is correct: a ticker whose latest session has no published close will report as
**stale** and refetch until the close appears. It genuinely is missing that session.

### Part 2 — `ticker_quotes`

```python
class TickerQuote(Base):
    __tablename__ = "ticker_quotes"
    ticker:     Mapped[str]      = mapped_column(String, primary_key=True)
    price:      Mapped[float]    = mapped_column(Float, nullable=False)
    as_of:      Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

- `as_of` is the timestamp of the quote itself; `fetched_at` is when we asked. They differ, and the
  TTL keys off `fetched_at`.
- **No foreign key to `universe_tickers`.** Same rule as `price_bars`: cached market data must not
  depend on a curated list.
- One row per ticker, upserted. Migration `0004`, with a real `downgrade()` that drops the table.

### Part 3 — `app/quotes.py`

```python
QUOTE_TTL_MINUTES = 10
MARKET_OPEN_ET  = time(9, 30)
MARKET_CLOSE_ET = time(16, 0)

def is_market_open(now_et: datetime) -> bool
def needs_refresh(newest_fetched_at: datetime | None, now_utc: datetime, now_et: datetime) -> bool
def fetch_quotes(tickers: list[str]) -> dict[str, tuple[float, datetime]]
def refresh_quotes_if_stale(tickers: list[str]) -> None
```

- `is_market_open` and `needs_refresh` are **pure** — time comes in as arguments, never from the
  clock. Same discipline as `freshness.py`; it is what makes them testable.
- `is_market_open`: Monday–Friday, `MARKET_OPEN_ET <= t < MARKET_CLOSE_ET`.
  **Holidays are deliberately not handled.** Detecting them needs a calendar dependency
  (`REBUILD.md` rejects `pandas_market_calendars`) or another probe request. The cost of ignoring
  them is at most one wasted batch request per TTL window on roughly nine days a year, and only if
  someone loads the page. Early closes are treated the same way. Document it; do not solve it.
- `needs_refresh` is `True` only when **the market is open** *and* (`newest_fetched_at` is `None` or
  older than `QUOTE_TTL_MINUTES`). Outside market hours it is always `False` — that is Gunnar's
  explicit decision: after the close, the Price column shows the most recent close.
- `fetch_quotes` issues **exactly one** `yf.download(tickers, period='1d', interval='1m', ...)` for
  the whole list. Never loop per ticker. Take the last non-null close per ticker and its timestamp.
  A ticker absent from the response is simply omitted from the dict — not an error.
- `refresh_quotes_if_stale` is the impure composition: read the newest `fetched_at`, consult
  `needs_refresh`, fetch and upsert if needed. No-op when no database is configured.

### Part 4 — surfacing it

`UniverseEntry` gains:

```python
current_price: float | None   # live quote; null outside market hours or when none is stored
last_close:    float | None   # most recent non-null close from price_bars
```

- `regular_market_price` stays as-is; it is a fundamentals field and changes on a different clock.
- **The backend decides `current_price`, not the frontend.** Return `null` when the market is closed
  or the stored quote is older than the TTL, so the client has no market-hours logic to duplicate.
- `list_all` calls `refresh_quotes_if_stale` for its active tickers **before** building rows, then
  joins quotes in **one query** — the 0008 audit verified `list_all` stays flat at two queries for
  ten tickers, and that property must survive. Three is acceptable; per-ticker is not.
- `get_one` reads quotes but does **not** trigger a refresh. One entry point for fetching is enough.

## Out of scope

- No scheduler, cron, or background task.
- No holiday or early-close calendar. See above.
- No WebSocket or streaming quotes.
- No intraday bar storage — only the latest price per ticker.
- No frontend changes; contract 0025 consumes this.
- No changes to `market_data.py`, `freshness.py`, or the refresh/drift logic.
- No deletion of the existing bad AAPL row — dropping-on-write is not retroactive, and deletes are
  Gunnar's to run.
- No new dependencies.

## Testing

No network, no database. Monkeypatch the downloader; SQLite `tmp_path` for persistence.

Required cases:

1. `is_market_open` — `True` at 10:00 ET Tuesday; `False` at 09:29, at 16:00 exactly, at 20:00, and
   on Saturday and Sunday.
2. `needs_refresh` is `False` outside market hours **even when no quote exists at all**.
3. `needs_refresh` is `True` during market hours when `newest_fetched_at` is `None`.
4. `needs_refresh` is `True` during hours when the newest fetch is 11 minutes old, `False` at 9.
5. `fetch_quotes` issues **exactly one** download call for a list of tickers — assert a call counter,
   not a timing.
6. `fetch_quotes` omits a ticker missing from the response rather than raising.
7. `fetch_quotes` takes the **last non-null** price when the tail of the series is null.
8. Storing a frame whose newest row has a null close **drops that row** — the stored bar count is one
   less, and `last_bar` is the previous date. **This is the AAPL bug; build the fixture to match it**
   (open/high/low/volume present, close and adj_close null).
9. After that write, `get_cached` returns the **same filtered frame** the database holds — assert
   both, so TTL cache and database cannot diverge.
10. A frame that is entirely null-close writes nothing and does not raise.
11. `list_all` includes `current_price` and `last_close`; `current_price` is `null` when the newest
    quote is older than the TTL.
12. `list_all` issues a bounded number of queries — reuse contract 0008's counting approach and
    assert it does not scale per ticker.
13. `refresh_quotes_if_stale` is a no-op with no database configured, and does not raise.

## Acceptance criteria

0. Only the listed files changed. If `tests/test_cache.py` changed, the report explains why.
1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from 169.
2. All thirteen cases present.
3. `grep -rnE "datetime\.now|date\.today|utcnow" backend/app/quotes.py` matches nothing outside
   `refresh_quotes_if_stale` and any docstring — the pure functions take time as arguments.
4. `grep -c "yf.download\|_download" backend/app/quotes.py` shows the fetch is a **single** call
   site, not a loop. Quote the lines.
5. `grep -rn "ForeignKey" backend/app/models.py` matches nothing (exit 1).
6. `grep -rnE "except\s*:|except Exception" backend/app/quotes.py backend/app/cache.py` matches
   nothing (exit 1).
7. `ls backend/migrations/versions/` shows **four** revisions; `0004` declares
   `down_revision = "0003"` and a non-`pass` `downgrade()`.
8. `git diff --stat backend/app/market_data.py backend/app/freshness.py backend/app/db.py backend/app/export.py backend/app/routers/ backend/tests/conftest.py backend/requirements.txt frontend/`
   is empty.
9. Degraded mode: with `DATABASE_URL` unset the app imports and `/health` returns 200.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.** `app/config.py` calls
> `load_dotenv()` at import and `backend/.env` holds a live Render connection string.

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "revision\|down_revision" backend/migrations/versions/0004_ticker_quotes.py
grep -n "yf.download\|_download" backend/app/quotes.py
grep -rnE "datetime\.now|date\.today|utcnow" backend/app/quotes.py
grep -rnE "except\s*:|except Exception" backend/app/quotes.py backend/app/cache.py ; echo "exit=$? (1 means clean)"
git diff --stat backend/app/market_data.py backend/app/freshness.py backend/app/db.py backend/app/export.py backend/app/routers/ backend/tests/conftest.py backend/requirements.txt frontend/ ; echo "(empty = untouched)"
cd backend && PATH="$PWD/.venv/bin:$PATH" DATABASE_URL="" python -c "
from datetime import datetime, time
from app.quotes import is_market_open
for s in ['2026-09-15 10:00','2026-09-15 09:29','2026-09-15 16:00','2026-09-19 11:00','2026-09-20 11:00']:
    d = datetime.fromisoformat(s); print(s, d.strftime('%a'), '->', is_market_open(d))"
```

That last command must print `True` only for the Tuesday 10:00 case.

## Human verification — does Gunnar need to run anything?

**One thing, and it needs the market open.** Apply the migration first:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m alembic upgrade head
```

Then **during market hours** (9:30–16:00 ET, weekday):

```bash
curl -s localhost:8000/universe | python3 -c "
import sys,json
for r in json.load(sys.stdin)[:5]:
    print(f\"{r['ticker']:6} current={r['current_price']} last_close={r['last_close']}\")"
```

`current_price` should be populated and within a few percent of `last_close`. Run it twice inside a
minute — **the second call must not re-fetch** (it will be instant; the first may take ~0.5s).

**Then after 16:00 ET**, run the same command: `current_price` should be `null` for every ticker, and
the Price column falls back to `last_close`. That is the decision you made, visible.

Also worth checking once: `SELECT COUNT(*) FROM price_bars WHERE close IS NULL` should stop growing.
The existing AAPL row stays until you delete it — this contract does not write deletes.

## Open questions — do NOT resolve these yourself

- **Market holidays and early closes.** Ignored deliberately; costs at most one wasted batch request
  per TTL window on ~9 days a year. Do not add a calendar.
- **Deleting the existing null-close AAPL row.** Gunnar's to run.
- **Whether `current_price` should fall back to the last quote after hours** rather than `null`.
  Decided: `null`, and the client shows `last_close`.
- **Pre-market and after-hours sessions.** Out of scope; regular hours only.
