"""Debug probe endpoint for testing yfinance features on Render."""

import logging
import time
from fastapi import APIRouter

import yfinance as yf

router = APIRouter(prefix="/debug", tags=["debug"])


class ListHandler(logging.Handler):
    """Capture log records to a list."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(f"{record.levelname} {record.getMessage()}")


@router.get("/news/{ticker}")
def probe_news(ticker: str) -> dict:
    """Probe whether yfinance .news and .info work from this environment.
    Returns 200 with a report even on failure — exceptions are results, not errors."""
    start = time.monotonic()

    handler = ListHandler()
    handler.setLevel(logging.DEBUG)
    yf_logger = logging.getLogger("yfinance")
    # Saved and restored in the finally: raising the level without putting it back would leave
    # yfinance at DEBUG for the life of the process, flooding Render's log on every later call.
    previous_level = yf_logger.level
    yf_logger.addHandler(handler)
    yf_logger.setLevel(logging.DEBUG)

    try:
        news_count = 0
        first_title = None
        first_provider = None
        error = None
        crumb_obtained = True

        # Probe .news. Timed on its own: the whole-request number would include the .info control
        # below, and news latency is what decides whether the real feature stores or fetches live.
        news_start = time.monotonic()
        try:
            ticker_obj = yf.Ticker(ticker.upper())
            news = ticker_obj.news
            if news:
                news_count = len(news)
                first_item = news[0]
                if isinstance(first_item, dict):
                    content = first_item.get("content", {})
                    first_title = content.get("title")
                    provider = content.get("provider", {})
                    first_provider = (
                        provider.get("displayName") if isinstance(provider, dict) else None
                    )
        except Exception as e:
            error = f"{type(e).__name__}: {str(e)}"
            news_count = 0
        news_elapsed = time.monotonic() - news_start

        # Probe .info (control)
        info_works = False
        info_error = None
        try:
            ticker_obj = yf.Ticker(ticker.upper())
            info = ticker_obj.info
            if info and info.get("quoteType"):
                info_works = True
        except Exception as e:
            info_error = f"{type(e).__name__}: {str(e)}"

        # Check if crumb fetch failed
        crumb_failed_keywords = [
            "Crumb fetch rate-limited (HTTP 429), continuing without crumb",
            "Cookie/crumb fetch failed",
        ]
        for record in handler.records:
            if any(keyword in record for keyword in crumb_failed_keywords):
                crumb_obtained = False
                break

        # Redact crumb values and filter sensitive records
        filtered_records = []
        for record in handler.records:
            if "crumb = '" in record:
                continue
            filtered_records.append(record)

        # Cap to last 60 records
        filtered_records = filtered_records[-60:]

        elapsed = time.monotonic() - start

        return {
            "ticker": ticker.upper(),
            "yfinance_version": yf.__version__,
            "elapsed_seconds": round(elapsed, 2),
            "news_elapsed_seconds": round(news_elapsed, 2),
            "news_count": news_count,
            "first_title": first_title,
            "first_provider": first_provider,
            "error": error,
            "crumb_obtained": crumb_obtained,
            "info_works": info_works,
            "info_error": info_error,
            "log": filtered_records,
        }
    finally:
        yf_logger.removeHandler(handler)
        yf_logger.setLevel(previous_level)
