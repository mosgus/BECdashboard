# Contract 0031 — News storage, lazy refresh, and `GET /news`

**Status:** accepted (2026-09-15) — audited by planner. One planner-authored criterion was wrong;
one real concurrency gap logged below for a follow-up.
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

A fifth table holding deduplicated news articles for the whole universe, refreshed lazily on a
6-hour TTL gated to start no earlier than 09:00 ET, served by one endpoint that never blocks on a
fetch.

Backend only. The launch page renders it in contract 0032.

## Why

Contract 0030 established the facts this is built on — **do not re-derive them, and do not re-probe
Yahoo to check**:

- `yf.Ticker(t).news` **works from Render** at 0.11–0.28s per ticker, even when the crumb flow fails
  and `.info` returns 401. No API key, no Currents, no RSS.
- `.news` is *associated with* a ticker, not *about* it. AAPL's top story was a Simply Wall St piece
  about a Canadian telecom.
- Payload per item: `{id, content}`, with `content` carrying `title`, `summary`, `description`,
  `pubDate`, `provider.displayName`, `canonicalUrl`, `thumbnail`.

**Why stored rather than live.** 20 tickers × ~0.2s is ~4 seconds of sequential calls. That is fine
as a background job and unacceptable inside a launch-page render — `/` is the first thing anyone
sees and Render already cold-starts at ~43s. Fetching concurrently instead is not the fix: 20
simultaneous requests from one IP is the exact burst that got Render's shared IP crumb-throttled in
contract 0013. **Sequential is mandatory.**

**Why one blended feed.** The relevance finding above. A card asserting "news about AAPL" claims more
than the data supports; a feed across the universe does not.

## Environment

Venv at `backend/.venv`. Prepend to `PATH` on every command — never activate, never bare `python`,
never name the interpreter by path:

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
```

**Tests must pass with no network and no database.** Never call yfinance for real in a test. Any test
touching time must pin it explicitly and **patch every module that imported the name**, not just
where it is defined (`REBUILD.md`; this has bitten twice).

**If a command fails with `password authentication failed for user "<something not in .env>"`**, the
shell has a stale exported `DATABASE_URL` that `load_dotenv` will not override. `unset DATABASE_URL`.

## Files

Create:
- `backend/migrations/versions/0005_news_articles.py`
- `backend/app/news.py`
- `backend/app/routers/news.py`
- `backend/tests/test_news.py`
- `backend/tests/test_api_news.py`

Modify:
- `backend/app/models.py` — the `NewsArticle` model
- `backend/app/schemas.py` — response models
- `backend/app/main.py` — register the router (one line, plus the import)

**Touch nothing else.** Not `app/cache.py`, `app/quotes.py`, `app/strip.py`, `app/universe.py`,
`app/market_data.py`, `app/freshness.py`, `app/export.py`, `app/db.py`, `app/config.py`,
`tests/conftest.py`, any existing migration, or **anything under `frontend/`**. No new dependency.

## Schema — `news_articles`

Migration revision **0005**, down-revision **0004**. `ls backend/migrations/versions/` must show
exactly five afterwards.

| column | type | notes |
|---|---|---|
| `id` | `String` PK | Yahoo's article id — the dedup key |
| `title` | `String` NOT NULL | |
| `summary` | `Text` | `content.summary`, falling back to `content.description` |
| `publisher` | `String` | `content.provider.displayName` |
| `url` | `String` | `content.canonicalUrl.url` |
| `thumbnail_url` | `String` | best-effort; null when absent |
| `pub_date` | `DateTime(timezone=True)` | parsed from `content.pubDate` |
| `source_ticker` | `String` | **the ticker whose feed surfaced it first** |
| `fetched_at` | `DateTime(timezone=True)` NOT NULL | |

Index on `pub_date` — the feed query orders by it.

**`source_ticker` is a provenance label, not a claim.** Name it in a column comment. On conflict,
**keep the existing value** — first ticker to surface an article wins, so the label is stable across
refreshes instead of flipping with row ordering.

**No foreign key to `universe_tickers`.** Consistent with the rest of the cache: removing a ticker
from the universe must not cascade-delete stored data.

## `app/news.py`

### Pure — no database, no clock, no network

```python
NEWS_TTL_HOURS = 6
NEWS_EARLIEST_ET = time(9, 0)

