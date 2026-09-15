"""The four universe HTTP endpoints. Only this module knows about HTTP — the service layer
in app/universe.py raises domain exceptions and is fully usable without FastAPI."""

import pandas as pd
from fastapi import APIRouter, HTTPException, Response

from app.cache import get_cached
from app.db import is_enabled
from app.export import build_universe_zip, history_to_csv
from app.schemas import AddTickerRequest, HistoryResponse, RefreshResult, UniverseDetail, UniverseEntry
from app.universe import (
    AlreadyPresent,
    NotInUniverse,
    UnknownSymbol,
    add,
    get_one,
    list_all,
    refresh,
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


@router.get("/{ticker}", response_model=UniverseDetail)
def get_ticker(ticker: str) -> dict:
    _require_database()
    try:
        return get_one(ticker)
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
