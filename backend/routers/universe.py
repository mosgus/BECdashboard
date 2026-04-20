"""Universe management — import CSV, list, toggle active, enrich metadata."""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Optional

import yfinance as yf
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.provider import provider as data_provider
from db.base import get_db
from db.models import UniverseTicker

import logging
logger = logging.getLogger(__name__)

router = APIRouter()

_TICKER_RE = re.compile(r"^[A-Z0-9\-\.]{1,10}$")


def _enrich(obj: UniverseTicker) -> None:
    """Fetch yfinance metadata and populate enrichment fields. Non-blocking on failure."""
    try:
        info = yf.Ticker(obj.ticker).info
        if not obj.name:
            obj.name = info.get("longName") or info.get("shortName")
        obj.sector = info.get("sector") or info.get("quoteType")
        raw_cap = info.get("marketCap")
        obj.market_cap = int(raw_cap) if raw_cap is not None else None
        obj.pe_ratio = info.get("trailingPE")
        obj.dividend_yield = info.get("dividendYield")
        obj.fifty_two_week_high = info.get("fiftyTwoWeekHigh")
        obj.fifty_two_week_low = info.get("fiftyTwoWeekLow")
        obj.last_enriched_at = datetime.now(timezone.utc)
    except Exception:
        logger.debug("Enrichment failed for %s", obj.ticker, exc_info=True)


def _ticker_dict(t: UniverseTicker) -> dict:
    return {
        "ticker": t.ticker,
        "name": t.name,
        "active": t.active,
        "created_at": t.created_at.isoformat(),
        "sector": t.sector,
        "market_cap": t.market_cap,
        "pe_ratio": t.pe_ratio,
        "dividend_yield": t.dividend_yield,
        "fifty_two_week_high": t.fifty_two_week_high,
        "fifty_two_week_low": t.fifty_two_week_low,
        "last_enriched_at": t.last_enriched_at.isoformat() if t.last_enriched_at else None,
    }


class TickerActiveUpdate(BaseModel):
    active: bool


class TickerAdd(BaseModel):
    ticker: str
    name: str | None = None


def _parse_csv(content: str) -> list[dict]:
    """Parse CSV content into list of {ticker, name} dicts.

    Accepts:
      - Files with a 'ticker' header column (optional 'name' column)
      - Files with no header — first column treated as ticker, second as name
    """
    reader = csv.DictReader(io.StringIO(content))
    fieldnames = [h.lower().strip() for h in (reader.fieldnames or [])]

    if "ticker" in fieldnames:
        return [
            {
                "ticker": row.get("ticker", "").strip().upper(),
                "name": (row.get("name") or "").strip() or None,
            }
            for row in reader
        ]

    # No header — treat first column as ticker
    rows: list[dict] = []
    for line in csv.reader(io.StringIO(content)):
        if not line:
            continue
        rows.append({
            "ticker": line[0].strip().upper(),
            "name": line[1].strip() or None if len(line) > 1 else None,
        })
    return rows


