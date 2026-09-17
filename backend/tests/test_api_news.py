from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, NewsArticle, NewsSummary
from app.news import recent_articles as _real_recent_articles


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_news.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _add_article(article_id: str, pub_date: datetime | None, source_ticker: str = "AAPL") -> None:
    with session() as db:
        db.add(
            NewsArticle(
                id=article_id,
                title=f"Title {article_id}",
                pub_date=pub_date,
                source_ticker=source_ticker,
                fetched_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
            )
        )


def test_get_news_returns_empty_shape_on_empty_table(db_mode, client):
    response = client.get("/news")
    assert response.status_code == 200
    assert response.json() == {"articles": [], "as_of": None, "summary": None}


def test_get_news_returns_stored_articles_newest_first(db_mode, client):
    _add_article("older", pub_date=datetime(2026, 9, 1, tzinfo=timezone.utc))
    _add_article("newer", pub_date=datetime(2026, 9, 10, tzinfo=timezone.utc))

    response = client.get("/news")
    assert response.status_code == 200
    body = response.json()
    assert [a["id"] for a in body["articles"]] == ["newer", "older"]
    assert body["as_of"] is not None


def test_get_news_limit_clamps_high_value_to_100(db_mode, client):
    for i in range(3):
        _add_article(f"a{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc))

    response = client.get("/news?limit=500")
    assert response.status_code == 200
    assert len(response.json()["articles"]) == 3  # only 3 exist; clamp just proves no 422


def test_get_news_limit_clamps_low_value_to_1(db_mode, client):
    _add_article("a1", pub_date=datetime(2026, 9, 1, tzinfo=timezone.utc))
    _add_article("a2", pub_date=datetime(2026, 9, 2, tzinfo=timezone.utc))

    response = client.get("/news?limit=0")
    assert response.status_code == 200
    assert len(response.json()["articles"]) == 1


def test_get_news_max_per_ticker_caps_articles_per_source(db_mode, client):
    for i in range(5):
        _add_article(f"gspc{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc), source_ticker="^GSPC")

    response = client.get("/news?max_per_ticker=2")
    assert response.status_code == 200
    articles = response.json()["articles"]
    assert sum(1 for a in articles if a["source_ticker"] == "^GSPC") <= 2


def test_get_news_omitting_max_per_ticker_matches_0031_behavior(db_mode, client):
    for i in range(5):
        _add_article(f"gspc{i}", pub_date=datetime(2026, 9, 1 + i, tzinfo=timezone.utc), source_ticker="^GSPC")

    response = client.get("/news")
    assert response.status_code == 200
    articles = response.json()["articles"]
    assert len(articles) == 5  # uncapped — every article from the one ticker comes back


def test_get_news_max_per_ticker_high_value_clamps_to_50(db_mode, client, monkeypatch):
    captured = {}

    def spy(limit, max_per_ticker=0):
        captured["max_per_ticker"] = max_per_ticker
        return _real_recent_articles(limit, max_per_ticker)

    monkeypatch.setattr("app.routers.news.recent_articles", spy)

    response = client.get("/news?max_per_ticker=999")
    assert response.status_code == 200
    assert captured["max_per_ticker"] == 50


def test_get_news_max_per_ticker_negative_value_clamps_to_0(db_mode, client, monkeypatch):
    captured = {}

    def spy(limit, max_per_ticker=0):
        captured["max_per_ticker"] = max_per_ticker
        return _real_recent_articles(limit, max_per_ticker)

    monkeypatch.setattr("app.routers.news.recent_articles", spy)

    response = client.get("/news?max_per_ticker=-1")
    assert response.status_code == 200
    assert captured["max_per_ticker"] == 0


def test_get_news_summary_null_when_gemini_key_unset(db_mode, client, monkeypatch):
    """The state Render is in until Gunnar sets GEMINI_KEY: articles work, no summary was ever
    generated, and the endpoint still returns 200 rather than erroring."""
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    _add_article("a1", pub_date=datetime(2026, 9, 15, tzinfo=timezone.utc))

    response = client.get("/news")
    assert response.status_code == 200
    body = response.json()
    assert body["summary"] is None
    assert len(body["articles"]) == 1


def test_get_news_returns_the_stored_summary_when_present(db_mode, client):
    with session() as db:
        db.add(
            NewsSummary(
                summary="Markets were mixed today.",
                model="gemini-3.1-flash-lite",
                article_count=12,
                created_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
            )
        )

    response = client.get("/news")
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["text"] == "Markets were mixed today."
    assert summary["model"] == "gemini-3.1-flash-lite"
    assert summary["article_count"] == 12


def test_get_news_degraded_mode_returns_503(client):
    assert client.get("/news").status_code == 503


def test_get_news_never_schedules_a_background_task(db_mode, client, monkeypatch):
    """GET /news is a pure read as of contract 0037 — refreshing news and the briefing moved
    to run_news_refresh_if_due, scheduled from GET /universe/strip instead. Prove the old
    scheduling path is actually gone rather than just unused: app.news.run_news_refresh_if_due
    must not be called as a side effect of hitting this endpoint."""
    calls = []
    monkeypatch.setattr(
        "app.news.run_news_refresh_if_due",
        lambda now_utc, now_et: calls.append((now_utc, now_et)),
    )

    response = client.get("/news")
    assert response.status_code == 200
    assert calls == []
