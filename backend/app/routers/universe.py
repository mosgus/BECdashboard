"""The four universe HTTP endpoints. Only this module knows about HTTP — the service layer
in app/universe.py raises domain exceptions and is fully usable without FastAPI."""

from fastapi import APIRouter, HTTPException

from app.db import is_enabled
from app.schemas import AddTickerRequest, RefreshResult, UniverseDetail, UniverseEntry
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