def needs_refresh(newest_fetched_at: datetime | None, now_utc: datetime, now_et: datetime) -> bool:
    """True when the feed is stale and we are allowed to refresh."""

def parse_article(raw: dict, source_ticker: str, fetched_at: datetime) -> dict | None:
    """One yfinance news item -> a row dict. None when it lacks an id or a title."""
```

`needs_refresh` rules, in order:

1. `newest_fetched_at is None` → **True**. An empty table refreshes at any hour; the 09:00 gate
   exists to stop *overnight re-fetching*, not to leave a fresh deployment blank until morning.
2. `now_et.time() < NEWS_EARLIEST_ET` → **False**. Before 09:00 ET, serve what is stored.
3. otherwise → `now_utc - newest_fetched_at >= timedelta(hours=NEWS_TTL_HOURS)`.

With a 6h TTL this fires around 09:00, 15:00 and 21:00 ET, and the 03:00 slot is blocked by rule 2.
That is the intent — check the ordering of rules 1 and 2 against it.

`parse_article` must survive a malformed item without raising: `content` missing, `provider` a string
instead of a dict, `canonicalUrl` absent, `pubDate` unparseable. Return `None` rather than a
half-populated row. **A single bad article must not abort the refresh.**

### Impure

```python
def fetch_news_for(ticker: str) -> list[dict]      # one yfinance call
def refresh_news_if_stale(tickers: list[str], now_utc, now_et) -> None
def recent_articles(limit: int) -> list[dict]      # newest first, from storage only
```

`refresh_news_if_stale`:

- Calls `needs_refresh` first and returns immediately when False.
- Iterates tickers **sequentially**. No `Promise.all` equivalent, no thread pool, no `asyncio.gather`.
  Contract 0013 is the reason.
- **A failure on one ticker must not abort the rest.** Catch around the per-ticker call, log it,
  continue. This is one of the few places a broad catch belongs; say so in the report.
- Upserts by `id`, dialect-aware, the same way `app/cache.py` already does it. Read that first rather
  than inventing a second upsert style.
- Prunes rows with `pub_date` older than **14 days** at the end.

**Never delete-then-insert.** The reference app's hard-won rule is that a failed generation must
still leave a usable fallback (`_NEWS_SUMMARY_TTL_HOURS` in
`reference files/news_section_reference/`). If Yahoo is down for every ticker, the table must be
exactly as it was — a wiped table means a blank feed on the launch page with no error anywhere.
A test must assert this: a refresh in which every fetch raises leaves the existing rows untouched.

## `GET /news`

```
200 → NewsResponse       (including when the table is empty — {"articles": [], "as_of": null})
503 → no database configured
```

```python
class NewsArticleOut(BaseModel):
    id: str
    title: str
    summary: str | None
    publisher: str | None
    url: str | None
    thumbnail_url: str | None
    pub_date: datetime | None
    source_ticker: str | None

class NewsResponse(BaseModel):
    articles: list[NewsArticleOut]
    as_of: datetime | None        # newest fetched_at, null when empty
