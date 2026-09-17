from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app.briefing import (
    BRIEFING_SENTENCES,
    PREFERRED_PUBLISHERS,
    SUMMARY_MIN_AGE_MINUTES,
    build_prompt,
    generate_briefing,
    latest_briefing,
    needs_summary,
    preferred_headlines,
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
    latest = now - timedelta(minutes=SUMMARY_MIN_AGE_MINUTES)
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


# --- build_prompt: voice and no-advice constraints, present in every branch --------------------


def test_build_prompt_cold_start_has_voice_and_no_advice_constraints():
    prompt = build_prompt(["- A headline (Reuters)"], None, None, _et(12))
    assert 'Never use "we"' in prompt
    assert "Describe, do not advise" in prompt


def test_build_prompt_same_day_has_voice_and_no_advice_constraints():
    previous_created_at = _et(9).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Yesterday's text", previous_created_at, _et(15))
    assert 'Never use "we"' in prompt
    assert "Describe, do not advise" in prompt


def test_build_prompt_prior_day_has_voice_and_no_advice_constraints():
    previous_created_at = _et(9, day=14).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Prior text", previous_created_at, _et(15, day=15))
    assert 'Never use "we"' in prompt
    assert "Describe, do not advise" in prompt


# --- build_prompt: both rewrite branches override the earlier briefing's style ------------------


def test_build_prompt_same_day_overrides_the_earlier_briefings_style():
    previous_created_at = _et(9).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Yesterday's text", previous_created_at, _et(15))
    assert "even where the earlier briefing does not" in prompt


def test_build_prompt_prior_day_overrides_the_earlier_briefings_style():
    previous_created_at = _et(9, day=14).astimezone(timezone.utc)
    prompt = build_prompt(["- A headline (Reuters)"], "Prior text", previous_created_at, _et(15, day=15))
    assert "even where the earlier briefing does not" in prompt


def test_build_prompt_cold_start_has_no_override_phrase():
    """There is no earlier briefing to override the style of on a cold start — the phrase
    would be nonsensical there and must not appear."""
    prompt = build_prompt(["- A headline (Reuters)"], None, None, _et(12))
    assert "even where the earlier briefing does not" not in prompt


# --- preferred_headlines -----------------------------------------------------------------------


def _article(article_id: str, publisher: str | None) -> dict:
    return {"id": article_id, "title": f"Title {article_id}", "publisher": publisher}


def test_preferred_headlines_puts_preferred_publishers_first():
    articles = [
        _article("z1", "Zacks"),
        _article("r1", "Reuters"),
        _article("z2", "Zacks"),
        _article("m1", "MT Newswires"),
    ]

    result = preferred_headlines(articles, limit=10)

    assert [a["id"] for a in result[:2]] == ["r1", "m1"]
    assert {a["id"] for a in result} == {"z1", "r1", "z2", "m1"}


def test_preferred_headlines_preserves_recency_order_within_each_group():
    articles = [
        _article("r1", "Reuters"),
        _article("z1", "Zacks"),
        _article("r2", "Reuters"),
        _article("z2", "Zacks"),
    ]

    result = preferred_headlines(articles, limit=10)

    assert [a["id"] for a in result] == ["r1", "r2", "z1", "z2"]


def test_preferred_headlines_tops_up_when_fewer_than_limit_preferred_exist():
    """A quiet wire day must still produce a full-length briefing — preference, not a
    filter."""
    articles = [_article("r1", "Reuters"), _article("r2", "Reuters")] + [
        _article(f"z{i}", "Zacks") for i in range(10)
    ]

    result = preferred_headlines(articles, limit=5)

    assert len(result) == 5
    assert [a["id"] for a in result[:2]] == ["r1", "r2"]
    assert all(a["id"].startswith("z") for a in result[2:])


def test_preferred_headlines_null_publisher_is_never_preferred():
    articles = [_article("n1", None), _article("r1", "Reuters")]

    result = preferred_headlines(articles, limit=10)

    assert [a["id"] for a in result] == ["r1", "n1"]


def test_preferred_headlines_does_not_substring_match(monkeypatch):
    """"Benzinga Prediction Markets" must not match a preferred "Benzinga" — those are
    different sources that happen to share a prefix."""
    monkeypatch.setattr("app.briefing.PREFERRED_PUBLISHERS", frozenset({"Benzinga"}))
    articles = [
        _article("bpm", "Benzinga Prediction Markets"),
        _article("b", "Benzinga"),
    ]

    result = preferred_headlines(articles, limit=10)

    assert [a["id"] for a in result] == ["b", "bpm"]


def test_preferred_publishers_excludes_the_demoted_high_volume_outlets():
    demoted = {
        "24/7 Wall St.",
        "Motley Fool",
        "Zacks",
        "GuruFocus.com",
        "Trefis",
        "Insider Monkey",
        "Simply Wall St.",
        "StockStory",
        "Stocktwits",
        "MarketBeat",
    }
    assert demoted.isdisjoint(PREFERRED_PUBLISHERS)


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
    # Comfortably past SUMMARY_MIN_AGE_MINUTES (so needs_summary actually says yes and this
    # test exercises the generation-failure path) but well under the 24h retention window.
    _add_summary("Existing briefing", created_at=now - timedelta(minutes=SUMMARY_MIN_AGE_MINUTES + 30))
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


def test_refresh_briefing_over_selects_then_prefers(db_mode, monkeypatch):
    """40 stored articles, 5 from a preferred publisher inserted *after* the other 35 (so
    recency order alone would put them last, not first). The prompt's headline block must
    still lead with the 5 preferred ones — proof that refresh_briefing over-selects past
    MAX_HEADLINES before preferred_headlines reorders, rather than preferring inside an
    already-truncated 20-headline window where most of the 5 might not even survive."""
    monkeypatch.setenv("GEMINI_KEY", "fake-key")
    now = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)

    for i in range(35):
        _add_article(f"z{i}", title=f"Zacks story {i}", publisher="Zacks")
    for i in range(5):
        _add_article(f"m{i}", title=f"MT Newswires story {i}", publisher="MT Newswires")

    captured = {}

    def fake_generate(prompt):
        captured["prompt"] = prompt
        return "A generated briefing."

    monkeypatch.setattr("app.briefing.generate_briefing", fake_generate)

    refresh_briefing(now, now.astimezone(ET), True)

    prompt = captured["prompt"]
    first_zacks_index = prompt.index("Zacks story")
    for i in range(5):
        assert prompt.index(f"MT Newswires story {i}") < first_zacks_index


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
    # Same margin as above: past the min-age floor so a refresh is actually due, but nowhere
    # near the 24h retention cutoff so this row must survive the prune.
    _add_summary(
        "Recent superseded briefing",
        created_at=now - timedelta(minutes=SUMMARY_MIN_AGE_MINUTES + 30),
    )
    _add_article("a1")

    monkeypatch.setattr("app.briefing.genai.Client", _fake_client_returning("A fresh briefing."))

    refresh_briefing(now, now.astimezone(ET), True)

    with session() as db:
        summaries = set(db.execute(select(NewsSummary.summary)).scalars().all())
    assert summaries == {"Recent superseded briefing", "A fresh briefing."}


# --- refresh_news_if_stale: the early-return bug this contract fixes ---------------------------


def test_refresh_news_if_stale_always_reaches_refresh_briefing_with_articles_refreshed_true(
    db_mode, monkeypatch
):
    """refresh_news_if_stale is unconditional as of contract 0037 — its own staleness gate
    (needs_refresh) was deleted; that decision now belongs entirely to
    run_news_refresh_if_due/needs_news_refresh, upstream of this function. Reaching this
    function at all means a refresh was already decided, so articles_refreshed is always True
    when it calls refresh_briefing. Assert on the call itself, not on reading the source."""
    monkeypatch.setattr("app.news.fetch_news_for", lambda ticker: [])

    calls = []
    monkeypatch.setattr("app.briefing.refresh_briefing", lambda *a: calls.append(a))

    now_et = _et(15, 0)
    now_utc = now_et.astimezone(timezone.utc)
    refresh_news_if_stale(["AAPL"], now_utc, now_et)

    assert calls == [(now_utc, now_et, True)]


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
