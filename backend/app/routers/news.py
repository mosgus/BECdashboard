"""The one news endpoint. No `/{something}` catch-all here, so the route-ordering trap
contract 0028/0029 hit in app/routers/universe.py does not apply — nothing to declare above."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.db import is_enabled
from app.news import active_universe_tickers, get_newest_fetched_at, recent_articles, refresh_news_if_stale
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
def get_news(
    background_tasks: BackgroundTasks,
    limit: int = _DEFAULT_LIMIT,
    max_per_ticker: int = _DEFAULT_MAX_PER_TICKER,
) -> dict:
    """Never blocks on a fetch: reads whatever is stored and returns immediately, scheduling
    refresh_news_if_stale as a background task. The request that trips the TTL serves slightly
    stale articles; the next one gets fresh — a multi-second stall on a launch page that
    Render already cold-starts at ~43s is not acceptable."""
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)

    clamped_limit = _clamp_limit(limit)
    clamped_max_per_ticker = _clamp_max_per_ticker(max_per_ticker)
    articles = recent_articles(clamped_limit, clamped_max_per_ticker)
    as_of = get_newest_fetched_at()

    now_utc = datetime.now(timezone.utc)
    now_et = datetime.now(ZoneInfo("America/New_York"))
    tickers = active_universe_tickers()
    background_tasks.add_task(refresh_news_if_stale, tickers, now_utc, now_et)

    return {"articles": articles, "as_of": as_of}
