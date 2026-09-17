"""AI market briefing: a short Gemini-written summary over the currently stored headlines,
regenerated whenever the article feed itself refreshes rather than on its own schedule — the
summary is a function of the headlines, so it only needs to change when they do (contract
0031's ~09:00/15:00/21:00 ET refresh cadence). needs_summary/build_prompt are pure — no
database, no clock, no network. generate_briefing/refresh_briefing/latest_briefing are the
impure layer where the database reads/writes and the one Gemini call live.

Ported structure, not prompt: `reference files/news_section_reference/news_summarizer.py`'s
three-way continuity branch (cold start / same-day rewrite / prior-day catch-up) is the one
idea worth keeping. Its actual prompt text is TCM.io's real-estate-PE persona and is not
reused — Blue Eagle's universe is equities, sector ETFs and three indices."""

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from google import genai
from google.genai import types
from sqlalchemy import delete, select

from app.config import Settings
from app.db import is_enabled, session
from app.models import NewsSummary
from app.news import recent_articles

logger = logging.getLogger(__name__)

BRIEFING_SENTENCES = 8
SUMMARY_MIN_AGE_MINUTES = 90
SUMMARY_RETENTION_HOURS = 24
MAX_HEADLINES = 20

_ET = ZoneInfo("America/New_York")

_FOCUS = (
    "Write an impartial summary of the day's financial news for a market dashboard — not "
    "advice for any particular investor or portfolio. Cover index moves, sector rotation, "
    "interest rates, macro data, and the themes driving them. Mention an individual company "
    "only when its news moves a sector or the wider market.\n\n"
    "Constraints:\n"
    "- Third person only. Never use \"we\", \"our\", \"us\", \"I\", \"my\", \"you\", or \"your\".\n"
    "- Describe, do not advise: no recommendations, no \"investors should\", and no language "
    "about positioning, exposure, or risk management.\n"
    f"- {BRIEFING_SENTENCES} sentences maximum.\n"
    "- Plain sentences only — no bullet points, no headers, no markdown."
)


def needs_summary(
    latest_created_at: datetime | None,
    now_utc: datetime,
    articles_refreshed: bool,
) -> bool:
    """True when no summary exists yet, regardless of whether articles just refreshed — same
    shape as the news feed's "an empty table refreshes at any hour". Otherwise, True only when
    articles actually moved *and* the last summary is at least SUMMARY_MIN_AGE_MINUTES old.

    The `articles_refreshed` conjunct is what keeps this from becoming an independent
    30-minute schedule of its own: without it, any page load more than 30 minutes after the
    last briefing would spend a Gemini call rewriting headlines that have not changed. The age
    floor itself absorbs the known concurrent-refresh race (REBUILD.md)."""
    if latest_created_at is None:
        return True
    return articles_refreshed and now_utc - latest_created_at >= timedelta(
        minutes=SUMMARY_MIN_AGE_MINUTES
    )


_STYLE_OVERRIDE = "Follow the constraints above even where the earlier briefing does not."


