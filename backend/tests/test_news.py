from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import event, func, select

from app.db import get_engine, session
from app.models import AppState, Base, JobRun, NewsArticle, UniverseTicker
from app.news import (
    _LOCK,
    MARKET_NEWS_TICKERS,
    NEWS_REFRESH_KEY,
    cap_per_ticker,
    get_newest_fetched_at,
    is_preferred_publisher,
    needs_news_refresh,
    parse_article,
    recent_articles,
    refresh_news_if_stale,
    run_news_refresh_if_due,
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


# --- needs_news_refresh --------------------------------------------------------------------


def test_needs_news_refresh_true_when_feed_empty_before_930():
    """Rule 1 (empty feed) beats the window gate — an empty feed must not stay blank until
    09:30 on a fresh deploy, the same reasoning needs_summary already follows for the
    briefing."""
    now_et = _et(8, 0)
    assert needs_news_refresh(None, None, now_et) is True


def test_needs_news_refresh_true_when_feed_empty_on_a_sunday():
    """The reason this isn't a bare reuse of needs_auto_refresh: an empty feed refreshes
    even on a day the universe sweep would never touch."""
    now_et = datetime(2026, 9, 20, 13, 0, tzinfo=ET)  # 2026-09-20 is a Sunday
    assert needs_news_refresh(None, None, now_et) is True


def test_needs_news_refresh_false_when_claimed_one_second_after_window_opened():
    now_et = _et(10, 0)
    last_claim_at = _utc(_et(9, 30) + timedelta(seconds=1))
    newest_fetched_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert needs_news_refresh(newest_fetched_at, last_claim_at, now_et) is False


def test_needs_news_refresh_true_when_claimed_one_second_before_window_opened():
    now_et = _et(10, 0)
    last_claim_at = _utc(_et(9, 30) - timedelta(seconds=1))
    newest_fetched_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert needs_news_refresh(newest_fetched_at, last_claim_at, now_et) is True


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


def test_parse_article_still_returns_a_row_for_a_non_preferred_publisher():
    """The publisher policy lives in the refresh loop, not in the parser (contract 0040) — a
    Zacks item is malformed-or-not exactly like any other; parse_article has no opinion on
    editorial preference."""
    row = parse_article(_raw_item("z1", provider={"displayName": "Zacks"}), "^GSPC", datetime.now(timezone.utc))
    assert row is not None
    assert row["publisher"] == "Zacks"


# --- is_preferred_publisher ------------------------------------------------------------------


def test_is_preferred_publisher_true_for_a_preferred_name():
    assert is_preferred_publisher("Reuters") is True


def test_is_preferred_publisher_false_for_a_demoted_name():
    assert is_preferred_publisher("Zacks") is False


def test_is_preferred_publisher_false_for_none():
    assert is_preferred_publisher(None) is False


def test_is_preferred_publisher_is_case_insensitive():
    assert is_preferred_publisher("reuters") is True
    assert is_preferred_publisher("REUTERS") is True


def test_is_preferred_publisher_does_not_substring_match(monkeypatch):
    monkeypatch.setattr("app.news.PREFERRED_PUBLISHERS", frozenset({"Benzinga"}))
    assert is_preferred_publisher("Benzinga") is True
    assert is_preferred_publisher("Benzinga Prediction Markets") is False


# --- refresh_news_if_stale: publisher filter at ingest ----------------------------------------


def test_refresh_stores_only_the_preferred_publishers_article(db_mode, monkeypatch):
    def fake_fetch(ticker):
        return [
            _raw_item("mt1", title="Broad market update", provider={"displayName": "MT Newswires"}),
            _raw_item("z1", title="Why XYZ outpaced the market today", provider={"displayName": "Zacks"}),
        ]

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)

    now_et = _et(9, 1)
    refresh_news_if_stale(["^GSPC"], _utc(now_et), now_et)

    with session() as db:
        ids = list(db.execute(select(NewsArticle.id)).scalars().all())
    assert ids == ["mt1"]


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


# --- run_news_refresh_if_due: gating, claim-first, and wiring to the fixed feed list -----------


def test_run_news_refresh_if_due_noop_when_window_already_claimed(db_mode, monkeypatch):
    _add_article("existing-1", fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    now_et = _et(10, 0)
    now_utc = _utc(now_et)
    with session() as db:
        db.add(AppState(key=NEWS_REFRESH_KEY, value_at=now_utc))

    def _fail_if_called(ticker):
        raise AssertionError("fetch_news_for must not be called when the window is claimed")

    monkeypatch.setattr("app.news.fetch_news_for", _fail_if_called)

    run_news_refresh_if_due(now_utc, now_et + timedelta(minutes=5))

    with session() as db:
        count = db.execute(select(func.count()).select_from(JobRun)).scalar()
    assert count == 0


def test_run_news_refresh_if_due_fetches_exactly_the_market_news_tickers(db_mode, monkeypatch):
    """The universe must never be consulted (contract 0040) — seed a fake "universe" with a
    completely different ticker set, so this fails loudly if run_news_refresh_if_due ever goes
    back to reading it instead of the fixed feed list."""
    with session() as db:
        db.add(UniverseTicker(ticker="AAPL", active=True))
        db.add(UniverseTicker(ticker="MSFT", active=True))

    called = []

    def fake_fetch(ticker):
        called.append(ticker)
        return []

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)

    now_et = _et(10, 0)
    run_news_refresh_if_due(_utc(now_et), now_et)

    assert called == list(MARKET_NEWS_TICKERS)