@router.post("/universe")
def add_universe_ticker(
    body: TickerAdd,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Add a single ticker to the universe."""
    ticker = body.ticker.strip().upper()
    if not _TICKER_RE.match(ticker):
        raise HTTPException(status_code=422, detail=f"Invalid ticker format: {ticker}")
    existing = db.get(UniverseTicker, ticker)
    if existing:
        if existing.active:
            raise HTTPException(status_code=409, detail=f"{ticker} is already active in the universe.")
        # Ticker exists but inactive — reactivate it (and update name if provided)
        existing.active = True
        if body.name:
            existing.name = body.name
        _enrich(existing)
        db.commit()
        return _ticker_dict(existing)
    obj = UniverseTicker(ticker=ticker, name=body.name or None, active=True)
    _enrich(obj)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return _ticker_dict(obj)


@router.post("/universe/import_csv")
def import_universe_csv(
    file: UploadFile = File(...),
    validate: bool = Query(False, description="Soft-validate tickers via yfinance (slow)"),
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Import tickers from CSV.

    CSV must have a 'ticker' column (and optional 'name' column), or be a
    headerless file where the first column is the ticker symbol.
    """
    try:
        content = file.file.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read file: {exc}")

    rows = _parse_csv(content)
    added, skipped, warnings = 0, 0, []

    for row in rows:
        ticker = row["ticker"]
        name = row.get("name")

        # Skip blank / header rows
        if not ticker or ticker in ("TICKER", "SYMBOL"):
            skipped += 1
            continue

        if not _TICKER_RE.match(ticker):
            warnings.append(f"{ticker}: invalid format — skipped")
            skipped += 1
            continue

        existing = db.get(UniverseTicker, ticker)
        if existing:
            # Update name if provided and different
            if name and existing.name != name:
                existing.name = name
                db.add(existing)
            skipped += 1
            continue

        # Optional yfinance soft-validation (non-blocking — warn only)
        if validate and not data_provider.validate_ticker(ticker):
            warnings.append(f"{ticker}: not found on Yahoo Finance (added anyway)")

        db.add(UniverseTicker(ticker=ticker, name=name, active=True))
        added += 1

    db.commit()
    return {"added": added, "skipped": skipped, "warnings": warnings}


@router.get("/universe")
def list_universe(
    query: Optional[str] = Query(None, description="Search ticker symbol or name"),
    active: Optional[bool] = Query(None, description="Filter by active status"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    """List universe tickers with optional search and active filter."""
    q = db.query(UniverseTicker)
    if active is not None:
        q = q.filter(UniverseTicker.active == active)
    tickers = q.order_by(UniverseTicker.ticker).offset(offset).limit(limit).all()

    if query:
        q_upper = query.upper()
        tickers = [
            t for t in tickers
            if q_upper in t.ticker or (t.name and q_upper in t.name.upper())
        ]

    return {
        "tickers": [_ticker_dict(t) for t in tickers],
        "total": len(tickers),
        "active_count": sum(1 for t in tickers if t.active),
    }


@router.get("/universe/{ticker}")
def get_universe_ticker(
    ticker: str,
    db: Session = Depends(get_db),
) -> dict:
    """Get full enriched metadata for a single universe ticker."""
    ticker = ticker.upper()
    obj = db.get(UniverseTicker, ticker)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not in universe.")
    return _ticker_dict(obj)


@router.post("/universe/{ticker}/enrich")
def enrich_universe_ticker(
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Re-fetch yfinance metadata for an existing universe ticker."""
    ticker = ticker.upper()
    obj = db.get(UniverseTicker, ticker)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not in universe.")
    _enrich(obj)
    db.commit()
    return _ticker_dict(obj)


@router.post("/universe/enrich_all")
def enrich_all_universe_tickers(
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Re-fetch yfinance metadata for every active universe ticker.

    Runs in-line; takes ~20-60s for 40 tickers. Returns refreshed/total counts
    and any per-ticker errors (non-fatal).
    """
    tickers = (
        db.query(UniverseTicker)
        .filter(UniverseTicker.active == True)
        .order_by(UniverseTicker.ticker)
        .all()
    )
    refreshed = 0
    errors: list[str] = []
    for t in tickers:
        try:
            _enrich(t)
            refreshed += 1
        except Exception as exc:
            errors.append(f"{t.ticker}: {str(exc)[:100]}")
    db.commit()
    return {
        "refreshed": refreshed,
        "total": len(tickers),
        "errors": errors,
    }


@router.patch("/universe/{ticker}")
def update_universe_ticker(
    ticker: str,
    body: TickerActiveUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Toggle the active status of a universe ticker."""
    ticker = ticker.upper()
    obj = db.get(UniverseTicker, ticker)
    if not obj:
        raise HTTPException(status_code=404, detail=f"Ticker {ticker} not in universe.")
    obj.active = body.active
    db.commit()
    return {"ticker": ticker, "active": obj.active}
