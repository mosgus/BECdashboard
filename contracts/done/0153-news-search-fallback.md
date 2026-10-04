# Contract 0153 — News: fall back to Yahoo Search, stop the empty-feed retry storm, show the briefing alone

**Status:** reported
**Assigned to:** sonnet
**Author:** planner (opus)

## Goal

The launch page shows no article cards and no briefing. This contract fixes that and makes the
next upstream break visible. There are four parts:
1. **Fallback.** Use `yf.Search` for news when `Ticker.news` returns nothing.
2. **Cool-down.** Stop an empty feed from refetching on every page load.
3. **Visible failure.** Record a refresh where every feed was empty as `partial`, not `success`.
4. **Briefing alone.** Render the briefing even when there are no articles.

## Why — what the planner found (2026-10-03, read-only)

- **Every refresh since 2026-10-01 20:00 UTC has stored nothing.** `/ops/job_runs` shows each
  `news_refresh` since then as `success` with `{"feeds": 7, "stored": 0, "errors": []}`. Runs
  before that stored 28 each. `/ops/status` shows `news.article_count: 0`. The retention prune
  (2 days) has emptied the table.
- **Yahoo removed the endpoint.** `yf.Ticker(t).news` posts to Yahoo's `/xhr/ncp?queryRef=latestNews`,
  which now returns **HTTP 404 `{"message":"Not Found"}`**. yfinance 1.7.0, the latest on PyPI,
  turns that into `[]` without raising. AAPL, MSFT, GLD and SPY all return 0 items.
- **`yf.Search` still works.** `yf.Search(t, news_count=10).news` returns relevant stories: each
  item's `relatedTickers` includes the query. The shape is the old one: `uuid`, `title`,
  `publisher`, `link`, `providerPublishTime` (epoch seconds), `type`, `thumbnail.resolutions[]`
  and `relatedTickers`. There is **no summary field**. The planner adapted the 7 market feeds
  into the shape `parse_article` expects. Of the 69 items, 25 passed `is_preferred_publisher`,
  against 28 per run before the break.
- **An empty feed refetches on every page load.** `needs_news_refresh` returns True whenever
  `newest_fetched_at is None`, ignoring the claim. Three refreshes ran within 33 seconds at
  01:32 UTC. That is 7 Yahoo calls per page view, from Render's shared IP. Contract 0013 traced
  crumb throttling to exactly this kind of burst, and throttling would also break price
  refreshes.
- **The frontend hides the briefing too.** `NewsSection` returns `null` when
  `articles.length === 0`, so a valid stored briefing disappears along with the cards.

## Files

Modify only:
- `backend/app/news.py`
- `backend/tests/test_news.py`
- `frontend/src/components/NewsSection.tsx`, one line (see Frontend)

**Touch nothing else.** No dependency changes: yfinance stays at 1.7.0. Leave `parse_article`'s
behaviour, the publisher list, the windows and the briefing alone.

## Backend — `news.py`

### 1. Search fallback

Add a pure function:

```python
def search_item_to_raw(item: dict) -> dict | None:
    """One yf.Search news item -> the Ticker.news shape parse_article reads. None when it is not a dict."""
```

It maps:

| Search field | Becomes |
|---|---|
| `uuid` | `id` |
| `title` | `content.title` |
| `publisher` | `content.provider = {"displayName": publisher}`, only when `publisher` is a str |
| `link` | `content.canonicalUrl = {"url": link}`, only when `link` is a str |
| `thumbnail` | `content.thumbnail`, passed through as-is (`parse_article` already reads `resolutions[0].url`) |
| `providerPublishTime` | `content.pubDate`, as an ISO string ending in `Z` (e.g. `datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")`), only when it is an `int` or `float` |

There is no summary key.

`fetch_news_for(ticker)` becomes:
1. `items = yf.Ticker(ticker).news`. If it is a non-empty list, return it unchanged.
2. Otherwise, return the non-`None` results of `search_item_to_raw` over
   `yf.Search(ticker, news_count=10).news`.

Update its docstring to explain why (the ncp endpoint returning 404 from 2026-10-01), so the
fallback can be dropped if Yahoo restores the endpoint. Calls stay sequential; don't add
concurrency.

### 2. Empty-feed cool-down

Add `EMPTY_FEED_RETRY_MINUTES = 15`. Then:
- In `needs_news_refresh`, when `newest_fetched_at is None`, return True only if
  `last_claim_at is None` or `now_et - last_claim_at >= timedelta(minutes=EMPTY_FEED_RETRY_MINUTES)`.
  Both are timezone-aware, so the subtraction is valid across zones.
- The rest of the function is unchanged.
- Update the docstring. A fresh deploy still fills immediately, because there is no claim. An
  empty feed retries at most every 15 minutes.

### 3. All-empty refreshes are `partial`

In `refresh_news_if_stale`, count raw items per feed. If **every** feed that did not raise
returned zero raw items, and there was at least one such feed, append the string
`"all feeds returned no items"` to `errors`. `record_run` then marks the run `partial`, so the
Ops page shows it.

Leave a feed that raises recorded exactly as now.

## Backend tests (`test_news.py`)

