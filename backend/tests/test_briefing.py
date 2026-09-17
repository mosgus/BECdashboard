from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.briefing import (
    BRIEFING_SENTENCES,
    build_prompt,
    generate_briefing,
    latest_briefing,
    needs_summary,
    refresh_briefing,
)
from app.db import get_engine, session
from app.models import Base, NewsArticle, NewsSummary
from app.news import refresh_news_if_stale

ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_briefing.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _et(hour: int, minute: int = 0, day: int = 15) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=ET)


def _add_summary(text: str, created_at: datetime, model: str = "gemini-3.1-flash-lite") -> None:
    with session() as db:
        db.add(NewsSummary(summary=text, model=model, article_count=5, created_at=created_at))


def _add_article(article_id: str, title: str = "Headline", publisher: str | None = "Reuters") -> None:
    with session() as db:
        db.add(
            NewsArticle(
                id=article_id,
                title=title,
                publisher=publisher,
                pub_date=datetime(2026, 9, 15, tzinfo=timezone.utc),
                fetched_at=datetime(2026, 9, 15, tzinfo=timezone.utc),
            )
        )


# --- needs_summary: all four (latest_created_at, articles_refreshed) combinations -----------


def test_needs_summary_true_when_no_prior_summary_and_not_refreshed():
    now = datetime(2026, 9, 15, tzinfo=timezone.utc)
    assert needs_summary(None, now, False) is True


def test_needs_summary_true_when_no_prior_summary_and_refreshed():
    now = datetime(2026, 9, 15, tzinfo=timezone.utc)
    assert needs_summary(None, now, True) is True


def test_needs_summary_false_when_old_enough_but_articles_not_refreshed():
    """The bug this contract exists to fix: before it, a 2-hour-old summary with articles
    fresh (not refreshed) still regenerated on every page load past the 30-minute floor,
    spending a Gemini call on unchanged headlines."""
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    latest = now - timedelta(hours=2)
    assert needs_summary(latest, now, False) is False


def test_needs_summary_true_when_old_enough_and_refreshed():
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    latest = now - timedelta(hours=2)
    assert needs_summary(latest, now, True) is True


def test_needs_summary_false_when_written_recently_even_if_refreshed():
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    latest = now - timedelta(minutes=10)
    assert needs_summary(latest, now, True) is False


def test_needs_summary_true_at_exactly_the_floor_when_refreshed():
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    latest = now - timedelta(minutes=30)
    assert needs_summary(latest, now, True) is True


# --- build_prompt: the three-way branch -----------------------------------------------------


def test_build_prompt_cold_start_has_no_prior_briefing_reference():
    prompt = build_prompt(["- A headline (Reuters)"], None, None, _et(12))
    assert "from scratch" in prompt
    assert "Earlier briefing" not in prompt


def test_build_prompt_same_day_rewrites_in_place():
    previous_created_at = _et(9).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Yesterday's text", previous_created_at, _et(15))
    assert "Rewrite the briefing" in prompt


def test_build_prompt_prior_day_opens_with_the_shift():
    previous_created_at = _et(9, day=14).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Prior text", previous_created_at, _et(15, day=15))
    assert "how sentiment or the key themes have moved" in prompt


def test_build_prompt_respects_sentence_count_constant():
    prompt = build_prompt(["- A headline (Reuters)"], None, None, _et(12))
    assert f"{BRIEFING_SENTENCES} sentences maximum" in prompt


def test_build_prompt_forbids_markdown():
    prompt = build_prompt(["- A headline (Reuters)"], None, None, _et(12))
    assert "no bullet points, no headers, no markdown" in prompt


# --- build_prompt: ET, not UTC, decides "same day" --------------------------------------------


def test_build_prompt_same_day_decision_uses_et_not_utc():
    """A previous summary at 2026-09-15T23:30Z is 19:30 ET on the 15th — same ET day as a
    now_et of 22:00 on the 15th. A UTC-date comparison would already agree here (both Sept 15
    in UTC too), so this case alone would not catch a UTC-based bug."""
    previous_created_at = datetime(2026, 9, 15, 23, 30, tzinfo=timezone.utc)
    now_et = _et(22, day=15)
    prompt = build_prompt(["- headline"], "Earlier text", previous_created_at, now_et)
    assert "Rewrite the briefing" in prompt


def test_build_prompt_same_day_decision_across_midnight_utc():
    """The case that actually distinguishes ET from UTC: 2026-09-16T01:00Z is 21:00 ET on the
    15th — still the same ET day as a now_et of 22:00 on the 15th — but a naive UTC .date()
    comparison would see September 16 and wrongly take the prior-day branch."""
    previous_created_at = datetime(2026, 9, 16, 1, 0, tzinfo=timezone.utc)
    now_et = _et(22, day=15)
    prompt = build_prompt(["- headline"], "Earlier text", previous_created_at, now_et)
    assert "Rewrite the briefing" in prompt


# --- generate_briefing: failure and empty response ---------------------------------------------


def test_generate_briefing_returns_none_on_exception(monkeypatch):
    class _RaisingModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("quota exceeded")

    class _RaisingClient:
        def __init__(self, api_key):
            self.models = _RaisingModels()

    monkeypatch.setattr("app.briefing.genai.Client", _RaisingClient)
    assert generate_briefing("a prompt") is None


def test_generate_briefing_returns_none_on_empty_text(monkeypatch):
    class _Response:
        text = "   "

    class _EmptyModels:
        def generate_content(self, **kwargs):
            return _Response()

    class _EmptyClient:
        def __init__(self, api_key):
            self.models = _EmptyModels()

    monkeypatch.setattr("app.briefing.genai.Client", _EmptyClient)
    assert generate_briefing("a prompt") is None


