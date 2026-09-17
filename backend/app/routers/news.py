"""The one news endpoint. No `/{something}` catch-all here, so the route-ordering trap
contract 0028/0029 hit in app/routers/universe.py does not apply — nothing to declare above.

Contract 0037: this is now a pure read. News and the briefing refresh on a schedule triggered
from GET /universe/strip (app.news.run_news_refresh_if_due, alongside the universe sweep),
not from this endpoint — GET /news no longer schedules anything itself."""

from fastapi import APIRouter, HTTPException

from app.briefing import latest_briefing
from app.db import is_enabled
from app.news import get_newest_fetched_at, recent_articles
from app.schemas import NewsResponse

router = APIRouter(prefix="/news", tags=["news"])

_DATABASE_NOT_CONFIGURED = "Database not configured"

_DEFAULT_LIMIT = 30
_MIN_LIMIT = 1
_MAX_LIMIT = 100

_DEFAULT_MAX_PER_TICKER = 0
_MIN_MAX_PER_TICKER = 0
_MAX_MAX_PER_TICKER = 50


def _clamp_limit(limit: int) -> int:
    return max(_MIN_LIMIT, min(_MAX_LIMIT, limit))


def _clamp_max_per_ticker(max_per_ticker: int) -> int:
    return max(_MIN_MAX_PER_TICKER, min(_MAX_MAX_PER_TICKER, max_per_ticker))


@router.get("", response_model=NewsResponse)
def get_news(limit: int = _DEFAULT_LIMIT, max_per_ticker: int = _DEFAULT_MAX_PER_TICKER) -> dict:
    """A pure read: storage in, JSON out. Refreshing news and the briefing is no longer this
    endpoint's job (contract 0037) — GET /universe/strip schedules that on a fixed window
    schedule shared with the universe sweep, so this never blocks on a fetch and never
    schedules one either."""
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)

    clamped_limit = _clamp_limit(limit)
    clamped_max_per_ticker = _clamp_max_per_ticker(max_per_ticker)
    articles = recent_articles(clamped_limit, clamped_max_per_ticker)
    as_of = get_newest_fetched_at()

    summary = None
    latest = latest_briefing()
    if latest is not None:
        summary = {
            "text": latest["summary"],
            "created_at": latest["created_at"],
            "model": latest["model"],
            "article_count": latest["article_count"],
        }

    return {"articles": articles, "as_of": as_of, "summary": summary}
