"""Broad-market news: stored, not live, from a fixed set of market-wide feeds — not the
universe. Contract 0040 replaced per-universe-ticker aggregation with MARKET_NEWS_TICKERS
specifically so this stays O(1) as the universe grows: walking every active ticker made
single-stock articles scale linearly with universe size while broad-market copy did not, and
at a few hundred tickers the feed would be almost entirely single-name noise (measured
2026-09-17: five fixed feeds yield ~8 broad-market articles after the publisher filter, versus
500 yfinance calls the old per-ticker approach would have cost at that universe size).
is_preferred_publisher/needs_news_refresh/parse_article are pure — no database, no clock, no
network. The impure functions — run_news_refresh_if_due, refresh_news_if_stale and
recent_articles — are where the database reads/writes and the yfinance calls live.

One blended feed, not one per source: `.news` is associated with a ticker, not about it
(contract 0030 — AAPL's top story was about a Canadian telecom), so a per-source feed would
claim more relevance than the data supports.

Contract 0037: news and the briefing no longer run on their own rolling TTL. They refresh on
the same fixed 09:30/12:00/16:00 ET windows the universe sweep uses (app/schedule.py), with
weekends included — see needs_news_refresh — triggered from the same GET /universe/strip
request that triggers app/autorefresh.py's sweep."""

import logging
import threading
from datetime import datetime, timedelta, timezone

import yfinance as yf
from sqlalchemy import delete, func, nullslast, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.jobrun import record_run
from app.models import AppState, NewsArticle
from app.schedule import needs_auto_refresh

logger = logging.getLogger(__name__)

NEWS_REFRESH_KEY = "news_refresh"
NEWS_RETENTION_DAYS = 2
EMPTY_FEED_RETRY_MINUTES = 15

# One process, one refresh at a time (contract 0041) — a separate lock from
# app/autorefresh.py's, so a running universe sweep never blocks a news refresh, and vice
# versa. A duplicate news refresh is more expensive than a duplicate price sweep: contract 0034
# put a paid Gemini call at the end of this path. threading.Lock, not asyncio.Lock, since this
# runs as a sync function in FastAPI's threadpool.
_LOCK = threading.Lock()

# Five market-wide feeds, measured together (contract 0040) rather than derived from the
# universe — a fixed cost regardless of how many tickers the universe holds. Trivially
# extendable later (^DJI, DIA, IWM, ^VIX are candidates) if the yield proves thin; see the
# report for the measured baseline.
# Measured per-feed on 2026-09-18, counting only articles that survive is_preferred_publisher and
# are not already supplied by the first five: ^VIX adds 7 from four distinct quality publishers
# (Barron's, IBD, MarketWatch, Quartz) and is the best single addition; XLF adds 10, all MT Newswires
# pre-bell wire copy. Deliberately excluded: ^DJI adds 0 (entirely duplicates), DIA and VTI return no
# preferred articles at all, and IWM's 6 are the same MT Newswires pre-bell series as XLF's.
MARKET_NEWS_TICKERS = ("^GSPC", "^IXIC", "^RUT", "SPY", "QQQ", "^VIX", "XLF")

# Wire services and mainstream financial press, seeded from the measured publisher split
# (contract 0039: 488 stored articles, 46 publishers — MT Newswires produces exactly the
# broad-market wire copy the briefing wants, outnumbered roughly 4-to-1 by single-name SEO
# content from a handful of high-volume outlets). CNBC, MarketWatch and Associated Press are
# not in the store yet as of contract 0039; they are plausible future Yahoo providers and cost
# nothing to include ahead of time. Deliberately excluded: 24/7 Wall St., Motley Fool, Zacks,
# GuruFocus.com, Trefis, Insider Monkey, Simply Wall St., StockStory, Stocktwits, MarketBeat —
# the single-name SEO content this filter exists to keep out.
#
# Moved here from app/briefing.py in contract 0040: this module is now the ingest boundary
# (a non-preferred article is never stored at all), and briefing.py already imports from here
# (`from app.news import recent_articles`) — moving the constant the other way would make that
# a circular import.
PREFERRED_PUBLISHERS: frozenset[str] = frozenset(
    {
        "MT Newswires",
        "Reuters",
        "Bloomberg",
        "The Wall Street Journal",
        "Financial Times",
        "Barrons.com",
        "Investor's Business Daily",
        "TheStreet",
        "Yahoo Finance",
        "Yahoo Finance Video",
        "AFP",
        "Fortune",
        "Quartz",
        "CBS News",
        "Sky News",
        "Investopedia",
        "Kiplinger",
        "Associated Press",
        "CNBC",
        "MarketWatch",
    }
)


