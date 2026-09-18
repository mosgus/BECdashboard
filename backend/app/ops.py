"""Read-only system introspection (contract 0044): a bounded snapshot of database/universe/
news/briefing state (system_health) and the stored job-run history (recent_job_runs). This is
the backend half of the /ops page; contract 0045 builds the page itself.

Never a per-ticker or per-row loop: system_health issues one query per table, the same bounded
shape as app/strip.py and app/universe.py:list_all(). Neither function may raise on an empty
database — this page exists to be read when something else is already broken, so a 500 here
would be the least useful possible response.

Never expose a secret: /ops/status is unauthenticated on a public URL. gemini_key_configured
is a bare boolean; DATABASE_URL, CORS_ORIGINS and the Gemini key itself never appear here in
any form, not even a length or a prefix — the same line contract 0041's config guard holds in
its own error messages."""

import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text

from app.config import Settings
from app.db import is_enabled, session
from app.models import AppState, JobRun, NewsArticle, NewsSummary, PriceBar, UniverseTicker
from app.schedule import current_window_start

_ET = ZoneInfo("America/New_York")

_MIN_JOB_RUNS_LIMIT = 1
_MAX_JOB_RUNS_LIMIT = 100


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres
    round-trips it tz-aware. Every timestamp read here was originally written as a UTC value,
    so relabeling a naive read as UTC is a safe relabel, not a guess — the same pattern used
    throughout app/cache.py, app/news.py, app/briefing.py and app/autorefresh.py."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _alembic_revision(db) -> str | None:
    """The current Alembic head, or None if the table doesn't exist yet (a fresh database
    before the first `alembic upgrade head`) — this must never raise, since a missing revision
    is itself exactly the kind of thing this page exists to surface."""
    try:
        return db.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception:
        return None


def system_health() -> dict:
    """A bounded set of queries — one per table, never per-ticker or per-row. Returns nulls
    and zeroes for an empty database rather than raising; the router (not this function) is
    what returns 503 when no database is configured at all."""
    now_et = datetime.now(_ET)
    settings = Settings()
    window_start = current_window_start(now_et)

    if not is_enabled():
        return {
            "database": {"connected": False, "revision": None},
            "universe": {"active_tickers": 0, "total_bars": 0, "newest_bar_date": None},
            "news": {"article_count": 0, "newest_fetched_at": None},
            "briefing": {"exists": False, "model": None, "created_at": None},
            "gemini_key_configured": settings.gemini_key is not None,
            "python": sys.version.split()[0],
            "windows": {
                "auto_refresh_last_claim": None,
                "news_refresh_last_claim": None,
                "current_window_start": window_start,
            },
        }

    with session() as db:
        revision = _alembic_revision(db)

        active_tickers = db.execute(
            select(func.count()).select_from(UniverseTicker).where(UniverseTicker.active.is_(True))
        ).scalar()
        total_bars = db.execute(select(func.count()).select_from(PriceBar)).scalar()
        newest_bar_date = db.execute(select(func.max(PriceBar.date))).scalar()

        article_count = db.execute(select(func.count()).select_from(NewsArticle)).scalar()
        newest_fetched_at = db.execute(select(func.max(NewsArticle.fetched_at))).scalar()

        briefing_row = (
            db.execute(select(NewsSummary).order_by(NewsSummary.created_at.desc()).limit(1))
            .scalars()
            .first()
        )
        briefing = (
            {
                "exists": True,
                "model": briefing_row.model,
                "created_at": _as_utc(briefing_row.created_at),
            }
            if briefing_row is not None
            else {"exists": False, "model": None, "created_at": None}
        )

        auto_refresh_row = db.get(AppState, "auto_refresh")
        news_refresh_row = db.get(AppState, "news_refresh")
        auto_refresh_claim = _as_utc(auto_refresh_row.value_at) if auto_refresh_row else None
        news_refresh_claim = _as_utc(news_refresh_row.value_at) if news_refresh_row else None

    return {
        "database": {"connected": True, "revision": revision},
        "universe": {
            "active_tickers": active_tickers or 0,
            "total_bars": total_bars or 0,
            "newest_bar_date": newest_bar_date,
        },
        "news": {
            "article_count": article_count or 0,
            "newest_fetched_at": _as_utc(newest_fetched_at),
        },
        "briefing": briefing,
        "gemini_key_configured": settings.gemini_key is not None,
        "python": sys.version.split()[0],
        "windows": {
            "auto_refresh_last_claim": auto_refresh_claim,
            "news_refresh_last_claim": news_refresh_claim,
            "current_window_start": window_start,
        },
    }


def recent_job_runs(limit: int) -> list[dict]:
    """Newest first, limit clamped to [1, 100]. Empty list when no database is configured —
    the router already 503s in that case, but this stays defensive since this page is read
    precisely when something is wrong."""
    if not is_enabled():
        return []

    clamped_limit = max(_MIN_JOB_RUNS_LIMIT, min(_MAX_JOB_RUNS_LIMIT, limit))

    with session() as db:
        rows = (
            db.execute(select(JobRun).order_by(JobRun.started_at.desc()).limit(clamped_limit))
            .scalars()
            .all()
        )
        return [
            {
                "id": row.id,
                "job_name": row.job_name,
                "started_at": _as_utc(row.started_at),
                "finished_at": _as_utc(row.finished_at),
                "status": row.status,
                "duration_ms": row.duration_ms,
                "detail": row.detail,
            }
            for row in rows
        ]
