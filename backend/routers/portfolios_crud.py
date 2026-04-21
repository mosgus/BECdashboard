"""Portfolio CRUD, positions management, and CSV import."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import require_write_key
from db.base import get_db
from db.models import Portfolio, Position, UniverseTicker
from routers._portfolio_helpers import (
    PositionUpsert,
    _fetch_position_prices,
    _get_or_404,
    _parse_portfolio_csv,
    _pos_dict,
    _recompute_portfolio_from_shares,
)
from routers.universe import _TICKER_RE, _enrich

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str


class PortfolioRename(BaseModel):
    name: str


class PortfolioNotional(BaseModel):
    notional_value: Optional[float] = None


class CashUpdateRequest(BaseModel):
    cash_value: Optional[float] = None
    cash_pct_target: Optional[float] = None  # 0–100


class TargetSetPayload(BaseModel):
    source: str                                      # "optimizer" | "tilt" | "manual"
    weights: dict[str, float]
    mode: Optional[str] = None
    views_applied: bool = False
    delta_mu: Optional[dict[str, float]] = None


# ── Portfolio CRUD ────────────────────────────────────────────────────────────

@router.get("/portfolios")
def list_portfolios(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    results = (
        db.query(Portfolio, func.count(Position.ticker).label("position_count"))
        .outerjoin(Position, Portfolio.id == Position.portfolio_id)
        .group_by(Portfolio.id)
        .order_by(Portfolio.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "portfolios": [
            {
                "id": str(p.id),
                "name": p.name,
                "created_at": p.created_at.isoformat(),
                "last_rebalance_date": p.last_rebalance_date.isoformat() if p.last_rebalance_date else None,
                "position_count": count,
            }
            for p, count in results
        ]
    }


@router.post("/portfolios", status_code=201)
def create_portfolio(
    body: PortfolioCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = Portfolio(id=uuid.uuid4(), name=body.name.strip())
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": str(p.id), "name": p.name, "created_at": p.created_at.isoformat(), "position_count": 0}


@router.get("/portfolios/{portfolio_id}")
def get_portfolio(portfolio_id: str, db: Session = Depends(get_db)) -> dict:
    p = _get_or_404(db, portfolio_id)
    all_positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()

    # Filter out any cash positions (should not exist after migration, but safety net)
    positions = [pos for pos in all_positions if pos.position_type != "cash"]

    prices = _fetch_position_prices(positions)

    def enrich(pos: Position) -> dict:
        d = _pos_dict(pos)
        price = prices.get(pos.ticker)
        d["price"] = price
        d["market_value"] = (
            round(pos.shares * price, 2)
            if pos.shares is not None and price is not None
            else None
        )
        return d

    return {
        "id": str(p.id),
        "name": p.name,
        "created_at": p.created_at.isoformat(),
        "notional_value": float(p.notional_value) if p.notional_value is not None else None,
        "cash_value": float(p.cash_value) if p.cash_value is not None else None,
        "cash_pct_target": p.cash_pct_target,
        "last_rebalance_date": p.last_rebalance_date.isoformat() if p.last_rebalance_date else None,
        "last_target_set": json.loads(p.last_target_set) if p.last_target_set else None,
        "positions": [enrich(pos) for pos in positions],
    }


@router.patch("/portfolios/{portfolio_id}/notional")
def patch_portfolio_notional(
    portfolio_id: str,
    body: PortfolioNotional,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Set or clear the portfolio's notional dollar value (used by the Implementation Worksheet)."""
    p = _get_or_404(db, portfolio_id)
    p.notional_value = body.notional_value
    db.commit()
    return {
        "id": str(p.id),
        "name": p.name,
        "notional_value": float(p.notional_value) if p.notional_value is not None else None,
    }


