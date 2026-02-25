"""Universe management — import CSV, list, toggle active."""
from __future__ import annotations

import csv
import io
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.provider import provider as data_provider
from db.base import get_db
from db.models import UniverseTicker

router = APIRouter()

_TICKER_RE = re.compile(r"^[A-Z0-9\-\.]{1,10}$")


class TickerActiveUpdate(BaseModel):
    active: bool


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
    db: Session = Depends(get_db),
) -> dict:
    """List universe tickers with optional search and active filter."""
    q = db.query(UniverseTicker)
    if active is not None:
        q = q.filter(UniverseTicker.active == active)
    tickers = q.order_by(UniverseTicker.ticker).all()

    if query:
        q_upper = query.upper()
        tickers = [
            t for t in tickers
            if q_upper in t.ticker or (t.name and q_upper in t.name.upper())
        ]

    return {
        "tickers": [
            {
                "ticker": t.ticker,
                "name": t.name,
                "active": t.active,
                "created_at": t.created_at.isoformat(),
            }
            for t in tickers
        ],
        "total": len(tickers),
        "active_count": sum(1 for t in tickers if t.active),
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