def test_run_news_refresh_if_due_writes_the_claim_before_the_fetch_even_if_it_raises(db_mode, monkeypatch):
    """Assert on stored state, not source order: a fetch stub that raises on the first feed
    must still leave app_state["news_refresh"] holding the new timestamp — proving the claim
    was written before the fetch ran, not after it finished."""
    _add_article("existing-1", fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc))

    def _raise(ticker):
        raise RuntimeError(f"boom: {ticker}")

    monkeypatch.setattr("app.news.fetch_news_for", _raise)

    now_et = _et(10, 0)
    now_utc = _utc(now_et)
    run_news_refresh_if_due(now_utc, now_et)

    with session() as db:
        row = db.get(AppState, NEWS_REFRESH_KEY)
        assert row is not None
        value_at = row.value_at if row.value_at.tzinfo is not None else row.value_at.replace(tzinfo=timezone.utc)
    assert value_at == now_utc


# --- _LOCK: one refresh at a time per process ---------------------------------------------------


def test_second_call_returns_without_fetching_while_the_lock_is_held(db_mode, monkeypatch):
    called = []
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: called.append(ticker) or [])

    assert _LOCK.acquire(blocking=False)
    try:
        now_et = _et(10, 0)
        run_news_refresh_if_due(_utc(now_et), now_et)
    finally:
        _LOCK.release()

    assert called == []


def test_lock_is_released_after_the_body_raises(db_mode, monkeypatch):
    """Force an exception from somewhere the per-ticker and briefing try/excepts inside
    refresh_news_if_stale do not shield, and confirm the lock is free again afterwards, proving
    the finally: block ran."""
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])
    monkeypatch.setattr(
        "app.news._prune_old_articles",
        lambda now_utc: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    now_et = _et(10, 0)
    with pytest.raises(RuntimeError, match="boom"):
        run_news_refresh_if_due(_utc(now_et), now_et)

    assert _LOCK.acquire(blocking=False)
    _LOCK.release()


# --- job_runs recording (contract 0044) ---------------------------------------------------------


def _latest_job_run() -> dict | None:
    with session() as db:
        row = db.execute(select(JobRun).order_by(JobRun.id.desc()).limit(1)).scalars().first()
        if row is None:
            return None
        return {col.name: getattr(row, col.name) for col in JobRun.__table__.columns}


def test_one_feed_raising_records_partial_with_that_feed_in_errors(db_mode, monkeypatch):
    """The other feeds must still be walked, and whatever they yielded still stored — a single
    bad feed must not zero out the whole run's counts."""

    def fake_fetch(ticker):
        if ticker == MARKET_NEWS_TICKERS[0]:
            raise RuntimeError("boom")
        return [_raw_item(f"{ticker}-1", provider={"displayName": "Reuters"})]

    monkeypatch.setattr("app.news.fetch_news_for", fake_fetch)
    monkeypatch.setattr("app.briefing.refresh_briefing", lambda *a, **k: None)

    now_et = _et(10, 0)
    run_news_refresh_if_due(_utc(now_et), now_et)

    run = _latest_job_run()
    assert run is not None
    assert run["job_name"] == "news_refresh"
    assert run["status"] == "partial"
    assert run["detail"]["errors"] == [MARKET_NEWS_TICKERS[0]]
    assert run["detail"]["feeds"] == len(MARKET_NEWS_TICKERS)
    assert run["detail"]["stored"] == len(MARKET_NEWS_TICKERS) - 1
    assert run["detail"]["briefing"] is True


def test_a_body_that_raises_records_failure_and_still_reraises(db_mode, monkeypatch):
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])
    monkeypatch.setattr(
        "app.news._prune_old_articles",
        lambda now_utc: (_ for _ in ()).throw(RuntimeError("boom")),
    )

    now_et = _et(10, 0)
    with pytest.raises(RuntimeError, match="boom"):
        run_news_refresh_if_due(_utc(now_et), now_et)

    run = _latest_job_run()
    assert run is not None
    assert run["job_name"] == "news_refresh"
    assert run["status"] == "failure"
    assert run["detail"]["error"]["type"] == "RuntimeError"
    assert "boom" in run["detail"]["error"]["message"]


def test_run_records_success_with_briefing_true_when_refresh_briefing_completes(db_mode, monkeypatch):
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])
    monkeypatch.setattr("app.briefing.refresh_briefing", lambda *a, **k: None)

    now_et = _et(10, 0)
    run_news_refresh_if_due(_utc(now_et), now_et)

    run = _latest_job_run()
    assert run is not None
    assert run["status"] == "success"
    assert run["detail"]["feeds"] == len(MARKET_NEWS_TICKERS)
    assert run["detail"]["stored"] == 0
    assert run["detail"]["errors"] == []
    assert run["detail"]["briefing"] is True


def test_run_records_briefing_false_when_refresh_briefing_raises(db_mode, monkeypatch):
    """briefing is best-effort (contract 0044): recorded as whether the call completed without
    raising, not whether it actually produced a new summary — refresh_briefing itself returns
    nothing and may legitimately no-op."""
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])
    monkeypatch.setattr(
        "app.briefing.refresh_briefing",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("gemini boom")),
    )

    now_et = _et(10, 0)
    run_news_refresh_if_due(_utc(now_et), now_et)  # must not raise — briefing failures are caught

    run = _latest_job_run()
    assert run is not None
    assert run["status"] == "success"  # no feed errors — only the briefing failed
    assert run["detail"]["briefing"] is False


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