def is_preferred_publisher(publisher: str | None) -> bool:
    """True when publisher is in PREFERRED_PUBLISHERS. Case-insensitive; None is never
    preferred. Exact match, not substring — "Benzinga" must not match "Benzinga Prediction
    Markets"; those are different sources that happen to share a prefix. Reads
    PREFERRED_PUBLISHERS fresh on every call (not a derived module-level set) so it stays
    overridable by monkeypatching just that name in tests."""
    if publisher is None:
        return False
    preferred_lower = {p.lower() for p in PREFERRED_PUBLISHERS}
    return publisher.lower() in preferred_lower


def needs_news_refresh(
    newest_fetched_at: datetime | None,
    last_claim_at: datetime | None,
    now_et: datetime,
) -> bool:
    """True when an empty feed has passed its retry cool-down, or the current window is unclaimed.

    Two different timestamps, not one: `newest_fetched_at` is the newest stored article row;
    `last_claim_at` is app_state["news_refresh"] — the last time a refresh was *attempted*,
    successful or not. An attempt that fetched nothing new still claims the window, and must
    not be retried on the very next page load.

    An empty feed with no claim refreshes immediately on a fresh deploy. Once an attempted
    refresh has claimed the feed, it waits fifteen minutes before retrying, preventing an
    upstream empty response from causing one Yahoo request burst per page load. Once the feed
    has rows, this defers entirely to needs_auto_refresh, whose windows open every day,
    weekends included."""
    if newest_fetched_at is None:
        return last_claim_at is None or now_et - last_claim_at >= timedelta(minutes=EMPTY_FEED_RETRY_MINUTES)
    return needs_auto_refresh(last_claim_at, now_et)


def _parse_pub_date(raw: object) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_article(raw: dict, source_ticker: str, fetched_at: datetime) -> dict | None:
    """One yfinance news item -> a row dict. None when it lacks an id or a title.

    Every other field is best-effort: a malformed shape (content missing, provider a string
    instead of a dict, canonicalUrl absent, an unparseable pubDate) degrades that one field to
    None rather than raising — a single odd article must not abort the whole refresh."""
    article_id = raw.get("id")
    if not article_id:
        return None

    content = raw.get("content")
    if not isinstance(content, dict):
        content = {}

    title = content.get("title")
    if not title:
        return None

    summary = content.get("summary") or content.get("description")

    provider = content.get("provider")
    publisher = provider.get("displayName") if isinstance(provider, dict) else None

    canonical_url = content.get("canonicalUrl")
    url = canonical_url.get("url") if isinstance(canonical_url, dict) else None

    thumbnail = content.get("thumbnail")
    thumbnail_url = None
    if isinstance(thumbnail, dict):
        resolutions = thumbnail.get("resolutions")
        if isinstance(resolutions, list) and resolutions and isinstance(resolutions[0], dict):
            thumbnail_url = resolutions[0].get("url")
        if thumbnail_url is None:
            thumbnail_url = thumbnail.get("originalUrl")

    return {
        "id": str(article_id),
        "title": title,
        "summary": summary,
        "publisher": publisher,
        "url": url,
        "thumbnail_url": thumbnail_url,
        "pub_date": _parse_pub_date(content.get("pubDate")),
        "source_ticker": source_ticker,
        "fetched_at": fetched_at,
    }


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres
    round-trips it tz-aware. fetched_at is always written as datetime.now(timezone.utc), so
    its wall-clock numbers are genuinely UTC even after SQLite drops the tzinfo — the same
    relabel app/cache.py does for the same reason."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def get_newest_fetched_at() -> datetime | None:
    """The most recent fetched_at among all stored articles, or None when the table is empty
    or no database is configured."""
    if not is_enabled():
        return None
    with session() as db:
        newest = db.execute(select(func.max(NewsArticle.fetched_at))).scalar()
    return _as_utc(newest)


def _get_news_claim() -> datetime | None:
    if not is_enabled():
        return None
    with session() as db:
        row = db.get(AppState, NEWS_REFRESH_KEY)
        return _as_utc(row.value_at) if row is not None else None


def _set_news_claim(value_at: datetime) -> None:
    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(AppState).values(key=NEWS_REFRESH_KEY, value_at=value_at)
        stmt = stmt.on_conflict_do_update(
            index_elements=["key"], set_={"value_at": stmt.excluded.value_at}
        )
        db.execute(stmt)


def search_item_to_raw(item: dict) -> dict | None:
    """One yf.Search news item -> the Ticker.news shape parse_article reads. None when it is not a dict."""
    if not isinstance(item, dict):
        return None
    content: dict = {"title": item.get("title"), "thumbnail": item.get("thumbnail")}
    publisher = item.get("publisher")
    if isinstance(publisher, str):
        content["provider"] = {"displayName": publisher}
    link = item.get("link")
    if isinstance(link, str):
        content["canonicalUrl"] = {"url": link}
    published_at = item.get("providerPublishTime")
    if isinstance(published_at, (int, float)):
        content["pubDate"] = datetime.fromtimestamp(published_at, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"id": item.get("uuid"), "content": content}