def _fake_client_returning(text: str):
    class _Response:
        pass

    response = _Response()
    response.text = text

    class _Models:
        def generate_content(self, **kwargs):
            return response

    class _Client:
        def __init__(self, api_key):
            self.models = _Models()

    return _Client


# --- refresh_briefing: no key, no articles, staleness gate -------------------------------------


def test_refresh_briefing_noop_without_gemini_key(db_mode, monkeypatch):
    monkeypatch.delenv("GEMINI_KEY", raising=False)
    _add_article("a1")

    refresh_briefing(datetime.now(timezone.utc), datetime.now(ET), True)

    assert latest_briefing() is None


def test_refresh_briefing_noop_when_no_articles_stored(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    monkeypatch.setattr("app.briefing.genai.Client", _fake_client_returning("Should not be called"))

    refresh_briefing(datetime.now(timezone.utc), datetime.now(ET), True)

    assert latest_briefing() is None


def test_refresh_briefing_skips_when_summary_is_recent(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_summary("Existing briefing", created_at=now - timedelta(minutes=5))
    _add_article("a1")

    def _fail_if_called(**kwargs):
        raise AssertionError("generate_content must not be called when not stale")

    monkeypatch.setattr(
        "app.briefing.genai.Client",
        lambda api_key: type("C", (), {"models": type("M", (), {"generate_content": staticmethod(_fail_if_called)})()})(),
    )

    refresh_briefing(now, now.astimezone(ET), True)

    latest = latest_briefing()
    assert latest["summary"] == "Existing briefing"


# --- refresh_briefing: failed generation writes nothing, deletes nothing -----------------------


def test_refresh_briefing_failed_generation_leaves_existing_row_untouched(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_summary("Existing briefing", created_at=now - timedelta(hours=1))
    _add_article("a1")

    class _RaisingModels:
        def generate_content(self, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        "app.briefing.genai.Client",
        lambda api_key: type("C", (), {"models": _RaisingModels()})(),
    )

    refresh_briefing(now, now.astimezone(ET), True)

    with session() as db:
        summaries = list(db.execute(select(NewsSummary.summary)).scalars().all())
    assert summaries == ["Existing briefing"]


# --- refresh_briefing: successful generation, insert, and retention prune ----------------------


def test_refresh_briefing_inserts_a_new_row_on_success(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_article("a1", title="Fed holds rates steady", publisher="Reuters")

    monkeypatch.setattr("app.briefing.genai.Client", _fake_client_returning("A fresh briefing."))

    refresh_briefing(now, now.astimezone(ET), True)

    latest = latest_briefing()
    assert latest is not None
    assert latest["summary"] == "A fresh briefing."
    assert latest["article_count"] == 1


def test_refresh_briefing_prune_excludes_the_just_inserted_row(db_mode, monkeypatch):
    """Both an old superseded row and the brand-new row exist after a successful refresh; the
    prune must delete the old one (past SUMMARY_RETENTION_HOURS) but never the new one, even
    though the new row is inserted first and then the same prune pass runs immediately after."""
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_summary("Ancient briefing", created_at=now - timedelta(hours=25))
    _add_article("a1")

    monkeypatch.setattr("app.briefing.genai.Client", _fake_client_returning("A fresh briefing."))

    refresh_briefing(now, now.astimezone(ET), True)

    with session() as db:
        summaries = set(db.execute(select(NewsSummary.summary)).scalars().all())
    assert summaries == {"A fresh briefing."}


def test_refresh_briefing_prune_keeps_a_superseded_row_under_the_retention_window(db_mode, monkeypatch):
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_summary("Recent superseded briefing", created_at=now - timedelta(hours=1))
    _add_article("a1")

    monkeypatch.setattr("app.briefing.genai.Client", _fake_client_returning("A fresh briefing."))

    refresh_briefing(now, now.astimezone(ET), True)

    with session() as db:
        summaries = set(db.execute(select(NewsSummary.summary)).scalars().all())
    assert summaries == {"Recent superseded briefing", "A fresh briefing."}


# --- refresh_news_if_stale: the early-return bug this contract fixes ---------------------------


def test_refresh_news_if_stale_reaches_refresh_briefing_when_articles_are_not_stale(
    db_mode, monkeypatch
):
    """Before this contract, refresh_briefing sat after refresh_news_if_stale's early return
    for "articles are already fresh", so it was unreachable whenever needs_refresh was False —
    exactly the state a newly-set GEMINI_KEY finds itself in for up to NEWS_TTL_HOURS. Assert
    on the call itself (a spy on app.briefing.refresh_briefing), not on reading the source."""
    monkeypatch.setattr("app.news.needs_refresh", lambda *a, **k: False)

    calls = []
    monkeypatch.setattr("app.briefing.refresh_briefing", lambda *a: calls.append(a))

    now_et = _et(15, 0)
    now_utc = now_et.astimezone(timezone.utc)
    refresh_news_if_stale(["AAPL"], now_utc, now_et)

    assert calls == [(now_utc, now_et, False)]


# --- latest_briefing ---------------------------------------------------------------------------


def test_latest_briefing_none_when_no_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert latest_briefing() is None


def test_latest_briefing_none_when_table_empty(db_mode):
    assert latest_briefing() is None


def test_latest_briefing_returns_the_newest_row(db_mode):
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
    _add_summary("Older", created_at=now - timedelta(hours=2))
    _add_summary("Newer", created_at=now - timedelta(minutes=1))

    latest = latest_briefing()
    assert latest["summary"] == "Newer"
