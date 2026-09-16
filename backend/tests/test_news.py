from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, select

from app.db import get_engine, session
from app.models import Base, NewsArticle, UniverseTicker
from app.news import (
    active_universe_tickers,
    cap_per_ticker,
    get_newest_fetched_at,
    needs_refresh,
    parse_article,
    recent_articles,
    refresh_news_if_stale,
)

ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_news.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _et(hour: int, minute: int = 0, day: int = 15) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=ET)


def _utc(dt_et: datetime) -> datetime:
    return dt_et.astimezone(timezone.utc)


def _add_article(
    article_id: str,
    pub_date: datetime | None = None,
    fetched_at: datetime | None = None,
    source_ticker: str = "AAPL",
) -> None:
    with session() as db:
        db.add(
            NewsArticle(
                id=article_id,
                title=f"Title {article_id}",
                pub_date=pub_date,
                source_ticker=source_ticker,
                fetched_at=fetched_at or datetime(2026, 1, 1, tzinfo=timezone.utc),
            )
        )


def _raw_item(article_id: str, title: str = "Some headline", **content_overrides) -> dict:
    content = {
        "title": title,
        "summary": "A summary.",
        "provider": {"displayName": "Reuters"},
        "canonicalUrl": {"url": "https://example.com/a"},
        "pubDate": "2026-09-15T12:00:00Z",
    }
    content.update(content_overrides)
    return {"id": article_id, "content": content}


# --- needs_refresh ------------------------------------------------------------------------


def test_needs_refresh_true_when_table_empty_even_before_earliest_hour():
    """Rule 1 beats rule 2: an empty table refreshes at any hour."""
    now_et = _et(3, 0)
    assert needs_refresh(None, _utc(now_et), now_et) is True


def test_needs_refresh_false_before_earliest_hour_when_stale():
    now_et = _et(8, 59)
    newest = _utc(now_et) - timedelta(hours=7)
    assert needs_refresh(newest, _utc(now_et), now_et) is False


def test_needs_refresh_true_just_after_earliest_hour_when_stale():
    now_et = _et(9, 1)
    newest = _utc(now_et) - timedelta(hours=7)
    assert needs_refresh(newest, _utc(now_et), now_et) is True


def test_needs_refresh_false_when_fresh_after_earliest_hour():
    now_et = _et(15, 0)
    newest = _utc(now_et) - timedelta(hours=1)
    assert needs_refresh(newest, _utc(now_et), now_et) is False


def test_needs_refresh_true_at_exactly_ttl_hours_old():
    now_et = _et(10, 0)
    newest = _utc(now_et) - timedelta(hours=6)
    assert needs_refresh(newest, _utc(now_et), now_et) is True


# --- parse_article --------------------------------------------------------------------------


def test_parse_article_well_formed():
    fetched_at = datetime(2026, 9, 15, tzinfo=timezone.utc)
    row = parse_article(_raw_item("abc123"), "AAPL", fetched_at)

    assert row == {
        "id": "abc123",
        "title": "Some headline",
        "summary": "A summary.",
        "publisher": "Reuters",
        "url": "https://example.com/a",
        "thumbnail_url": None,
        "pub_date": datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc),
        "source_ticker": "AAPL",
        "fetched_at": fetched_at,
    }


def test_parse_article_missing_id_returns_none():
    raw = {"content": {"title": "Headline"}}
    assert parse_article(raw, "AAPL", datetime.now(timezone.utc)) is None


def test_parse_article_missing_title_returns_none():
    raw = {"id": "abc123", "content": {}}
    assert parse_article(raw, "AAPL", datetime.now(timezone.utc)) is None


def test_parse_article_missing_content_returns_none():
    raw = {"id": "abc123"}
    assert parse_article(raw, "AAPL", datetime.now(timezone.utc)) is None


def test_parse_article_provider_as_string_yields_null_publisher():
    row = parse_article(_raw_item("abc123", provider="Reuters"), "AAPL", datetime.now(timezone.utc))
    assert row is not None
    assert row["publisher"] is None


def test_parse_article_missing_canonical_url_yields_null_url():
    raw = _raw_item("abc123")
    del raw["content"]["canonicalUrl"]
    row = parse_article(raw, "AAPL", datetime.now(timezone.utc))
    assert row is not None
    assert row["url"] is None


def test_parse_article_unparseable_pub_date_yields_null_not_an_exception():
    row = parse_article(_raw_item("abc123", pubDate="not-a-date"), "AAPL", datetime.now(timezone.utc))
    assert row is not None
    assert row["pub_date"] is None


