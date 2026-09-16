"""Universe-wide news: stored, not live. Contract 0030 measured `yf.Ticker(t).news` at
0.11-0.28s per ticker from Render — fine as a background task, unacceptable inside a launch
page render that Render already cold-starts at ~43s. needs_refresh/parse_article are pure —
no database, no clock, no network. The two impure functions, refresh_news_if_stale and
recent_articles, are where the database reads/writes and the yfinance calls live.

One blended feed, not one per ticker: `.news` is associated with a ticker, not about it
(contract 0030 — AAPL's top story was about a Canadian telecom), so a per-ticker feed would
claim more relevance than the data supports."""

import logging
from datetime import datetime, time, timedelta, timezone

import yfinance as yf
from sqlalchemy import delete, func, nullslast, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import is_enabled, session
from app.models import NewsArticle, UniverseTicker

logger = logging.getLogger(__name__)

NEWS_TTL_HOURS = 6
NEWS_EARLIEST_ET = time(9, 0)
NEWS_RETENTION_DAYS = 14


def needs_refresh(newest_fetched_at: datetime | None, now_utc: datetime, now_et: datetime) -> bool:
    """True when the feed is stale and we are allowed to refresh.

    Rule order matters: an empty table (newest_fetched_at is None) refreshes at any hour —
    the 09:00 gate exists to stop overnight re-fetching, not to leave a fresh deployment blank
    until morning. Only once that is ruled out does the 09:00 ET gate apply."""
    if newest_fetched_at is None:
        return True
    if now_et.time() < NEWS_EARLIEST_ET:
        return False
    return now_utc - newest_fetched_at >= timedelta(hours=NEWS_TTL_HOURS)


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


def active_universe_tickers() -> list[str]:
    """One bounded query — the active universe's ticker list. Deliberately does not go
    through app.universe.list_all(): that pulls fundamentals, bars and quotes and can trigger
    a live-quote fetch, none of which a news refresh needs."""
    if not is_enabled():
        return []
    with session() as db:
        return list(
            db.execute(
                select(UniverseTicker.ticker).where(UniverseTicker.active.is_(True))
            ).scalars().all()
        )


def fetch_news_for(ticker: str) -> list[dict]:
    """One yfinance call for one ticker's news feed."""
    return yf.Ticker(ticker).news


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


def refresh_news_if_stale(tickers: list[str], now_utc: datetime, now_et: datetime) -> None:
    """The impure composition: read the newest fetched_at, consult needs_refresh, and only
    then fetch. No-op with no database configured or an empty ticker list — that check happens
    before any fetch is attempted, same discipline as quotes.refresh_quotes_if_stale.

    Tickers are walked sequentially, never concurrently (contract 0013: a burst of
    simultaneous requests from one IP is what got Render's shared IP crumb-throttled). A
    failure on one ticker is caught and logged, not raised — the refresh continues with the
    rest, and a wipe is never issued: articles are only ever upserted or pruned by age, so a
    refresh where every ticker fails leaves every existing row exactly as it was."""
    if not is_enabled() or not tickers:
        return

    newest_fetched_at = get_newest_fetched_at()
    if not needs_refresh(newest_fetched_at, now_utc, now_et):
        return

    parsed_by_id: dict[str, dict] = {}
    for ticker in tickers:
        try:
            raw_items = fetch_news_for(ticker)
        except Exception:
            # Broad on purpose: one ticker's feed being unreachable must not abort the
            # refresh for the other nineteen. See report.
            logger.exception("app.news: fetch_news_for(%s) failed; skipping", ticker)
            continue

        for raw in raw_items:
            parsed = parse_article(raw, ticker, now_utc)
            if parsed is None:
                continue
            parsed_by_id.setdefault(parsed["id"], parsed)

    if parsed_by_id:
        _upsert_articles(list(parsed_by_id.values()))

    _prune_old_articles(now_utc)


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