```

- Query param `limit`, default **30**, clamped to `[1, 100]`.
- **The endpoint must never block on a fetch.** Read storage, return, and schedule
  `refresh_news_if_stale` via FastAPI's `BackgroundTasks` — stdlib, no new dependency. The request
  that trips the TTL serves slightly stale articles; the next one gets fresh. A 4-second stall on the
  launch page is not acceptable and is the whole reason this is stored rather than live.
- Tickers come from the **active universe**, one bounded query. Never per-article.
- New router in `app/routers/news.py` with prefix `/news`. It has no `/{something}` catch-all, so the
  route-ordering trap does not apply here — do not add one.

## Tests

- `needs_refresh`: empty table before 09:00 → **True** (rule 1 beats rule 2); stale at 08:59 ET →
  False; stale at 09:01 ET → True; fresh at 15:00 ET with a 1-hour-old fetch → False; exactly 6h old
  at 10:00 ET → True.
- `parse_article`: a well-formed item; missing `id` → None; missing `title` → None; `provider` as a
  string → row with `publisher` None; unparseable `pubDate` → row with `pub_date` None, **not** a
  raised exception.
- Refresh where **every** ticker raises → existing rows unchanged, no delete issued.
- Refresh where one ticker raises and one succeeds → the successful ticker's articles are stored.
- The same article id returned under two tickers → **one** row, `source_ticker` from the first.
- `GET /news` returns 200 with `{"articles": [], "as_of": null}` on an empty table.
- `GET /news?limit=500` clamps to 100; `?limit=0` clamps to 1.
- A bounded-query test for the feed read, reusing contract 0008's counting approach.

## Acceptance criteria

1. `cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q` passes with no network and no
   database. Count increases from **211**.
2. `ls backend/migrations/versions/` shows exactly **five** revisions; `0005` has
   `down_revision = "0004"`.
3. `grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/news.py` matches nothing
   (exit 1) — the fan-out is sequential.
4. `grep -n "BackgroundTasks" backend/app/routers/news.py` matches.
5. `grep -rnE "\.delete\(\)|DELETE FROM" backend/app/news.py` — every match must be the 14-day
   `pub_date` prune. **Quote each matching line in the report** so the audit can see there is no
   wipe-and-reinsert.
6. A test asserts a fully-failing refresh leaves existing rows untouched.
7. A test asserts one article id surfaced by two tickers yields one row.
8. `git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/strip.py backend/app/universe.py backend/app/db.py backend/app/config.py backend/tests/conftest.py backend/requirements.txt` is empty.
9. `git status --porcelain` shows nothing new or modified under `frontend/`.
10. `grep -rnE "except\s*:" backend/app/news.py` matches nothing (exit 1). Bare `except:` is still
    banned; the per-ticker `except Exception` this contract asks for is fine and must be named in the
    report with its line number.

## Verification to run and paste

> **Every ad-hoc `python -c` below is prefixed `DATABASE_URL=""`.**

```bash
cd backend && PATH="$PWD/.venv/bin:$PATH" python -m pytest -q
ls -1 backend/migrations/versions/
grep -n "down_revision" backend/migrations/versions/0005_news_articles.py
grep -rnE "asyncio.gather|ThreadPool|concurrent.futures" backend/app/news.py ; echo "(exit $? — 1 = correct)"
grep -n "BackgroundTasks" backend/app/routers/news.py
grep -rnE "\.delete\(\)|DELETE FROM" backend/app/news.py
grep -rnE "except\s*:" backend/app/news.py ; echo "(exit $? — 1 = correct)"
git diff --stat backend/app/cache.py backend/app/quotes.py backend/app/strip.py backend/app/universe.py backend/requirements.txt ; echo "(empty = untouched)"
git status --porcelain
```

## Human verification — does Gunnar need to run anything?

**Yes — the migration touches the real database and the fetch touches the real Yahoo.**

1. Apply the migration locally:
   ```bash
   cd backend && PATH="$PWD/.venv/bin:$PATH" alembic upgrade head
   ```
2. Restart uvicorn **with `--reload`**, then:
   ```bash
   curl -s "localhost:8000/news?limit=5" | python3 -m json.tool
   ```
   First call: expect `{"articles": [], "as_of": null}` and a **fast** response — the fetch is
   scheduled in the background, not awaited. Watch the server log for ~4 seconds of activity after
   the response has already returned. **That gap is the feature working**, not a bug.
3. Call it again after those few seconds. Now expect ~30 articles, newest first, `as_of` populated.
4. Check `source_ticker` across the list — it should vary, and some entries will look unrelated to
   their ticker. That is the contract 0030 finding, not a defect.
5. Deploy: Render runs the migration on boot. Confirm `/news` there once the deploy settles.

Point 2 is the one worth watching. If the first call takes four seconds, `BackgroundTasks` was not
used and the launch page will stall in 0032.

## Out of scope

- **No frontend.** Contract 0032 renders the cards.
- **No LLM, no summarization, no Gemini key.** A later contract, if wanted at all.
- No per-ticker news endpoint, no filtering by ticker, no search.
- No scheduler, no cron, no worker process — Render's free tier sleeps after ~15 minutes, which is
  why every refresh in this codebase is lazy and request-triggered.
- No change to the ticker strip, the Universe page, or the four cards.
- No retry or backoff on a failed ticker — skip it; the next refresh picks it up.

## Open questions — do NOT resolve these yourself

- **Whether the feed is capped per source ticker.** One loud ticker could dominate 30 slots. Store
  everything; how the frontend balances it is 0032's problem.
- **Whether an AI briefing gets built at all**, and with which provider.
- **Whether the four `Coming soon` cards survive.** Still Gunnar's call.

---

## Audit (planner, 2026-09-15)

Re-run against the working tree: **242 passed** (from 211). Five migrations, `0005` with
`down_revision = "0004"`. No `asyncio`/`ThreadPool`/`concurrent.futures` in `app/news.py` (exit 1).
Scope empty across all eight protected files. Nothing touched under `frontend/`.

Live against the running backend: `GET /news?limit=500` returned **100** articles (clamped),
newest-first confirmed by comparing `pub_date` against its own reverse sort, **17** distinct
`source_ticker` values, `as_of` populated.

### Criterion 5 was wrong — the planner's, not the implementer's

`grep -rnE "\.delete\(\)|DELETE FROM"` was written for the legacy `Query.delete()` API. The
implementation uses SQLAlchemy 2.0's `delete()` construct, which is what `cache.py` and `strip.py`
already use, so the pattern could never match. Grepping the actual construct finds exactly one:

```
158: db.execute(delete(NewsArticle).where(NewsArticle.pub_date < cutoff))
```

The implementer refused to reintroduce the legacy API to satisfy the regex and said so under
Deviations. **That is the correct response to a bad criterion** and is what the deviation section
exists for. This is the planner's grep-vs-construct defect for the third recorded time — see
`REBUILD.md`.

### Real gap — concurrent refreshes are not deduplicated

Two `/news` requests arriving inside the same refresh window each schedule a background task. Both
read the same stale `newest_fetched_at`, both pass `needs_refresh`, and both walk all 20 tickers —
roughly 40 Yahoo calls for one refresh's worth of data.

**Severity: mild, not a repeat of contract 0013.** That failure was a 20-wide simultaneous burst;
this is two sequential streams interleaved, so it doubles the rate rather than multiplying it, and
the upserts are idempotent so the data is unharmed. But it is waste against the one IP Yahoo already
throttles, and the window is ~8 seconds wide — a user double-loading the launch page hits it.

Fix is a module-level non-blocking lock in `refresh_news_if_stale`: `acquire(blocking=False)`, return
immediately if not acquired. Roughly five lines. Not folded in here because it deserves its own test.

### Notes carried forward

- `_prune_old_articles` never matches rows with a null `pub_date`, because SQL `NULL < x` is NULL.
  Deliberate and documented in the docstring — a bad `pubDate` cannot prune a fresh article — with the
  consequence that such rows are never pruned at all. Harmless at this volume.
- The prune runs even when every ticker fails. The property the contract cared about still holds —
  existing rows are unchanged, because the prune is by age and nothing is wiped — but the contract's
  phrasing "no delete issued" was looser than what it actually meant.
- `active_universe_tickers()` is called in the request path on every `/news` hit, even when no refresh
  follows, because the planner's signature for `refresh_news_if_stale` takes `tickers` as an argument.
  One extra bounded query per request. Planner's design, not a deviation.
- `thumbnail_url` resolution (`resolutions[0].url`, falling back to `originalUrl`) was unspecified by
  both 0030 and 0031. The implementer picked it and confirmed it against the real payload.
