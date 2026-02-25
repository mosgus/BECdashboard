"""Portfolio CRUD, positions management, analytics (simulated), and optimization."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices
from core.portfolio import (
    compute_equity_curve,
    compute_metrics,
    compute_returns,
    optimize_max_sharpe,
    optimize_min_variance,
)
from core.signals import compute_all_signals
from db.base import get_db
from db.models import Portfolio, Position, UniverseTicker

router = APIRouter()

BENCHMARK = "SPY"
DEFAULT_LOOKBACK_DAYS = 730  # 2 years


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str


class PortfolioRename(BaseModel):
    name: str


class PositionUpsert(BaseModel):
    ticker: str
    weight: Optional[float] = None  # 0–1, primary field; shares optional

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


class PortfolioOptimizeRequest(BaseModel):
    mode: Literal["min_variance", "max_sharpe"] = "min_variance"
    max_weight: float = 1.0
    start: Optional[str] = None
    end: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_404(db: Session, portfolio_id: str) -> Portfolio:
    try:
        pid = uuid.UUID(portfolio_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    p = db.query(Portfolio).filter(Portfolio.id == pid).first()
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found.")
    return p


def _assert_universe(db: Session, ticker: str) -> None:
    ut = db.query(UniverseTicker).filter(
        UniverseTicker.ticker == ticker, UniverseTicker.active == True
    ).first()
    if not ut:
        raise HTTPException(
            status_code=422,
            detail=f"{ticker} is not in the active universe. Import it first.",
        )


def _pos_dict(pos: Position) -> dict:
    return {
        "ticker": pos.ticker,
        "weight": pos.weight,
        "shares": pos.shares,
        "cost_basis": pos.cost_basis,
        "updated_at": pos.updated_at.isoformat(),
    }


def _equity_records(
    port_equity: pd.Series, bench_equity: Optional[pd.Series] = None
) -> list[dict]:
    records = []
    for d, v in port_equity.items():
        row: dict = {"date": str(d.date()), "portfolio": round(float(v), 6)}
        if bench_equity is not None and d in bench_equity.index:
            row["benchmark"] = round(float(bench_equity.loc[d]), 6)
        records.append(row)
    return records


# ── Portfolio CRUD ─────────────────────────────────────────────────────────────

@router.get("/portfolios")
def list_portfolios(db: Session = Depends(get_db)) -> dict:
    rows = db.query(Portfolio).order_by(Portfolio.created_at.desc()).all()
    result = []
    for p in rows:
        count = db.query(Position).filter(Position.portfolio_id == p.id).count()
        result.append({
            "id": str(p.id),
            "name": p.name,
            "created_at": p.created_at.isoformat(),
            "position_count": count,
        })
    return {"portfolios": result}


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
    positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()
    return {
        "id": str(p.id),
        "name": p.name,
        "created_at": p.created_at.isoformat(),
        "positions": [_pos_dict(pos) for pos in positions],
    }


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


# ── Positions ─────────────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/positions", status_code=201)
def add_or_update_position(
    portfolio_id: str,
    body: PositionUpsert,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    _assert_universe(db, body.ticker)

    existing = db.query(Position).filter(
        Position.portfolio_id == p.id, Position.ticker == body.ticker
    ).first()
    if existing:
        existing.weight = body.weight
    else:
        pos = Position(portfolio_id=p.id, ticker=body.ticker, weight=body.weight)
        db.add(pos)
    db.commit()

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
    pos.weight = body.weight
    db.commit()
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


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/analytics")
def get_analytics(
    portfolio_id: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    positions = (
        db.query(Position)
        .filter(Position.portfolio_id == p.id)
        .order_by(Position.ticker)
        .all()
    )

    if not positions:
        return {
            "portfolio_id": portfolio_id,
            "warnings": ["No positions in portfolio. Add holdings first."],
            "simulated": True,
        }

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    weights = [w / total_w for w in raw_weights]

    today = date.today()
    end_str = end or today.isoformat()
    start_str = start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    all_tickers = tuple(sorted(set(tickers + [BENCHMARK])))
    prices = fetch_prices(all_tickers, start_str, end_str)

    warnings: list[str] = [
        "Analytics are simulated: current weights assumed constant over the lookback period."
    ]

    if prices is None or prices.empty:
        return {"portfolio_id": portfolio_id, "warnings": warnings + ["Could not fetch price data."], "simulated": True}

    valid_tickers = [t for t in tickers if t in prices.columns]
    if not valid_tickers:
        return {"portfolio_id": portfolio_id, "warnings": warnings + ["No valid price data for any holding."], "simulated": True}

    if len(valid_tickers) < len(tickers):
        missing = [t for t in tickers if t not in valid_tickers]
        warnings.append(f"No price data for: {', '.join(missing)}")

    # Renormalise weights to valid tickers only
    weight_map = dict(zip(tickers, weights))
    vw_raw = [weight_map[t] for t in valid_tickers]
    vw_sum = sum(vw_raw) or 1.0
    valid_weights = np.array([w / vw_sum for w in vw_raw])

    returns = compute_returns(prices[valid_tickers])
    port_returns = (returns * valid_weights).sum(axis=1)

    bench_returns: Optional[pd.Series] = None
    if BENCHMARK in prices.columns:
        bench_returns = prices[BENCHMARK].pct_change().dropna()
        idx = port_returns.index.intersection(bench_returns.index)
        port_returns = port_returns.loc[idx]
        bench_returns = bench_returns.loc[idx]

    if len(port_returns) < 252:
        warnings.append("Fewer than 1 year of data — metrics may be unreliable.")

    port_equity = compute_equity_curve(port_returns)
    bench_equity = compute_equity_curve(bench_returns) if bench_returns is not None else None
    eq_data = _equity_records(port_equity, bench_equity)

    metrics = compute_metrics(port_returns, bench_returns)

    # Exit signals per ticker (last 400 trading days of price)
    signals_by_ticker = []
    for ticker in valid_tickers:
        ser = prices[ticker].dropna().iloc[-400:]
        if len(ser) >= 50:
            sigs = compute_all_signals(ser)
        else:
            warnings.append(f"{ticker}: fewer than 50 bars — signals skipped.")
            sigs = []
        signals_by_ticker.append({"ticker": ticker, "signals": sigs})

    return {
        "portfolio_id": portfolio_id,
        "simulated": True,
        "as_of_date": end_str,
        "lookback_start": start_str,
        "tickers": valid_tickers,
        "weights": {t: round(float(valid_weights[i]), 4) for i, t in enumerate(valid_tickers)},
        "metrics": metrics,
        "equity_curves": eq_data,
        "signals_by_ticker": signals_by_ticker,
        "warnings": warnings,
    }


# ── Portfolio Optimize ─────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/optimize")
def optimize_portfolio(
    portfolio_id: str,
    body: PortfolioOptimizeRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    positions = (
        db.query(Position)
        .filter(Position.portfolio_id == p.id)
        .order_by(Position.ticker)
        .all()
    )

    warnings: list[str] = [
        "Optimization is simulated: current weights assumed constant baseline."
    ]

    if len(positions) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 positions to optimize.")

    tickers = [pos.ticker for pos in positions]
    raw_w = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_w) or 1.0
    curr_weights_norm = [w / total_w for w in raw_w]

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    prices = fetch_prices(tuple(sorted(set(tickers + [BENCHMARK]))), start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid_tickers = [t for t in tickers if t in prices.columns]
    if len(valid_tickers) < 2:
        raise HTTPException(status_code=422, detail="Need price data for at least 2 tickers.")

    if len(valid_tickers) < len(tickers):
        missing = [t for t in tickers if t not in valid_tickers]
        warnings.append(f"No data for: {', '.join(missing)}")

    cw_map = dict(zip(tickers, curr_weights_norm))
    curr_w = np.array([cw_map[t] for t in valid_tickers])
    curr_w /= curr_w.sum()

    returns = compute_returns(prices[valid_tickers])
    if len(returns) < 60:
        warnings.append("Fewer than 60 trading days of history — optimization results may be unreliable.")

    feasible = True
    try:
        if body.mode == "min_variance":
            target_dict = optimize_min_variance(returns, max_weight=body.max_weight)
        else:
            target_dict = optimize_max_sharpe(returns, max_weight=body.max_weight)
    except RuntimeError as exc:
        warnings.append(f"Optimizer did not converge: {exc}")
        target_dict = dict(zip(valid_tickers, curr_w.tolist()))
        feasible = False

    target_w = np.array([target_dict.get(t, 0.0) for t in valid_tickers])
    implied_trades = {t: round(float(target_w[i] - curr_w[i]), 4) for i, t in enumerate(valid_tickers)}

    # Equity curve comparison
    curr_ret = (returns * curr_w).sum(axis=1)
    opt_ret = (returns * target_w).sum(axis=1)

    bench_returns: Optional[pd.Series] = None
    if BENCHMARK in prices.columns:
        bench_returns = prices[BENCHMARK].pct_change().dropna()
        idx = curr_ret.index.intersection(bench_returns.index)
        curr_ret = curr_ret.loc[idx]
        opt_ret = opt_ret.loc[idx]
        bench_returns = bench_returns.loc[idx]

    curr_equity = compute_equity_curve(curr_ret)
    opt_equity = compute_equity_curve(opt_ret)
    bench_equity = compute_equity_curve(bench_returns) if bench_returns is not None else None

    eq_data = []
    for d, v in curr_equity.items():
        row: dict = {
            "date": str(d.date()),
            "current": round(float(v), 6),
            "optimized": round(float(opt_equity.loc[d]), 6),
        }
        if bench_equity is not None and d in bench_equity.index:
            row["benchmark"] = round(float(bench_equity.loc[d]), 6)
        eq_data.append(row)

    return {
        "tickers": valid_tickers,
        "current_weights": {t: round(float(curr_w[i]), 4) for i, t in enumerate(valid_tickers)},
        "target_weights": {t: round(float(target_w[i]), 4) for i, t in enumerate(valid_tickers)},
        "implied_trades": implied_trades,
        "metrics": {
            "current": compute_metrics(curr_ret, bench_returns),
            "optimized": compute_metrics(opt_ret, bench_returns),
        },
        "equity_curves": eq_data,
        "feasible": feasible,
        "mode": body.mode,
        "warnings": warnings,
        "simulated": True,
    }