def test_parse_article_falls_back_to_description_when_summary_absent():
    raw = _raw_item("abc123")
    del raw["content"]["summary"]
    raw["content"]["description"] = "The description."
    row = parse_article(raw, "AAPL", datetime.now(timezone.utc))
    assert row is not None
    assert row["summary"] == "The description."


# --- refresh_news_if_stale: failure isolation and no-wipe -----------------------------------


def test_refresh_where_every_ticker_raises_leaves_existing_rows_untouched(db_mode, monkeypatch):
    _add_article("existing-1", fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

    def _raise(ticker):
        raise RuntimeError(f"boom: {ticker}")

    monkeypatch.setattr("app.news.fetch_news_for", _raise)

    now_et = _et(9, 1)
    refresh_news_if_stale(["AAPL", "MSFT"], _utc(now_et), now_et)

    with session() as db:
        ids = list(db.execute(select(NewsArticle.id)).scalars().all())
    assert ids == ["existing-1"]


def test_refresh_where_one_ticker_raises_stores_the_successful_ones(db_mode, monkeypatch):
    def fake_fetch(ticker):
        if ticker == "AAPL":
            raise RuntimeError("boom")
        return [_raw_item("msft-1", title="MSFT news")]

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)

    now_et = _et(9, 1)
    refresh_news_if_stale(["AAPL", "MSFT"], _utc(now_et), now_et)

    with session() as db:
        rows = [(r.id, r.source_ticker) for r in db.execute(select(NewsArticle)).scalars().all()]
    assert rows == [("msft-1", "MSFT")]


def test_refresh_skips_entirely_when_not_stale(db_mode, monkeypatch):
    _add_article("existing-1", fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

    def _fail_if_called(ticker):
        raise AssertionError("fetch_news_for must not be called when not stale")

    monkeypatch.setattr("app.news.fetch_news_for", _fail_if_called)

    now_et = _et(8, 0)  # before the 09:00 gate, and the table is non-empty
    refresh_news_if_stale(["AAPL"], _utc(now_et), now_et)  # must not raise


# --- dedup across tickers --------------------------------------------------------------------


def test_same_article_id_from_two_tickers_yields_one_row_with_first_source(db_mode, monkeypatch):
    def fake_fetch(ticker):
        return [_raw_item("shared-1", title=f"From {ticker}")]

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)

    now_et = _et(9, 1)
    refresh_news_if_stale(["AAPL", "MSFT"], _utc(now_et), now_et)

    with session() as db:
        rows = [(r.id, r.source_ticker) for r in db.execute(select(NewsArticle)).scalars().all()]
    assert rows == [("shared-1", "AAPL")]


def test_conflict_on_a_later_refresh_keeps_the_original_source_ticker(db_mode, monkeypatch):
    _add_article(
        "shared-1",
        pub_date=datetime(2026, 9, 15, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        source_ticker="AAPL",
    )

    def fake_fetch(ticker):
        return [_raw_item("shared-1", title="Updated headline")]

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)

    now_et = _et(9, 1)
    refresh_news_if_stale(["MSFT"], _utc(now_et), now_et)

    with session() as db:
        rows = [(r.id, r.source_ticker, r.title) for r in db.execute(select(NewsArticle)).scalars().all()]
    assert rows == [("shared-1", "AAPL", "Updated headline")]


# --- pruning ----------------------------------------------------------------------------------


def test_refresh_prunes_articles_older_than_14_days(db_mode, monkeypatch):
    now_et = _et(9, 1)
    now_utc = _utc(now_et)
    _add_article("old-1", pub_date=now_utc - timedelta(days=15))
    _add_article("recent-1", pub_date=now_utc - timedelta(days=1))

    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])

    refresh_news_if_stale(["AAPL"], now_utc, now_et)

    with session() as db:
        ids = set(db.execute(select(NewsArticle.id)).scalars().all())
    assert ids == {"recent-1"}


# --- cap_per_ticker ---------------------------------------------------------------------------


def _article(article_id: str, source_ticker: str | None) -> dict:
    return {"id": article_id, "source_ticker": source_ticker}


def test_cap_per_ticker_limits_a_dominant_ticker():
    articles = [_article(f"g{i}", "^GSPC") for i in range(8)] + [
        _article(f"o{i}", "OTHER") for i in range(2)
    ]

    result = cap_per_ticker(articles, max_per_ticker=2, limit=10)

    gspc_count = sum(1 for a in result if a["source_ticker"] == "^GSPC")
    assert gspc_count <= 2


