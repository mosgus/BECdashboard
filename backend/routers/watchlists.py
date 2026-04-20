"""Watchlist CRUD + item management + price/signal refresh."""
from __future__ import annotations

import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices
from core.signals import compute_all_signals
from db.base import get_db
from db.models import UniverseTicker, Watchlist, WatchlistItem

router = APIRouter()


class WatchlistCreate(BaseModel):
    name: str


class WatchlistRename(BaseModel):
    name: str


class AddItemRequest(BaseModel):
    ticker: str


# ── List / Create / Rename / Delete ──────────────────────────────────────────

@router.get("/watchlists")
def list_watchlists(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    watchlists = (
        db.query(Watchlist)
        .order_by(Watchlist.created_at)
        .offset(offset)
        .limit(limit)
        .all()
    )
    result = []
    for wl in watchlists:
        count = (
            db.query(WatchlistItem)
            .filter(WatchlistItem.watchlist_id == wl.id)
            .count()
        )
        result.append({
            "id": str(wl.id),
            "name": wl.name,
            "created_at": wl.created_at.isoformat(),
            "item_count": count,
        })
    return {"watchlists": result}


@router.post("/watchlists", status_code=201)
def create_watchlist(
    body: WatchlistCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    wl = Watchlist(id=uuid.uuid4(), name=body.name.strip())
    db.add(wl)
    db.commit()
    db.refresh(wl)
    return {"id": str(wl.id), "name": wl.name, "created_at": wl.created_at.isoformat()}


@router.get("/watchlists/{wl_id}")
def get_watchlist(wl_id: str, db: Session = Depends(get_db)) -> dict:
    wl = db.get(Watchlist, uuid.UUID(wl_id))
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")
    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == uuid.UUID(wl_id))
        .order_by(WatchlistItem.ticker)
        .all()
    )
    return {
        "id": str(wl.id),
        "name": wl.name,
        "created_at": wl.created_at.isoformat(),
        "tickers": [i.ticker for i in items],
    }


@router.put("/watchlists/{wl_id}")
def rename_watchlist(
    wl_id: str,
    body: WatchlistRename,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    wl = db.get(Watchlist, uuid.UUID(wl_id))
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")
    wl.name = body.name.strip()
    db.commit()
    return {"id": str(wl.id), "name": wl.name}


@router.delete("/watchlists/{wl_id}", status_code=204)
def delete_watchlist(
    wl_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    wl = db.get(Watchlist, uuid.UUID(wl_id))
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")
    db.delete(wl)
    db.commit()


# ── Items ─────────────────────────────────────────────────────────────────────

@router.post("/watchlists/{wl_id}/items", status_code=201)
def add_watchlist_item(
    wl_id: str,
    body: AddItemRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    ticker = body.ticker.upper().strip()
    wl = db.get(Watchlist, uuid.UUID(wl_id))
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")

    uni = db.get(UniverseTicker, ticker)
    if not uni:
        raise HTTPException(
            status_code=422,
            detail=f"{ticker} is not in the universe. Add it via the Universe page first.",
        )
    if not uni.active:
        raise HTTPException(
            status_code=422,
            detail=f"{ticker} is currently inactive in the universe.",
        )

    existing = db.get(WatchlistItem, (uuid.UUID(wl_id), ticker))
    if existing:
        raise HTTPException(status_code=409, detail=f"{ticker} is already in this watchlist.")

    item = WatchlistItem(watchlist_id=uuid.UUID(wl_id), ticker=ticker)
    db.add(item)
    db.commit()
    return {"watchlist_id": wl_id, "ticker": ticker}


@router.delete("/watchlists/{wl_id}/items/{ticker}", status_code=204)
def remove_watchlist_item(
    wl_id: str,
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    ticker = ticker.upper()
    item = db.get(WatchlistItem, (uuid.UUID(wl_id), ticker))
    if not item:
        raise HTTPException(status_code=404, detail=f"{ticker} not found in watchlist.")
    db.delete(item)
    db.commit()


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/watchlists/{wl_id}/refresh")
def refresh_watchlist(
    wl_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Fetch latest prices + compute signals for all tickers in the watchlist.

    Uses the 1-hour TTL cache — repeated clicks within an hour are free.
    """
    wl = db.get(Watchlist, uuid.UUID(wl_id))
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found.")

    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == uuid.UUID(wl_id))
        .order_by(WatchlistItem.ticker)
        .all()
    )
    tickers = [item.ticker for item in items]

    if not tickers:
        return {
            "watchlist_id": wl_id,
            "watchlist_name": wl.name,
            "rows": [],
            "as_of_date": None,
            "data_source": "Yahoo Finance",
        }

    # 1 year of history — enough for SMA50 + MACD to warm up
    end = datetime.date.today().isoformat()
    start = (datetime.date.today() - datetime.timedelta(days=400)).isoformat()
    prices = fetch_prices(tuple(tickers), start, end)

    rows = []
    for ticker in tickers:
        row: dict = {
            "ticker": ticker,
            "last_close": None,
            "as_of_date": None,
            "signals": [],
        }
        if prices is not None and ticker in prices.columns:
            series = prices[ticker].dropna()
            if not series.empty:
                row["last_close"] = round(float(series.iloc[-1]), 4)
                row["as_of_date"] = str(series.index[-1].date())
                row["signals"] = compute_all_signals(series)
        rows.append(row)

    return {
        "watchlist_id": wl_id,
        "watchlist_name": wl.name,
        "rows": rows,
        "as_of_date": end,
        "data_source": "Yahoo Finance",
    }