def fetch_news_for(ticker: str) -> list[dict]:
    """Fetch one ticker's news, falling back to Search after Yahoo's ncp endpoint began returning 404 on 2026-10-01.

    The fallback can be removed if Yahoo restores Ticker.news; Search items are adapted to the
    established shape so parsing and editorial filtering stay exactly the same."""
    items = yf.Ticker(ticker).news
    if isinstance(items, list) and items:
        return items
    return [raw for item in yf.Search(ticker, news_count=10).news if (raw := search_item_to_raw(item)) is not None]


def _upsert_articles(records: list[dict]) -> None:
    with session() as db:
        dialect = db.get_bind().dialect.name
        insert_fn = pg_insert if dialect == "postgresql" else sqlite_insert
        stmt = insert_fn(NewsArticle).values(records)
        set_ = {
            col.name: getattr(stmt.excluded, col.name)
            for col in NewsArticle.__table__.columns
            if col.name not in ("id", "source_ticker")
        }
        stmt = stmt.on_conflict_do_update(index_elements=["id"], set_=set_)
        db.execute(stmt)


def _prune_old_articles(now_utc: datetime) -> None:
    """The only delete in this module — by age, never a wipe. Rows with a null pub_date
    (an unparseable one from parse_article) are never matched by `<` against a real cutoff,
    so a bad pub_date can't accidentally prune a fresh article."""
    cutoff = now_utc - timedelta(days=NEWS_RETENTION_DAYS)
    with session() as db:
        db.execute(delete(NewsArticle).where(NewsArticle.pub_date < cutoff))


def refresh_news_if_stale(
    tickers: list[str], now_utc: datetime, now_et: datetime, detail: dict | None = None
) -> None:
    """The impure work itself: fetch/parse/upsert/prune articles for the given tickers, then
    refresh the briefing. Unconditional — no staleness check lives here any more. Contract
    0037 moved gating to run_news_refresh_if_due/needs_news_refresh, since news now refreshes
    on the same fixed windows the universe sweep uses rather than its own rolling TTL; by the
    time anything calls this function, that decision has already been made. Kept as its own
    function (rather than inlined into run_news_refresh_if_due) because tests/test_news.py and
    tests/test_briefing.py call it directly.

    No-op with no database configured or an empty ticker list.

    Tickers are walked sequentially, never concurrently (contract 0013: a burst of
    simultaneous requests from one IP is what got Render's shared IP crumb-throttled). A
    failure on one ticker is caught and logged, not raised — the refresh continues with the
    rest, and a wipe is never issued: articles are only ever upserted or pruned by age, so a
    refresh where every ticker fails leaves every existing row exactly as it was.

    articles_refreshed is always True when calling refresh_briefing here — reaching this
    function at all means the caller already decided a refresh was due, which is exactly what
    that flag communicates (contract 0035).

    detail is an optional mutable dict (contract 0044's job-run bookkeeping) that, when given,
    is populated with this run's own counts — feeds walked, articles stored, feeds that
    raised, and whether refresh_briefing completed without raising. run_news_refresh_if_due
    passes record_run's own detail dict straight through here rather than duplicating this
    loop a second time just to recompute the same counts. None (the default) leaves every
    existing direct call — tests, and this function's other production behavior — unchanged."""
    if not is_enabled() or not tickers:
        return

    parsed_by_id: dict[str, dict] = {}
    errors: list[str] = []
    raw_counts: list[int] = []
    for ticker in tickers:
        try:
            raw_items = fetch_news_for(ticker)
        except Exception:
            # Broad on purpose: one ticker's feed being unreachable must not abort the
            # refresh for the other nineteen. See report.
            logger.exception("app.news: fetch_news_for(%s) failed; skipping", ticker)
            errors.append(ticker)
            continue

        raw_counts.append(len(raw_items))

        for raw in raw_items:
            parsed = parse_article(raw, ticker, now_utc)
            if parsed is None:
                continue
            # Filtered here, not inside parse_article: that function's contract is "one
            # yfinance item -> a row dict, or None when malformed" — folding an editorial
            # policy into it would make a parse failure and a policy rejection
            # indistinguishable. A non-preferred article is never stored at all (contract
            # 0040) — retention is two days, so nothing is lost long-term, and the cards, the
            # list and the briefing all see the same curated set with no extra plumbing.
            if not is_preferred_publisher(parsed["publisher"]):
                continue
            parsed_by_id.setdefault(parsed["id"], parsed)

    if raw_counts and all(count == 0 for count in raw_counts):
        errors.append("all feeds returned no items")

    if parsed_by_id:
        _upsert_articles(list(parsed_by_id.values()))

    _prune_old_articles(now_utc)

    if detail is not None:
        detail["feeds"] = len(tickers)
        detail["stored"] = len(parsed_by_id)
        detail["errors"] = errors

    # Deferred, not a module-level import: app.briefing imports recent_articles from this
    # module (contract 0034 — reuse the bounded query rather than writing a second one), so a
    # top-level import here would be circular. Only reachable once this function is actually
    # called, by which point both modules have finished loading.
    from app.briefing import refresh_briefing

    briefing_completed = True
    try:
        refresh_briefing(now_utc, now_et, True)
    except Exception:
        # Broad on purpose: a briefing failure must never affect the article refresh above,
        # which has already committed by this point.
        briefing_completed = False
        logger.exception("app.news: refresh_briefing failed after a successful article refresh")

    if detail is not None:
        # Best-effort, not "a new summary was produced": refresh_briefing itself returns
        # nothing and may legitimately no-op (needs_summary says not due yet) without that
        # being a failure — this only distinguishes "the call completed" from "it raised".
        detail["briefing"] = briefing_completed


