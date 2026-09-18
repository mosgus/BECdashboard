"""The four universe HTTP endpoints. Only this module knows about HTTP — the service layer
in app/universe.py raises domain exceptions and is fully usable without FastAPI."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response

from app.autorefresh import active_universe_tickers, run_auto_refresh_if_due
from app.cache import get_cached, store_quotes
from app.db import is_enabled
from app.export import build_universe_zip, history_to_csv
from app.news import run_news_refresh_if_due
from app.quotes import fetch_quotes
from app.schemas import (
    AddTickerRequest,
    DeleteResult,
    HistoryResponse,
    QuoteRefreshResult,
    RefreshResult,
    StripResponse,
    UniverseDetail,
    UniverseEntry,
)
from app.strip import build_strip_response
from app.universe import (
    AlreadyPresent,
    HistoryUnavailable,
    NotInUniverse,
    UnknownSymbol,
    add,
    get_one,
    list_all,
    refresh,
    remove,
)

router = APIRouter(prefix="/universe", tags=["universe"])

_DATABASE_NOT_CONFIGURED = "Database not configured"


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)


@router.get("", response_model=list[UniverseEntry])
def list_universe() -> list[dict]:
    _require_database()
    return list_all()


@router.post("", response_model=UniverseDetail, status_code=201)
def add_ticker(payload: AddTickerRequest) -> dict:
    _require_database()
    try:
        return add(payload.ticker)
    except AlreadyPresent as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UnknownSymbol as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HistoryUnavailable as exc:
        # 502, not 404: symbol_has_history already confirmed the symbol exists — this is an
        # upstream data failure, not a missing resource. 503 is already "no database
        # configured". Contract 0041's client.ts retry is GET-only, so this POST is never
        # retried by the frontend.
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/export.zip")
def download_universe_zip() -> Response:
    """One CSV per active member with stored history, zipped. Never fetches from yfinance —
    exports what is stored. Declared above /{ticker}: a single-segment path here would
    otherwise be swallowed by that route and resolve as an unknown ticker instead."""
    _require_database()

    histories: dict[str, pd.DataFrame] = {}
    for entry in list_all():
        ticker = entry["ticker"]
        stored = get_cached(ticker)
        if stored is not None and not stored.empty:
            histories[ticker] = stored

    if not histories:
        raise HTTPException(status_code=404, detail="No stored price history in the universe")

    return Response(
        content=build_universe_zip(histories),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="universe.zip"'},
    )


@router.get("/strip", response_model=StripResponse)
def get_strip(background_tasks: BackgroundTasks) -> dict:
    """Price, day change, and 5D/30D/YTD returns for the launch page, computed entirely from
    stored data. Never fetches from yfinance for the response itself; quote refresh for the
    response stays owned by list_all(). Declared above /{ticker}: a single-segment path here
    would otherwise be swallowed by that route and resolve as an unknown ticker instead.

    Also schedules run_auto_refresh_if_due (contract 0036) and run_news_refresh_if_due
    (contract 0037) as two separate background tasks — TickerStrip lives in App.tsx outside
    <Routes>, so this fires on every page load, making it the one endpoint that reliably means
    "a user visited the site" (including for someone who only opens /universe, which GET
    /news could never see). Two tasks rather than one wrapper so a failing universe sweep
    cannot stop the news refresh, and neither claims the other's app_state key. The strip
    response must not wait on either, so both are scheduled, never awaited."""
    _require_database()
    now_utc = datetime.now(timezone.utc)
    now_et = datetime.now(ZoneInfo("America/New_York"))
    background_tasks.add_task(run_auto_refresh_if_due, now_utc, now_et)
    background_tasks.add_task(run_news_refresh_if_due, now_utc, now_et)
    return build_strip_response(now_utc, now_et)


@router.post("/quotes/refresh", response_model=QuoteRefreshResult)
def refresh_quotes_endpoint() -> dict:
    """Forces a quote fetch regardless of the 10-minute TTL — the whole point of the
    `Refresh prices` button (contract 0036); QUOTE_TTL_MINUTES and refresh_quotes_if_stale
    itself are untouched. Declared above /{ticker}/refresh: POST /universe/quotes/refresh
    would otherwise match /{ticker}/refresh with ticker="quotes" and 404 — the same trap
    contracts 0020 and 0028 hit."""
    _require_database()
    tickers = active_universe_tickers()
    now_utc = datetime.now(timezone.utc)
    quotes = fetch_quotes(tickers)
    if quotes:
        store_quotes(quotes, now_utc)
    return {"refreshed": len(quotes), "fetched_at": now_utc if quotes else None}


@router.get("/{ticker}", response_model=UniverseDetail)
def get_ticker(ticker: str) -> dict:
    _require_database()
    try:
        return get_one(ticker)
    except NotInUniverse as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{ticker}", response_model=DeleteResult)
def delete_ticker(ticker: str) -> dict:
    """Permanently deletes the ticker's membership, price history, fundamentals and quote.
    A different HTTP method on the same path as GET /{ticker}, so this introduces no new
    route-ordering hazard — nothing above it needs moving."""
    _require_database()
    try:
        return remove(ticker)
    except NotInUniverse as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{ticker}/refresh", response_model=RefreshResult)
def refresh_ticker_endpoint(ticker: str) -> dict:
    _require_database()
    try:
        return refresh(ticker)
    except NotInUniverse as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{ticker}/history", response_model=HistoryResponse)
def get_history_json(ticker: str) -> dict:
    """Returns stored daily bars as JSON for charting. Never fetches — serves what is stored.
    Bars are ordered oldest first."""
    _require_database()
    try:
        get_one(ticker)
    except NotInUniverse as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    stored = get_cached(ticker)
    if stored is None or stored.empty:
        raise HTTPException(
            status_code=404, detail=f"No stored price history for {ticker.upper()}"
        )

    bars = [
        {
            "date": idx.date(),
            "close": None if pd.isna(row["close"]) else float(row["close"]),
            "adj_close": None if pd.isna(row["adj_close"]) else float(row["adj_close"]),
        }
        for idx, row in stored.iterrows()
    ]

    return {"ticker": ticker.upper(), "bars": bars}


@router.get("/{ticker}/history.csv")
def download_history_csv(ticker: str) -> Response:
    """Exports exactly what is stored — never fetches from yfinance. A download must never
    trigger a network call."""
    _require_database()
    try:
        get_one(ticker)
    except NotInUniverse as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    stored = get_cached(ticker)
    if stored is None or stored.empty:
        raise HTTPException(
            status_code=404, detail=f"No stored price history for {ticker.upper()}"
        )

    filename = f"{ticker.upper()}.csv"
    return Response(
        content=history_to_csv(stored),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