Add:
1. **`test_search_item_to_raw_round_trips_through_parse_article`.** Use this literal input:
   ```python
   {"uuid": "709aaeaa-bdf3-3b24-b255-1dac8b8375d6", "title": "Michael Saylor Says Strategy's STRC Is Now Steadier", "publisher": "Stocktwits",
    "link": "https://finance.yahoo.com/markets/stocks/articles/michael-saylor-says-strategys-strc-174624982.html", "providerPublishTime": 1791049584, "type": "STORY",
    "thumbnail": {"resolutions": [{"url": "https://media.zenfs.com/en/stocktwits_383/5ea1f6ae78098f49a8b0cb1a3d5742a1", "width": 1280, "height": 853, "tag": "original"}]},
    "relatedTickers": ["MSTR", "SPY"]}
   ```
   `parse_article(search_item_to_raw(item), "SPY", now)` has:
   - `id` equal to the uuid, plus the title, `publisher == "Stocktwits"`, the link as `url`, and
     the first resolution's url as `thumbnail_url`;
   - `summary is None`;
   - `pub_date == datetime.fromtimestamp(1791049584, timezone.utc)`.
2. **`test_search_item_to_raw_tolerates_missing_fields`.**
   - `{"uuid": "x", "title": "t"}` parses, with `publisher`, `url`, `thumbnail_url` and
     `pub_date` all `None`.
   - `search_item_to_raw("nope")` is `None`.
   - `{"title": "t"}` parses to `None` (no id).
3. **`test_fetch_news_for_uses_search_only_when_ticker_news_is_empty`.** Monkeypatch
   `app.news.yf.Ticker` and `app.news.yf.Search` with small fakes.
   - When `.news` is `[]`, the result is the adapted Search items.
   - When `.news` is a non-empty list, Search is **not** called. The fake raises if it is.
4. **`test_needs_news_refresh_empty_feed_waits_out_the_cool_down`.**
   - `needs_news_refresh(None, claim, now_et)` is False with a claim 5 minutes before `now_et`.
   - It is True with a claim 15 minutes before.
5. **`test_all_empty_feeds_record_partial`.** Use `fetch_news_for` returning `[]` for every
   ticker. The latest run has `status == "partial"`, and
   `"all feeds returned no items" in detail["errors"]`.

**Two existing tests need different fakes.** These are the only existing tests you may change:
`test_run_records_success_with_briefing_true_when_refresh_briefing_completes` and
`test_run_records_briefing_false_when_refresh_briefing_raises`. Both fake an all-empty fetch
while asserting `success`, which is exactly the case now recorded as `partial`.
- Change their fake to `lambda ticker: [_raw_item(f"{ticker}-1")]`. `_raw_item` defaults to
  Reuters, which is a preferred publisher.
- In the first test, `stored == 0` becomes `stored == len(MARKET_NEWS_TICKERS)`.
- Change nothing else in them, and report both edits.

The existing `needs_news_refresh(None, None, …)` tests must still pass unchanged.

## Frontend — `NewsSection.tsx`

Change `if (failed || articles.length === 0) return null` to
`if (failed || (articles.length === 0 && !summary?.text)) return null`.

That is the only edit. Gunnar may have uncommitted work in nearby files, so **don't run Prettier
on this file**.

## Out of scope

- Upgrading or pinning yfinance.
- Filtering Search results by `relatedTickers`.
- Changing the publisher list.
- Restyling the cards.
- The briefing's own refresh rules.
- Ops page UI.

## Acceptance criteria

Run them in bash from the repo root.

1. **Backend:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q)` passes. Before:
   746. After: 746 + 5. Paste both.
2. **News tests:** `(cd backend && DATABASE_URL="" .venv/bin/python -m pytest -q tests/test_news.py tests/test_api_news.py tests/test_briefing.py)`
   passes.
3. **Live fetch, with no database.** This uses the network to reach Yahoo. If your sandbox has
   none, report `BLOCKED` for this criterion only.
   ```
   (cd backend && DATABASE_URL="" PYTHONPATH=. .venv/bin/python -c "
   from datetime import datetime, timezone
   from app.news import fetch_news_for, parse_article, is_preferred_publisher, MARKET_NEWS_TICKERS
   now = datetime.now(timezone.utc); kept = 0
   for t in MARKET_NEWS_TICKERS:
       rows = [parse_article(r, t, now) for r in fetch_news_for(t)]
       kept += sum(1 for r in rows if r and is_preferred_publisher(r['publisher']))
   print('preferred', kept)")
   ```
   It must print `preferred` followed by a number ≥ 1. Paste the output. The planner got 25.
4. **Frontend:**
   - `(cd frontend && npx vitest run)` passes, unchanged from 312.
   - `npx tsc -p tsconfig.app.json --noEmit` is clean.
   - `npm run lint` shows only the two known warnings.
   - `npm run build` succeeds.
5. `grep -n "articles.length === 0 && !summary?.text" frontend/src/components/NewsSection.tsx`
   prints exactly 1 line.
6. `grep -n "EMPTY_FEED_RETRY_MINUTES = 15" backend/app/news.py` prints 1 line.

`BLOCKED` is the right answer to a criterion that cannot be satisfied. Report every deviation,
even one you think is harmless.

## Human verification — Gunnar

1. **Restart the local backend**, then load the launch page.
   - Within one page load, the cards should come back, with no summary text on them because
     Search has none.
   - The briefing will refresh on its own schedule.
2. **In `/ops`, check the latest `news_refresh`.** `stored` should be above 0.
3. **After deploying**, check Render's `/ops` the same way.

## Open questions

None.
