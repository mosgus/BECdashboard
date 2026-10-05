"""The four universe HTTP endpoints. Only this module knows about HTTP — the service layer
in app/universe.py raises domain exceptions and is fully usable without FastAPI."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from sqlalchemy import select

from app.autorefresh import active_universe_tickers, is_sweep_active, run_auto_refresh_if_due
from app.bars import adjust_bars
from app.cache import get_cached, store_quotes
from app.db import is_enabled, session
from app.ff3 import run_ff3_refresh_if_due
from app.export import build_universe_zip, history_to_csv
from app.news import run_news_refresh_if_due
from app.quotes import fetch_quotes, refresh_quotes_if_stale
from app.schemas import (
    AddTickerRequest,
    DeleteResult,
    HistoryResponse,
    IndicatorsResponse,
    QuoteRefreshResult,
    RefreshResult,
    ReturnsResponse,
    SignalsResponse,
    StripResponse,
    SweepStatus,
    UniverseDetail,
    UniverseEntry,
)
from app.strip import build_strip_response
from app.returns import bar_window_start, nth_prior_close, pct_return, ytd_base_close
from app.models import PriceBar
from app.indicators import (
    compute_atr,
    indicator_series,
)
from app.signals import compute_all_signals
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
SIGNAL_WINDOW_DAYS = 400


def _refresh_strip_quotes() -> None:
    """Refresh the active strip set after its stored-data response has been sent.

    The strip keeps its locally-derived ticker list inside build_strip_response, so this
    zero-argument background wrapper obtains the active set independently. The quote refresher
    owns the only staleness claim and lock; this wrapper deliberately adds neither."""
    refresh_quotes_if_stale(active_universe_tickers())


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
    stored data. Never fetches from yfinance for the response itself; quote refresh is scheduled
    separately after the response. Declared above /{ticker}: a single-segment path here would
    otherwise be swallowed by that route and resolve as an unknown ticker instead.

    Also schedules run_auto_refresh_if_due (contract 0036), run_news_refresh_if_due (contract
    0037), and quote refresh (contract 0073) as separate background tasks — TickerStrip lives in App.tsx outside
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
    background_tasks.add_task(run_ff3_refresh_if_due, now_utc)
    background_tasks.add_task(_refresh_strip_quotes)
    return build_strip_response(now_utc, now_et)


@router.get("/returns", response_model=ReturnsResponse)
def get_returns(tickers: str = "") -> dict:
    _require_database()
    requested = list(dict.fromkeys(ticker.strip().upper() for ticker in tickers.split(",") if ticker.strip()))
    if not requested:
        return {"returns": [], "as_of": None}
    if len(requested) > 100:
        raise HTTPException(status_code=400, detail="At most 100 tickers may be requested")

    today = datetime.now(ZoneInfo("America/New_York")).date()
    window_start = bar_window_start(today, today.year)
    with session() as db:
        bar_rows = db.execute(
            select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)
            .where(
                PriceBar.ticker.in_(requested),
                PriceBar.date >= window_start,
            )
            .order_by(PriceBar.ticker, PriceBar.date)
        ).all()

    bars_by_ticker: dict[str, list[tuple[date, float]]] = {}
    as_of = max((bar_date for _, bar_date, _ in bar_rows), default=None)
    for ticker, bar_date, adj_close in bar_rows:
        if adj_close is not None:
            bars_by_ticker.setdefault(ticker, []).append((bar_date, adj_close))

    returns = []
    for ticker in requested:
        bars = bars_by_ticker.get(ticker, [])
        latest = bars[-1][1] if bars else None
        returns.append(
            {
                "ticker": ticker,
                "five_day": pct_return(latest, nth_prior_close(bars, 5)),
                "thirty_day": pct_return(latest, nth_prior_close(bars, 30)),
                "ytd": pct_return(latest, ytd_base_close(bars, today.year)),
            }
        )

    return {"returns": returns, "as_of": as_of}


@router.get("/signals", response_model=SignalsResponse)
def get_signals(tickers: str = "") -> dict:
    """Return stored-data technical signals and adjusted ATR percentages by ticker."""
    _require_database()
    requested = list(dict.fromkeys(ticker.strip().upper() for ticker in tickers.split(",") if ticker.strip()))
    if not requested:
        return {"signals": [], "as_of": None}
    if len(requested) > 100:
        raise HTTPException(status_code=400, detail="At most 100 tickers may be requested")

    today = datetime.now(ZoneInfo("America/New_York")).date()
    window_start = today - timedelta(days=SIGNAL_WINDOW_DAYS)
    with session() as db:
        bar_rows = db.execute(
            select(
                PriceBar.ticker,
                PriceBar.date,
                PriceBar.high,
                PriceBar.low,
                PriceBar.close,
                PriceBar.adj_close,
            )
            .where(PriceBar.ticker.in_(requested), PriceBar.date >= window_start)
            .order_by(PriceBar.ticker, PriceBar.date)
        ).all()

    adjusted_prices: dict[str, list[tuple[date, float]]] = {}
    raw_ohlc: dict[str, list[tuple]] = {}
    as_of = max((bar_date for _, bar_date, *_ in bar_rows), default=None)
    for ticker, bar_date, high, low, close, adj_close in bar_rows:
        if adj_close is not None:
            adjusted_prices.setdefault(ticker, []).append((bar_date, adj_close))
        raw_ohlc.setdefault(ticker, []).append((bar_date, high, low, close, adj_close, None))

    adjusted_ohlc = {
        ticker: [(bar.date, bar.high, bar.low, bar.close) for bar in adjust_bars(rows)]
        for ticker, rows in raw_ohlc.items()
    }

    response = []
    for ticker in requested:
        prices = adjusted_prices.get(ticker, [])
        if not prices:
            response.append({"ticker": ticker, "signals": [], "atr": None, "atr_pct": None})
            continue

        price_series = pd.Series(
            [price for _, price in prices], index=pd.to_datetime([bar_date for bar_date, _ in prices])
        )
        atr = None
        atr_pct = None
        ohlc = adjusted_ohlc.get(ticker, [])
        if ohlc:
            ohlc_index = pd.to_datetime([bar_date for bar_date, *_ in ohlc])
            computed_atr = compute_atr(
                pd.Series([high for _, high, _, _ in ohlc], index=ohlc_index),
                pd.Series([low for _, _, low, _ in ohlc], index=ohlc_index),
                pd.Series([close for _, _, _, close in ohlc], index=ohlc_index),
            )
            latest_atr = computed_atr.iloc[-1]
            latest_price = price_series.iloc[-1]
            if pd.notna(latest_atr) and latest_price != 0:
                atr = float(latest_atr)
                atr_pct = float(atr / latest_price * 100.0)

        response.append(
            {
                "ticker": ticker,
                "signals": compute_all_signals(price_series),
                "atr": atr,
                "atr_pct": atr_pct,
            }
        )

    return {"signals": response, "as_of": as_of}


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


@router.get("/sweep_status", response_model=SweepStatus)
def get_sweep_status() -> dict:
    _require_database()
    return {"active": is_sweep_active(datetime.now(ZoneInfo("America/New_York")))}


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


@router.get("/{ticker}/indicators", response_model=IndicatorsResponse)
def get_indicators(ticker: str, include: str = "") -> dict:
    """Return requested stored-data overlay series on one shared, adjusted date axis."""
    _require_database()
    requested = {key.strip() for key in include.split(",") if key.strip()}
    if not requested:
        return {"ticker": ticker.upper(), "dates": [], "series": []}

    with session() as db:
        bar_rows = db.execute(
            select(
                PriceBar.date,
                PriceBar.high,
                PriceBar.low,
                PriceBar.close,
                PriceBar.adj_close,
                PriceBar.volume,
            )
            .where(PriceBar.ticker == ticker.upper())
            .order_by(PriceBar.date)
        ).all()

    bars = adjust_bars(bar_rows)
    if not bars:
        return {"ticker": ticker.upper(), "dates": [], "series": []}

    dates = [bar.date for bar in bars]
    high = pd.Series([bar.high for bar in bars])
    low = pd.Series([bar.low for bar in bars])
    close = pd.Series([bar.close for bar in bars])
    volume = pd.Series([bar.volume for bar in bars], dtype="float64")
    return {
        "ticker": ticker.upper(),
        "dates": dates,
        "series": indicator_series(requested, close, high, low, volume),
    }


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