def run_news_refresh_if_due(now_utc: datetime, now_et: datetime) -> None:
    """The scheduled entry point (contract 0037). Triggered from GET /universe/strip alongside
    app.autorefresh.run_auto_refresh_if_due, on the same fixed 09:30/12:00/16:00 ET windows —
    weekends included, since a weekday-only gate would freeze news over the weekend the way it
    doesn't matter for prices.

    Claims app_state["news_refresh"] before doing any fetch — same reasoning as
    autorefresh.run_auto_refresh_if_due: this narrows, but does not eliminate, the race between
    two visitors landing in the same window, and a window that errors is never retried by the
    next visitor thirty seconds later. It waits for the next window instead.

    Reads MARKET_NEWS_TICKERS, not the universe (contract 0040) — this is what keeps the
    refresh O(1) regardless of how many tickers the universe holds. No-op with no database
    configured, or when another refresh is already running in this process (see _LOCK above).

    A run is recorded (contract 0044) only once the claim above is written — i.e. only for a
    refresh that actually runs. GET /universe/strip fires on every page load, and this
    function returns early whenever the window is already claimed; recording before that gate
    would write a job_runs row per page view instead of per window."""
    if not _LOCK.acquire(blocking=False):
        return  # another visitor's refresh is already running in this process

    try:
        if not is_enabled():
            return

        newest_fetched_at = get_newest_fetched_at()
        last_claim_at = _get_news_claim()
        if not needs_news_refresh(newest_fetched_at, last_claim_at, now_et):
            return

        _set_news_claim(now_utc)

        with record_run("news_refresh", now_utc) as detail:
            refresh_news_if_stale(list(MARKET_NEWS_TICKERS), now_utc, now_et, detail=detail)
    finally:
        _LOCK.release()


def cap_per_ticker(articles: list[dict], max_per_ticker: int, limit: int) -> list[dict]:
    """Keep input order; skip an article once its source_ticker has max_per_ticker already.
    Stop at `limit`. max_per_ticker <= 0 disables the cap.

    An article with a null source_ticker is never capped against another null-ticker article —
    each is counted as its own always-uncapped bucket rather than all nulls sharing one, so a
    handful of them can't crowd each other out for no reason."""
    if max_per_ticker <= 0:
        return articles[:limit]

    counts: dict[str, int] = {}
    result: list[dict] = []
    for article in articles:
        if len(result) >= limit:
            break

        ticker = article.get("source_ticker")
        if ticker is None:
            result.append(article)
            continue

        if counts.get(ticker, 0) >= max_per_ticker:
            continue

        counts[ticker] = counts.get(ticker, 0) + 1
        result.append(article)

    return result


def recent_articles(limit: int, max_per_ticker: int = 0) -> list[dict]:
    """Newest first, from storage only — never fetches. Still one bounded query even when
    max_per_ticker requires over-selecting candidates to cap from: the cap is applied in
    Python after a single SELECT, not via a second query or one per ticker.

    With a cap, `limit * 4` (capped at 400) candidate rows are pulled — a judgement call, not
    a measured minimum: enough headroom for the observed distribution (contract 0031: as few as
    10 of 18 tickers filled the first 30 slots under recency-only ordering) without pulling an
    unbounded number of rows."""
    if not is_enabled():
        return []

    fetch_limit = min(limit * 4, 400) if max_per_ticker > 0 else limit

    with session() as db:
        rows = (
            db.execute(
                select(NewsArticle)
                .order_by(nullslast(NewsArticle.pub_date.desc()))
                .limit(fetch_limit)
            )
            .scalars()
            .all()
        )
        articles = [
            {col.name: getattr(row, col.name) for col in NewsArticle.__table__.columns}
            for row in rows
        ]

    return cap_per_ticker(articles, max_per_ticker, limit)