def build_prompt(
    headlines: list[str],
    previous_summary: str | None,
    previous_created_at: datetime | None,
    now_et: datetime,
) -> str:
    """The reference's three-way continuity branch, dates compared in Eastern time rather than
    UTC — the reference read the wall clock in UTC and took its date, which flips "today" at
    8pm ET and is wrong for a US market briefing. `previous_created_at` is converted to ET
    before `.date()` so a timestamp like 2026-09-16T01:00Z (21:00 ET on the 15th) still counts
    as the same ET day as a `now_et` of, say, 22:00 on the 15th.

    `_FOCUS` is placed last in every branch, immediately before the "Briefing:" cue — not
    interpolated mid-paragraph — so the constraints are the last thing the model reads before
    generating, not a buried aside (contract 0039: a mid-paragraph instruction was already
    present and was still being ignored). The two rewrite branches additionally restate
    `_STYLE_OVERRIDE` right after `_FOCUS`: handing the model an earlier briefing that already
    violates the constraints (e.g. first-person voice) otherwise lets a "rewrite this" task
    inherit that style regardless of the instruction, since the reference text it is revising
    is itself the counter-example."""
    headline_block = "\n".join(headlines[:MAX_HEADLINES])

    if previous_summary is None or previous_created_at is None:
        return (
            "Write a market briefing from scratch using the headlines below.\n\n"
            f"Headlines:\n{headline_block}\n\n"
            f"{_FOCUS}\n\nBriefing:"
        )

    if previous_created_at.astimezone(_ET).date() == now_et.date():
        return (
            "Below is an earlier briefing from today, followed by the latest headlines. "
            "Rewrite the briefing to reflect what has shifted or newly emerged since it was "
            "written — drop anything no longer relevant, and add only what meaningfully "
            "changes the picture.\n\n"
            f"Earlier briefing from today:\n{previous_summary}\n\n"
            f"Latest headlines:\n{headline_block}\n\n"
            f"{_FOCUS}\n{_STYLE_OVERRIDE}\n\nUpdated briefing:"
        )

    return (
        "Below is the market briefing from a previous day, followed by today's headlines. "
        "Open by noting how sentiment or the key themes have moved since that earlier "
        "briefing, then cover today's developments.\n\n"
        f"Briefing from a previous day:\n{previous_summary}\n\n"
        f"Today's headlines:\n{headline_block}\n\n"
        f"{_FOCUS}\n{_STYLE_OVERRIDE}\n\nToday's briefing:"
    )


def _format_headline(article: dict) -> str:
    publisher = article.get("publisher")
    return f"- {article['title']} ({publisher})" if publisher else f"- {article['title']}"


# Wire services and mainstream financial press, seeded from the measured publisher split
# (contract 0039: 488 stored articles, 46 publishers — MT Newswires produces exactly the
# broad-market wire copy the briefing wants, outnumbered roughly 4-to-1 by single-name SEO
# content from a handful of high-volume outlets). CNBC, MarketWatch and Associated Press are
# not in the store yet as of this contract; they are plausible future Yahoo providers and
# cost nothing to include ahead of time. Deliberately excluded: 24/7 Wall St., Motley Fool,
# Zacks, GuruFocus.com, Trefis, Insider Monkey, Simply Wall St., StockStory, Stocktwits,
# MarketBeat — the 213 articles this preference exists to demote, not remove (they still
# appear in the news cards; only the briefing's reading order changes).
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


def preferred_headlines(articles: list[dict], limit: int) -> list[dict]:
    """Articles from preferred publishers first, each group keeping input order, truncated to
    `limit`. A preference, not a filter: everything not from a preferred publisher is still
    appended afterward as top-up, before truncating — a quiet wire day must still produce a
    full-length briefing rather than a two-headline one.

    Matching is exact on article["publisher"], case-insensitively, and reads PREFERRED_PUBLISHERS
    fresh on every call (not a module-level derived constant) so it stays overridable by
    monkeypatching just that name. A publisher of None is never preferred. Deliberately not a
    substring match: "Benzinga Prediction Markets" must not match a preferred "Benzinga" —
    those are different sources that happen to share a prefix."""
    preferred_lower = {publisher.lower() for publisher in PREFERRED_PUBLISHERS}

    preferred: list[dict] = []
    rest: list[dict] = []
    for article in articles:
        publisher = article.get("publisher")
        if publisher is not None and publisher.lower() in preferred_lower:
            preferred.append(article)
        else:
            rest.append(article)

    return (preferred + rest)[:limit]