@router.patch("/portfolios/{portfolio_id}/cash")
def update_portfolio_cash(
    portfolio_id: str,
    body: CashUpdateRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Update portfolio cash_value and/or cash_pct_target."""
    p = _get_or_404(db, portfolio_id)
    if body.cash_value is not None:
        p.cash_value = body.cash_value
    if body.cash_pct_target is not None:
        p.cash_pct_target = body.cash_pct_target
    db.commit()
    return {
        "cash_value": float(p.cash_value) if p.cash_value is not None else None,
        "cash_pct_target": p.cash_pct_target,
    }


@router.patch("/portfolios/{portfolio_id}/targets")
def save_target_set(
    portfolio_id: str,
    body: TargetSetPayload,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Persist the most recent target weight set for a portfolio.

    Overwrites any previous target set — only the latest is stored.
    The Rebalance tab reads this to compute whole-share trade quantities
    across page refreshes (no session-state dependency).
    """
    p = _get_or_404(db, portfolio_id)
    stored = {
        "source": body.source,
        "weights": body.weights,
        "mode": body.mode,
        "views_applied": body.views_applied,
        "delta_mu": body.delta_mu,
        "as_of_date": date.today().isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    p.last_target_set = json.dumps(stored)
    db.commit()
    return {"last_target_set": stored}


@router.put("/portfolios/{portfolio_id}")
def rename_portfolio(
    portfolio_id: str,
    body: PortfolioRename,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    p.name = body.name.strip()
    db.commit()
    return {"id": str(p.id), "name": p.name}


@router.delete("/portfolios/{portfolio_id}", status_code=204)
def delete_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    db.delete(p)
    db.commit()


# ── Positions ────────────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/positions", status_code=201)
def add_or_update_position(
    portfolio_id: str,
    body: PositionUpsert,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)

    # Auto-backfill: if ticker isn't in the universe (or is inactive),
    # create/reactivate it and enrich with yfinance metadata. Mirrors the
    # behavior of CSV import so manual adds work for any valid ticker.
    if not _TICKER_RE.match(body.ticker):
        raise HTTPException(status_code=422, detail=f"Invalid ticker format: {body.ticker}")
    ut = db.query(UniverseTicker).filter(UniverseTicker.ticker == body.ticker).first()
    if not ut:
        ut = UniverseTicker(ticker=body.ticker, active=True)
        _enrich(ut)
        db.add(ut)
        db.flush()
    elif not ut.active:
        ut.active = True
        _enrich(ut)
        db.flush()

    existing = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == body.ticker
    ).first()
    if existing:
        if body.shares is not None:
            existing.shares = body.shares
        if body.cost_basis is not None:
            existing.cost_basis = body.cost_basis
        if body.weight is not None:
            existing.weight = body.weight
        existing.position_type = body.position_type
    else:
        pos = Position(
            portfolio_id=p.id,
            ticker=body.ticker,
            weight=body.weight,
            shares=body.shares,
            cost_basis=body.cost_basis,
            position_type=body.position_type,
        )
        db.add(pos)
    db.commit()

    # Recompute all weights from shares whenever shares are touched
    if body.shares is not None:
        _recompute_portfolio_from_shares(p.id, db)

    pos = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == body.ticker
    ).first()
    return _pos_dict(pos)


@router.put("/portfolios/{portfolio_id}/positions/{ticker}")
def update_position(
    portfolio_id: str,
    ticker: str,
    body: PositionUpsert,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    pos = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == ticker
    ).first()
    if not pos:
        raise HTTPException(status_code=404, detail=f"Position {ticker} not found.")
    if body.shares is not None:
        pos.shares = body.shares
    if body.cost_basis is not None:
        pos.cost_basis = body.cost_basis
    if body.weight is not None:
        pos.weight = body.weight
    db.commit()

    if body.shares is not None:
        _recompute_portfolio_from_shares(p.id, db)

    pos = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == ticker
    ).first()
    return _pos_dict(pos)


@router.delete("/portfolios/{portfolio_id}/positions/{ticker}", status_code=204)
def delete_position(
    portfolio_id: str,
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    pos = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == ticker
    ).first()
    if not pos:
        raise HTTPException(status_code=404, detail=f"Position {ticker} not found.")
    db.delete(pos)
    db.commit()


@router.post("/portfolios/{portfolio_id}/import_csv")
def import_portfolio_csv(
    portfolio_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Import positions from a CSV file.

    Auto-adds any tickers not already in the universe (with yfinance enrichment).
    CSV formats accepted:
      - Header 'ticker' (+ optional 'weight') columns
      - Headerless: first column = ticker, second = optional weight
    Weights may be decimals (0.25) or percentages (25 or 25%).
    Omitting weight leaves weight as null (equal-weight in analytics).
    """
    p = _get_or_404(db, portfolio_id)

    try:
        content = file.file.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read file: {exc}")

    rows = _parse_portfolio_csv(content)
    positions_added = 0
    positions_updated = 0
    universe_added: list[str] = []
    warnings: list[str] = []
    cash_total = 0.0

    for row in rows:
        ticker = row["ticker"]
        weight = row["weight"]
        shares_raw = row.get("shares")
        cost_basis_raw = row.get("cost_basis")
        position_type = row.get("position_type", "stock")

        if not ticker or ticker in ("TICKER", "SYMBOL", "CASH"):
            continue

        if not _TICKER_RE.match(ticker):
            warnings.append(f"{ticker}: invalid format — skipped")
            continue

        # Parse optional numeric fields
        shares = None
        if shares_raw:
            try:
                shares = int(float(shares_raw))
            except (ValueError, TypeError):
                pass
        cost_basis = None
        if cost_basis_raw:
            try:
                cost_basis = float(cost_basis_raw)
            except (ValueError, TypeError):
                pass

        # Handle cash positions: sum market values and don't create position rows
        if position_type == "cash":
            market_val = row.get("market_value")
            if market_val is not None:
                try:
                    cash_total += float(market_val)
                except (ValueError, TypeError):
                    pass
            continue

        # For equity positions: ensure ticker is in active universe; auto-add if missing
        ut = db.query(UniverseTicker).filter(UniverseTicker.ticker == ticker).first()
        if not ut:
            ut = UniverseTicker(ticker=ticker, active=True)
            _enrich(ut)
            db.add(ut)
            db.flush()
            universe_added.append(ticker)
        elif not ut.active:
            ut.active = True
            universe_added.append(ticker)

        # Upsert position (stock only)
        existing = db.query(Position).filter(
            Position.portfolio_id == p.id, Position.ticker == ticker
        ).first()
        if existing:
            existing.weight = weight
            if shares is not None:
                existing.shares = shares
            if cost_basis is not None:
                existing.cost_basis = cost_basis
            positions_updated += 1
        else:
            db.add(Position(portfolio_id=p.id, ticker=ticker, weight=weight,
                            shares=shares, cost_basis=cost_basis, position_type="stock"))
            positions_added += 1

    db.commit()

    # Add cash total to portfolio.cash_value
    if cash_total > 0:
        p.cash_value = round(cash_total, 2)

    # Set last_rebalance_date to now since we've imported new positions
    p.last_rebalance_date = datetime.now(timezone.utc)
    db.commit()

    # Recompute weights + notional from shares x live price (needed for Rebalance tab)
    _recompute_portfolio_from_shares(p.id, db)

    return {
        "positions_added": positions_added,
        "positions_updated": positions_updated,
        "universe_added": universe_added,
        "warnings": warnings,
    }