def test_cap_per_ticker_preserves_input_order():
    articles = [
        _article("a1", "AAPL"),
        _article("m1", "MSFT"),
        _article("a2", "AAPL"),
        _article("m2", "MSFT"),
        _article("a3", "AAPL"),
    ]

    result = cap_per_ticker(articles, max_per_ticker=2, limit=10)

    assert [a["id"] for a in result] == ["a1", "m1", "a2", "m2"]


def test_cap_per_ticker_zero_disables_the_cap():
    articles = [_article(f"g{i}", "^GSPC") for i in range(8)]

    result = cap_per_ticker(articles, max_per_ticker=0, limit=5)

    assert [a["id"] for a in result] == [f"g{i}" for i in range(5)]


def test_cap_per_ticker_null_source_tickers_are_never_capped_against_each_other():
    articles = [_article(f"n{i}", None) for i in range(5)]

    result = cap_per_ticker(articles, max_per_ticker=1, limit=10)

    assert len(result) == 5


def test_cap_per_ticker_stops_at_limit():
    articles = [_article(f"a{i}", "AAPL") for i in range(3)] + [
        _article(f"m{i}", "MSFT") for i in range(3)
    ]

    result = cap_per_ticker(articles, max_per_ticker=5, limit=4)

    assert len(result) == 4


# --- recent_articles with max_per_ticker ---------------------------------------------------------


def test_recent_articles_applies_cap_per_ticker(db_mode):
    for i in range(8):
        _add_article(f"gspc{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc), source_ticker="^GSPC")
    for i in range(3):
        _add_article(f"other{i}", pub_date=datetime(2026, 9, 20 + i, tzinfo=timezone.utc), source_ticker="OTHER")

    rows = recent_articles(10, max_per_ticker=2)

    gspc_count = sum(1 for row in rows if row["source_ticker"] == "^GSPC")
    assert gspc_count <= 2


def test_recent_articles_default_max_per_ticker_is_uncapped(db_mode):
    for i in range(5):
        _add_article(f"gspc{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc), source_ticker="^GSPC")

    rows = recent_articles(5)

    assert len(rows) == 5


# --- active_universe_tickers ------------------------------------------------------------------


def test_active_universe_tickers_excludes_inactive(db_mode):
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=True))
        db.add(UniverseTicker(ticker="OLD", active=False))

    assert active_universe_tickers() == ["AAPL"]


# --- recent_articles ---------------------------------------------------------------------------


def test_recent_articles_orders_newest_first(db_mode):
    _add_article("older", pub_date=datetime(2026, 9, 1, tzinfo=timezone.utc))
    _add_article("newer", pub_date=datetime(2026, 9, 10, tzinfo=timezone.utc))

    rows = recent_articles(10)

    assert [row["id"] for row in rows] == ["newer", "older"]


def test_recent_articles_respects_limit(db_mode):
    for i in range(5):
        _add_article(f"a{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc))

    rows = recent_articles(2)

    assert len(rows) == 2


def test_recent_articles_query_count_does_not_scale_with_article_count(db_mode):
    def query_count() -> int:
        count = {"n": 0}

        def on_execute(conn, cursor, statement, parameters, context, executemany):
            count["n"] += 1

        event.listen(db_mode, "before_cursor_execute", on_execute)
        try:
            recent_articles(30)
        finally:
            event.remove(db_mode, "before_cursor_execute", on_execute)
        return count["n"]

    _add_article("a1", pub_date=datetime(2026, 9, 1, tzinfo=timezone.utc))
    _add_article("a2", pub_date=datetime(2026, 9, 2, tzinfo=timezone.utc))
    count_at_2 = query_count()

    for i in range(8):
        _add_article(f"b{i}", pub_date=datetime(2026, 9, 3 + i, tzinfo=timezone.utc))
    count_at_10 = query_count()

    assert count_at_2 == count_at_10


# --- get_newest_fetched_at ----------------------------------------------------------------------


def test_get_newest_fetched_at_none_when_empty(db_mode):
    assert get_newest_fetched_at() is None


def test_get_newest_fetched_at_returns_the_max(db_mode):
    _add_article("a1", fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    _add_article("a2", fetched_at=datetime(2026, 6, 1, tzinfo=timezone.utc))

    assert get_newest_fetched_at() == datetime(2026, 6, 1, tzinfo=timezone.utc)