def generate_briefing(prompt: str) -> str | None:
    """One Gemini call. None on any failure, including an empty or whitespace-only response —
    refresh_briefing treats None exactly like a raised exception: write nothing, leave the
    existing row as the fallback."""
    settings = Settings()
    try:
        client = genai.Client(api_key=settings.gemini_key)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            # Suppress the SDK's own "automatic function calling" log line by configuring the
            # behavior off at the source, not by attaching anything to the google_genai
            # logger — a log-record filter there would also swallow real errors emitted
            # through that same logger.
            config=types.GenerateContentConfig(
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            ),
        )
        text = (response.text or "").strip()
    except Exception:
        # Broad on purpose: this is the one network call in the module, to a third-party API
        # whose failure modes (quota, model retirement, transient 5xx) are not enumerable in
        # advance, and a failure here must degrade to "keep the old briefing", never raise into
        # refresh_news_if_stale's article refresh. See report.
        logger.exception("app.briefing: Gemini generation failed")
        return None
    return text or None


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres
    round-trips it tz-aware. created_at is always written from refresh_briefing's now_utc
    argument, itself always a UTC value, so its wall-clock numbers are genuinely UTC even
    after SQLite drops the tzinfo — the same relabel app/cache.py and app/news.py do for the
    same reason. Without this, build_prompt's `.astimezone(_ET)` on a naive value would
    silently assume local system time instead of UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def latest_briefing() -> dict | None:
    """The newest stored summary, or None when there isn't one or no database is configured."""
    if not is_enabled():
        return None
    with session() as db:
        row = (
            db.execute(select(NewsSummary).order_by(NewsSummary.created_at.desc()).limit(1))
            .scalars()
            .first()
        )
        if row is None:
            return None
        data = {col.name: getattr(row, col.name) for col in NewsSummary.__table__.columns}
        data["created_at"] = _as_utc(data["created_at"])
        return data


def _insert_summary(text: str, model: str, article_count: int, created_at: datetime) -> int:
    with session() as db:
        row = NewsSummary(summary=text, model=model, article_count=article_count, created_at=created_at)
        db.add(row)
        db.flush()
        return row.id


def _prune_old_summaries(now_utc: datetime, keep_id: int) -> None:
    """The only delete in this module, and it excludes the row just inserted — a superseded
    summary is never removed merely for being superseded, only for being superseded *and*
    SUMMARY_RETENTION_HOURS old. Runs strictly after a successful insert (see refresh_briefing),
    so it can never fire off the back of a failed generation."""
    cutoff = now_utc - timedelta(hours=SUMMARY_RETENTION_HOURS)
    with session() as db:
        db.execute(
            delete(NewsSummary).where(NewsSummary.created_at <= cutoff, NewsSummary.id != keep_id)
        )


def refresh_briefing(now_utc: datetime, now_et: datetime, articles_refreshed: bool) -> None:
    """Regenerates the briefing from the most recently stored headlines. Never wipes: a failed
    or empty generation returns before writing anything, so the previous briefing — stale, but
    present — stays on the page instead of it going blank.

    `articles_refreshed` is forwarded straight to needs_summary: it is what lets a newly-set
    GEMINI_KEY produce a briefing on the very next request (no prior summary exists, so
    needs_summary's first rule fires regardless of this flag) while still stopping every later
    page load from spending a Gemini call on unchanged headlines."""
    settings = Settings()
    if not is_enabled() or settings.gemini_key is None:
        return

    latest = latest_briefing()
    latest_created_at = latest["created_at"] if latest else None
    if not needs_summary(latest_created_at, now_utc, articles_refreshed):
        return

    # Over-select then prefer (contract 0039), the same shape as app/news.py's
    # cap_per_ticker: preferring inside an already-truncated MAX_HEADLINES list would do
    # almost nothing, since a quiet-wire day's preferred articles might not even survive the
    # first cut. recent_articles itself is untouched — GET /news depends on its behavior.
    candidates = recent_articles(min(MAX_HEADLINES * 4, 200))
    articles = preferred_headlines(candidates, MAX_HEADLINES)
    if not articles:
        return

    headlines = [_format_headline(article) for article in articles]
    previous_summary = latest["summary"] if latest else None
    prompt = build_prompt(headlines, previous_summary, latest_created_at, now_et)

    text = generate_briefing(prompt)
    if not text:
        return

    new_id = _insert_summary(text, settings.gemini_model, len(articles), now_utc)
    _prune_old_summaries(now_utc, keep_id=new_id)
