"""Portfolio CRUD, positions management, analytics (simulated), and optimization."""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices
from core.rebalance import compute_implementation
from core.tilt import compute_tilt
from routers.universe import _TICKER_RE, _enrich
from core.portfolio import (
    compute_betas,
    compute_capm_expected_returns,
    compute_equity_curve,
    compute_forward_looking_metrics,
    compute_metrics,
    compute_returns,
    optimize_equal_weight,
    optimize_max_diversification,
    optimize_max_sharpe,
    optimize_max_sharpe_capm,
    optimize_max_sortino,
    optimize_min_cvar,
    optimize_min_variance,
    optimize_risk_parity,
    optimize_target_volatility,
)
from core.signals import compute_all_signals
from core.stats import run_validation_suite
from core.forecast import (
    forecast_ewma,
    forecast_arima,
    forecast_prophet,
    forecast_ensemble,
)
from core.risk import compute_portfolio_health
from core.scenarios import run_market_shock, run_vol_shock, run_historical_replay
from core.rebalance import compute_rebalance
from db.base import get_db
from db.models import Portfolio, PortfolioCandidate, PortfolioIndicatorConfig, Position, UniverseTicker

router = APIRouter()

BENCHMARK = "SPY"
DEFAULT_LOOKBACK_DAYS = 730  # 2 years


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str


class PortfolioRename(BaseModel):
    name: str


class PortfolioNotional(BaseModel):
    notional_value: Optional[float] = None


class PositionUpsert(BaseModel):
    ticker: str
    weight: Optional[float] = None      # percentage units (25 = 25%); set by targets page
    shares: Optional[float] = None      # number of shares; set by holdings page
    cost_basis: Optional[float] = None  # per-share cost basis for P&L

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


class PortfolioOptimizeRequest(BaseModel):
    mode: Literal[
        "equal_weight",
        "min_variance",
        "max_sharpe",
        "max_sharpe_capm",
        "risk_parity",
        "max_sortino",
        "min_cvar",
        "max_diversification",
        "target_volatility",
    ] = "min_variance"
    max_weight: float = 1.0
    min_weight: float = 0.0           # global lower bound (fractions, 0.0 = unconstrained)
    vol_target: float = 0.10
    allow_short: bool = False
    start: Optional[str] = None
    end: Optional[str] = None
    conviction_views: Optional[dict[str, float]] = None  # ticker → u_i in %
    kappa: float = 0.05               # % annual return bump per 1% undervaluation


class PortfolioValidateRequest(BaseModel):
    quick: bool = True
    start: Optional[str] = None
    end: Optional[str] = None


class PortfolioForecastRequest(BaseModel):
    method: Literal["ewma", "arima", "prophet", "ensemble"] = "ensemble"
    horizon_days: int = 30
    start: Optional[str] = None
    end: Optional[str] = None


class ScenarioRequest(BaseModel):
    scenario_type: Literal["market_shock", "vol_shock", "historical_replay"]
    shock_pct: Optional[float] = None
    vol_scale: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None


class RebalanceRequest(BaseModel):
    target_weights: dict[str, float]


class TargetSetPayload(BaseModel):
    source: str                                      # "optimizer" | "tilt" | "manual"
    weights: dict[str, float]
    mode: Optional[str] = None
    views_applied: bool = False
    delta_mu: Optional[dict[str, float]] = None


class CandidateAdd(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


class IndicatorConfigUpsert(BaseModel):
    ticker: str
    indicator_type: Literal["sma", "rsi", "macd", "atr"]
    params_json: Optional[dict] = None
    enabled: bool = True

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_portfolio_csv(content: str) -> list[dict]:
    """Parse portfolio CSV into [{ticker, weight}] dicts.

    Accepted formats:
      - Header row with 'ticker' column; optional 'weight' column
      - No header: first column = ticker, second column = optional weight

    Weights may be decimals (0.25) or percentages (25 or 25%); decimals ≤ 1
    are converted to percentage scale to match the Position model convention.
    """
    reader = csv.DictReader(io.StringIO(content))
    fieldnames = [h.lower().strip() for h in (reader.fieldnames or [])]

    def _parse_weight(raw: str) -> float | None:
        raw = raw.strip().rstrip("%")
        if not raw:
            return None
        try:
            w = float(raw)
            return round(w * 100, 6) if 0 < w <= 1 else w
        except ValueError:
            return None

    if "ticker" in fieldnames:
        return [
            {
                "ticker": (row.get("ticker") or "").strip().upper(),
                "weight": _parse_weight(row.get("weight") or ""),
            }
            for row in reader
        ]

    # No header
    rows: list[dict] = []
    for line in csv.reader(io.StringIO(content)):
        if not line:
            continue
        rows.append({
            "ticker": line[0].strip().upper(),
            "weight": _parse_weight(line[1]) if len(line) > 1 else None,
        })
    return rows


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


def _recompute_portfolio_from_shares(portfolio_id: uuid.UUID, db: Session) -> None:
    """Recompute all position weights and portfolio notional from shares × live price.

    Called after any add/update that sets shares. Only acts when at least one
    position in the portfolio has shares recorded.
    Weights are stored in percentage units (25.0 = 25 %) so the optimizer
    and existing analytics code continue to work without changes.
    """
    positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
    share_positions = [p for p in positions if p.shares is not None]
    if not share_positions:
        return

    tickers_tuple = tuple(sorted(p.ticker for p in share_positions))
    today = date.today()
    start_str = (today - timedelta(days=10)).isoformat()
    try:
        prices_df = fetch_prices(tickers_tuple, start_str, today.isoformat())
    except Exception:
        prices_df = None

    if prices_df is None or prices_df.empty:
        return

    # Latest close per ticker
    latest: dict[str, float] = {}
    for t in tickers_tuple:
        if t in prices_df.columns:
            s = prices_df[t].dropna()
            if len(s) > 0:
                latest[t] = float(s.iloc[-1])

    # Market values
    market_values: dict[str, float] = {}
    for p in share_positions:
        if p.ticker in latest:
            market_values[p.ticker] = p.shares * latest[p.ticker]  # type: ignore[operator]

    total_mv = sum(market_values.values())
    if total_mv <= 0:
        return

    # Update weight (%) for share-based positions; leave weight-only positions untouched
    for p in positions:
        if p.ticker in market_values:
            p.weight = round(market_values[p.ticker] / total_mv * 100, 4)

    # Auto-update portfolio notional value to reflect current market value
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if portfolio:
        portfolio.notional_value = round(total_mv, 2)

    db.commit()


def _fetch_position_prices(positions: list[Position]) -> dict[str, float]:
    """Return {ticker: latest_close} for all tickers in positions list. Never raises."""
    if not positions:
        return {}
    tickers_tuple = tuple(sorted(p.ticker for p in positions))
    today = date.today()
    start_str = (today - timedelta(days=10)).isoformat()
    try:
        prices_df = fetch_prices(tickers_tuple, start_str, today.isoformat())
        if prices_df is None or prices_df.empty:
            return {}
        out: dict[str, float] = {}
        for t in tickers_tuple:
            if t in prices_df.columns:
                s = prices_df[t].dropna()
                if len(s) > 0:
                    out[t] = round(float(s.iloc[-1]), 4)
        return out
    except Exception:
        return {}


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
        "created_at": datetime.utcnow().isoformat() + "Z",
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
        if body.shares is not None:
            existing.shares = body.shares
        if body.cost_basis is not None:
            existing.cost_basis = body.cost_basis
        if body.weight is not None:
            existing.weight = body.weight
    else:
        pos = Position(
            portfolio_id=p.id,
            ticker=body.ticker,
            weight=body.weight,
            shares=body.shares,
            cost_basis=body.cost_basis,
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

    for row in rows:
        ticker = row["ticker"]
        weight = row["weight"]

        if not ticker or ticker in ("TICKER", "SYMBOL"):
            continue

        if not _TICKER_RE.match(ticker):
            warnings.append(f"{ticker}: invalid format — skipped")
            continue

        # Ensure ticker is in active universe; auto-add if missing
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

        # Upsert position
        existing = db.query(Position).filter(
            Position.portfolio_id == p.id, Position.ticker == ticker
        ).first()
        if existing:
            existing.weight = weight
            positions_updated += 1
        else:
            db.add(Position(portfolio_id=p.id, ticker=ticker, weight=weight))
            positions_added += 1

    db.commit()
    return {
        "positions_added": positions_added,
        "positions_updated": positions_updated,
        "universe_added": universe_added,
        "warnings": warnings,
    }


# ── Implementation Worksheet + Tilt ───────────────────────────────────────────

class ImplementationRequest(BaseModel):
    target_weights: dict[str, float]
    source: str = "manual"  # manual | optimizer | tilt


class TiltRequest(BaseModel):
    baseline: Literal["equal", "current", "optimizer"] = "current"
    optimizer_mode: Optional[str] = None  # used when baseline="optimizer"
    conviction: dict[str, float] = {}    # ticker → u_i in %
    lam: float = 1.0
    u0: float = 20.0


@router.post("/portfolios/{portfolio_id}/implementation")
def compute_portfolio_implementation(
    portfolio_id: str,
    body: ImplementationRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Whole-share implementation worksheet.

    Converts target_weights (fractions) into share-level trade orders using
    the portfolio's stored notional_value. Returns per-ticker price/shares/delta table.
    """
    p = _get_or_404(db, portfolio_id)
    if p.notional_value is None:
        raise HTTPException(
            status_code=422,
            detail="Set a portfolio value first (Holdings tab → Portfolio Value).",
        )
    V = float(p.notional_value)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()

    tickers_all = sorted(set(pos.ticker for pos in positions) | set(body.target_weights.keys()))

    today = date.today()
    start_str = (today - timedelta(days=5)).isoformat()
    prices_df = fetch_prices(tuple(sorted(tickers_all)), start_str, today.isoformat())
    if prices_df is None or prices_df.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")
    prices = {t: float(prices_df[t].dropna().iloc[-1]) for t in tickers_all if t in prices_df.columns}

    # Normalize current weights (fractions)
    raw_w = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_w) or 1.0
    current_weights = {pos.ticker: w / total_w for pos, w in zip(positions, raw_w)}

    result = compute_implementation(
        current_weights=current_weights,
        target_weights=body.target_weights,
        prices=prices,
        notional_value=V,
    )
    result["source"] = body.source
    result["as_of_date"] = today.isoformat()
    return result


@router.post("/portfolios/{portfolio_id}/tilt")
def compute_portfolio_tilt(
    portfolio_id: str,
    body: TiltRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Apply conviction tilt to a set of base weights.

    Returns tilt_weights alongside base_weights so the UI can show the diff.
    """
    p = _get_or_404(db, portfolio_id)
    positions = (
        db.query(Position)
        .filter(Position.portfolio_id == p.id)
        .order_by(Position.ticker)
        .all()
    )
    if not positions:
        raise HTTPException(status_code=422, detail="Portfolio has no positions.")

    tickers = [pos.ticker for pos in positions]
    n = len(tickers)

    if body.baseline == "equal":
        base_weights = {t: 1.0 / n for t in tickers}
    elif body.baseline == "current":
        raw_w = [(pos.weight or 1.0) for pos in positions]
        total_w = sum(raw_w) or 1.0
        base_weights = {t: w / total_w for t, w in zip(tickers, raw_w)}
    else:  # "optimizer"
        # Run a quick optimizer to get base weights
        today = date.today()
        start_str = (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()
        prices_df = fetch_prices(tuple(sorted(tickers)), start_str, today.isoformat())
        if prices_df is None or prices_df.empty:
            raise HTTPException(status_code=422, detail="Could not fetch price data for optimizer baseline.")
        valid = [t for t in tickers if t in prices_df.columns]
        returns = compute_returns(prices_df[valid])
        mode = body.optimizer_mode or "min_variance"
        try:
            if mode == "equal_weight":
                opt_dict = optimize_equal_weight(returns)
            elif mode == "max_sharpe":
                opt_dict = optimize_max_sharpe(returns)
            elif mode == "risk_parity":
                opt_dict = optimize_risk_parity(returns)
            else:
                opt_dict = optimize_min_variance(returns)
        except RuntimeError:
            opt_dict = {t: 1.0 / len(valid) for t in valid}
        base_weights = {t: opt_dict.get(t, 0.0) for t in tickers}

    tilt_weights = compute_tilt(
        base_weights=base_weights,
        conviction=body.conviction,
        lam=body.lam,
        u0=body.u0,
    )

    return {
        "tilt_weights": {t: round(v, 4) for t, v in tilt_weights.items()},
        "base_weights": {t: round(v, 4) for t, v in base_weights.items()},
        "source": "tilt",
        "params": {
            "baseline": body.baseline,
            "optimizer_mode": body.optimizer_mode,
            "conviction": body.conviction,
            "lam": body.lam,
            "u0": body.u0,
        },
    }


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
        "data_source": "Yahoo Finance",
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

    # Compute effective min/max bounds
    n_valid = len(valid_tickers)
    global_min_w = body.min_weight if not body.allow_short else 0.0
    min_w = -body.max_weight if body.allow_short else global_min_w

    if body.allow_short:
        warnings.append(
            "Short positions enabled. Equal Weight, Risk Parity, and Max Diversification remain long-only."
        )

    # Feasibility guards for global min_weight
    if global_min_w > 0 and global_min_w * n_valid > 1.0 + 1e-6:
        raise HTTPException(
            status_code=422,
            detail=f"min_weight ({global_min_w:.1%}) × N ({n_valid}) = {global_min_w * n_valid:.2f} > 1.0 — infeasible. Reduce min weight or the number of positions.",
        )
    if body.max_weight < 1.0 / n_valid - 1e-6:
        raise HTTPException(
            status_code=422,
            detail=f"max_weight ({body.max_weight:.1%}) < 1/N ({1.0/n_valid:.1%}) — infeasible. Increase max weight.",
        )

    # Conviction views → delta_mu injection (for return-based optimizers)
    views_applied = bool(body.conviction_views) and body.mode in {
        "max_sharpe", "max_sharpe_capm", "max_sortino"
    }
    delta_mu: dict[str, float] = {}
    if views_applied and body.conviction_views:
        for t in valid_tickers:
            u = body.conviction_views.get(t, 0.0)
            delta_mu[t] = body.kappa * u / 100.0  # % per 1% undervaluation → fraction

    feasible = True
    _capm_exp_ret: dict[str, float] = {}   # populated only for max_sharpe_capm
    try:
        if body.mode == "equal_weight":
            target_dict = optimize_equal_weight(returns)
        elif body.mode == "min_variance":
            target_dict = optimize_min_variance(returns, max_weight=body.max_weight, min_weight=min_w)
        elif body.mode == "max_sharpe":
            # Inject delta_mu by bumping daily mean returns proportionally
            if delta_mu:
                bumped = returns.copy()
                for t, dm in delta_mu.items():
                    if t in bumped.columns:
                        bumped[t] = bumped[t] + dm / 252.0
                target_dict = optimize_max_sharpe(bumped, max_weight=body.max_weight, min_weight=min_w)
            else:
                target_dict = optimize_max_sharpe(returns, max_weight=body.max_weight, min_weight=min_w)
        elif body.mode == "max_sharpe_capm":
            capm_returns = compute_returns(prices)
            betas = compute_betas(capm_returns, BENCHMARK)
            # Convert conviction_views (%) to fractions for compute_capm_expected_returns
            capm_views = {t: u / 100.0 for t, u in (body.conviction_views or {}).items()}
            exp_ret = compute_capm_expected_returns(betas, rf=0.0364, mrp=0.05, views=capm_views)
            # Also add kappa-based delta_mu on top
            if delta_mu:
                exp_ret = {t: v + delta_mu.get(t, 0.0) for t, v in exp_ret.items()}
            target_dict = optimize_max_sharpe_capm(
                returns, exp_ret, rf=0.0364, max_weight=body.max_weight, min_weight=min_w
            )
            _capm_exp_ret = exp_ret
        elif body.mode == "risk_parity":
            target_dict = optimize_risk_parity(returns, max_weight=body.max_weight)
        elif body.mode == "max_sortino":
            if delta_mu:
                bumped = returns.copy()
                for t, dm in delta_mu.items():
                    if t in bumped.columns:
                        bumped[t] = bumped[t] + dm / 252.0
                target_dict = optimize_max_sortino(bumped, max_weight=body.max_weight, min_weight=min_w)
            else:
                target_dict = optimize_max_sortino(returns, max_weight=body.max_weight, min_weight=min_w)
        elif body.mode == "min_cvar":
            target_dict = optimize_min_cvar(returns, max_weight=body.max_weight, min_weight=min_w)
        elif body.mode == "max_diversification":
            target_dict = optimize_max_diversification(returns, max_weight=body.max_weight)
        else:  # target_volatility
            target_dict = optimize_target_volatility(
                returns, vol_target=body.vol_target, max_weight=body.max_weight, min_weight=min_w
            )
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

    as_of_date = str(returns.index[-1].date()) if len(returns) > 0 else end_str

    # Forward-looking metrics only available for CAPM mode (uses model expected returns,
    # not historical actuals, so the number reflects what the model actually optimised for).
    forward_looking: dict | None = None
    capm_expected_returns_out: dict | None = None
    if _capm_exp_ret:
        target_weights_dict = {t: round(float(target_w[i]), 4) for i, t in enumerate(valid_tickers)}
        forward_looking = compute_forward_looking_metrics(
            target_weights_dict, _capm_exp_ret, returns, rf=0.0364
        )
        capm_expected_returns_out = {
            t: round(float(_capm_exp_ret[t]), 6)
            for t in valid_tickers
            if t in _capm_exp_ret
        }

    return {
        "tickers": valid_tickers,
        "current_weights": {t: round(float(curr_w[i]), 4) for i, t in enumerate(valid_tickers)},
        "target_weights": {t: round(float(target_w[i]), 4) for i, t in enumerate(valid_tickers)},
        "implied_trades": implied_trades,
        "metrics": {
            "current": compute_metrics(curr_ret, bench_returns),
            "optimized": compute_metrics(opt_ret, bench_returns),
            "forward_looking": forward_looking,
        },
        "capm_expected_returns": capm_expected_returns_out,
        "equity_curves": eq_data,
        "feasible": feasible,
        "mode": body.mode,
        "min_weight": body.min_weight,
        "views_applied": views_applied,
        "delta_mu": {t: round(v, 4) for t, v in delta_mu.items()} if delta_mu else {},
        "warnings": warnings,
        "simulated": True,
        "as_of_date": as_of_date,
        "data_source": "Yahoo Finance",
    }


# ── Portfolio Candidates ───────────────────────────────────────────────────────

CANDIDATE_LOOKBACK_DAYS = 400


def _candidate_refresh_rows(portfolio_id: uuid.UUID, db: Session) -> list[dict]:
    """Fetch prices + signals for all candidates. Returns list of row dicts."""
    candidates = (
        db.query(PortfolioCandidate)
        .filter(PortfolioCandidate.portfolio_id == portfolio_id)
        .order_by(PortfolioCandidate.ticker)
        .all()
    )
    if not candidates:
        return []

    tickers = [c.ticker for c in candidates]
    today = date.today()
    start_str = (today - timedelta(days=CANDIDATE_LOOKBACK_DAYS)).isoformat()
    end_str = today.isoformat()

    prices = fetch_prices(tuple(sorted(tickers)), start_str, end_str)

    rows = []
    for ticker in tickers:
        if prices is None or ticker not in prices.columns:
            rows.append({"ticker": ticker, "last_close": None, "as_of_date": None, "signals": []})
            continue
        ser = prices[ticker].dropna()
        if ser.empty:
            rows.append({"ticker": ticker, "last_close": None, "as_of_date": None, "signals": []})
            continue
        last_close = round(float(ser.iloc[-1]), 4)
        as_of_date = str(ser.index[-1].date())
        sigs = compute_all_signals(ser) if len(ser) >= 50 else []
        rows.append({"ticker": ticker, "last_close": last_close, "as_of_date": as_of_date, "signals": sigs})

    return rows


@router.get("/portfolios/{portfolio_id}/candidates")
def list_candidates(
    portfolio_id: str,
    db: Session = Depends(get_db),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    rows = _candidate_refresh_rows(p.id, db)
    as_of = rows[0]["as_of_date"] if rows else date.today().isoformat()
    return {
        "portfolio_id": portfolio_id,
        "rows": rows,
        "as_of_date": as_of,
        "data_source": "Yahoo Finance",
    }


@router.post("/portfolios/{portfolio_id}/candidates", status_code=201)
def add_candidate(
    portfolio_id: str,
    body: CandidateAdd,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    _assert_universe(db, body.ticker)
    existing = db.query(PortfolioCandidate).filter(
        PortfolioCandidate.portfolio_id == p.id,
        PortfolioCandidate.ticker == body.ticker,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{body.ticker} is already a candidate.")
    db.add(PortfolioCandidate(portfolio_id=p.id, ticker=body.ticker))
    db.commit()
    return {"portfolio_id": portfolio_id, "ticker": body.ticker}


@router.delete("/portfolios/{portfolio_id}/candidates/{ticker}", status_code=204)
def remove_candidate(
    portfolio_id: str,
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    obj = db.query(PortfolioCandidate).filter(
        PortfolioCandidate.portfolio_id == p.id,
        PortfolioCandidate.ticker == ticker,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{ticker} not in candidates.")
    db.delete(obj)
    db.commit()


@router.post("/portfolios/{portfolio_id}/candidates/refresh")
def refresh_candidates(
    portfolio_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    rows = _candidate_refresh_rows(p.id, db)
    as_of = rows[0]["as_of_date"] if rows else date.today().isoformat()
    return {
        "portfolio_id": portfolio_id,
        "rows": rows,
        "as_of_date": as_of,
        "data_source": "Yahoo Finance",
    }


# ── Indicator Configs ──────────────────────────────────────────────────────────

def _config_dict(cfg: PortfolioIndicatorConfig) -> dict:
    return {
        "id": str(cfg.id),
        "portfolio_id": str(cfg.portfolio_id),
        "ticker": cfg.ticker,
        "indicator_type": cfg.indicator_type,
        "params_json": cfg.params_json,
        "enabled": cfg.enabled,
        "created_at": cfg.created_at.isoformat(),
    }


@router.get("/portfolios/{portfolio_id}/indicator_configs")
def list_indicator_configs(
    portfolio_id: str,
    db: Session = Depends(get_db),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    configs = (
        db.query(PortfolioIndicatorConfig)
        .filter(PortfolioIndicatorConfig.portfolio_id == p.id)
        .order_by(PortfolioIndicatorConfig.ticker, PortfolioIndicatorConfig.indicator_type)
        .all()
    )
    return {"configs": [_config_dict(c) for c in configs]}


@router.post("/portfolios/{portfolio_id}/indicator_configs", status_code=201)
def upsert_indicator_config(
    portfolio_id: str,
    body: IndicatorConfigUpsert,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    existing = db.query(PortfolioIndicatorConfig).filter(
        PortfolioIndicatorConfig.portfolio_id == p.id,
        PortfolioIndicatorConfig.ticker == body.ticker,
        PortfolioIndicatorConfig.indicator_type == body.indicator_type,
    ).first()
    if existing:
        existing.params_json = body.params_json
        existing.enabled = body.enabled
        db.commit()
        return _config_dict(existing)
    cfg = PortfolioIndicatorConfig(
        portfolio_id=p.id,
        ticker=body.ticker,
        indicator_type=body.indicator_type,
        params_json=body.params_json,
        enabled=body.enabled,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _config_dict(cfg)


@router.delete("/portfolios/{portfolio_id}/indicator_configs/{ticker}/{indicator}", status_code=204)
def delete_indicator_config(
    portfolio_id: str,
    ticker: str,
    indicator: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    obj = db.query(PortfolioIndicatorConfig).filter(
        PortfolioIndicatorConfig.portfolio_id == p.id,
        PortfolioIndicatorConfig.ticker == ticker,
        PortfolioIndicatorConfig.indicator_type == indicator,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"Config {ticker}/{indicator} not found.")
    db.delete(obj)
    db.commit()


# ── Portfolio Validate ─────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/validate")
def validate_portfolio(
    portfolio_id: str,
    body: PortfolioValidateRequest,
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

    warnings: list[str] = []

    if not positions:
        raise HTTPException(status_code=422, detail="No positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    weights = np.array([w / total_w for w in raw_weights])

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    prices = fetch_prices(tuple(sorted(set(tickers + [BENCHMARK]))), start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid_tickers = [t for t in tickers if t in prices.columns]
    if not valid_tickers:
        raise HTTPException(status_code=422, detail="No valid price data for any holding.")

    if len(valid_tickers) < len(tickers):
        missing = [t for t in tickers if t not in valid_tickers]
        warnings.append(f"No data for: {', '.join(missing)}")

    weight_map = dict(zip(tickers, weights.tolist()))
    vw_raw = [weight_map[t] for t in valid_tickers]
    vw_sum = sum(vw_raw) or 1.0
    valid_weights = np.array([w / vw_sum for w in vw_raw])

    returns = compute_returns(prices[valid_tickers])
    port_returns = (returns * valid_weights).sum(axis=1).values

    if len(port_returns) < 120:
        warnings.append("Fewer than 120 trading days — validation results may be unreliable.")

    suite = run_validation_suite(port_returns, quick=body.quick)
    suite["portfolio_id"] = portfolio_id
    suite["returns_used"] = len(port_returns)
    suite["warnings"] = warnings

    return suite


# ── Portfolio Forecast ─────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/forecast")
def forecast_portfolio(
    portfolio_id: str,
    body: PortfolioForecastRequest,
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

    warnings: list[str] = []

    if not positions:
        raise HTTPException(status_code=422, detail="No positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    weights = np.array([w / total_w for w in raw_weights])

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    prices = fetch_prices(tuple(sorted(tickers)), start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid_tickers = [t for t in tickers if t in prices.columns]
    if not valid_tickers:
        raise HTTPException(status_code=422, detail="No valid price data.")

    if len(valid_tickers) < len(tickers):
        missing = [t for t in tickers if t not in valid_tickers]
        warnings.append(f"No data for: {', '.join(missing)}")

    weight_map = dict(zip(tickers, weights.tolist()))
    vw_raw = [weight_map[t] for t in valid_tickers]
    vw_sum = sum(vw_raw) or 1.0
    valid_weights = np.array([w / vw_sum for w in vw_raw])

    returns = compute_returns(prices[valid_tickers])
    port_returns = (returns * valid_weights).sum(axis=1)
    # Simulated equity curve starting at 1.0
    equity = (1 + port_returns).cumprod()

    horizon = max(1, min(body.horizon_days, 252))

    try:
        if body.method == "ewma":
            result = forecast_ewma(equity, horizon)
        elif body.method == "arima":
            result = forecast_arima(equity, horizon)
        elif body.method == "prophet":
            result = forecast_prophet(equity, horizon)
        else:  # ensemble
            result = forecast_ensemble(equity, horizon)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forecast failed: {exc}")

    result["portfolio_id"] = portfolio_id
    result["horizon_days"] = horizon
    result["warnings"] = warnings
    result["simulated"] = True
    return result


# ── Portfolio Health ───────────────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/health")
def get_portfolio_health(
    portfolio_id: str,
    benchmark: str = Query("SPY"),
    lookback: int = Query(252),
    db: Session = Depends(get_db),
) -> dict:
    """Risk decomposition: concentration, beta, vol, component risk contributions."""
    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).all()
    if not positions:
        raise HTTPException(status_code=422, detail="No positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    weights = {t: w / total_w for t, w in zip(tickers, raw_weights)}

    today = date.today().isoformat()
    start_str = (date.today() - timedelta(days=lookback + 60)).isoformat()

    prices = fetch_prices(tuple(sorted(tickers)), start_str, today)
    bench_prices = fetch_prices((benchmark,), start_str, today)

    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")
    if bench_prices is None or bench_prices.empty:
        bench_prices = pd.DataFrame()

    result = compute_portfolio_health(prices, weights, bench_prices, lookback=lookback)
    result["portfolio_id"] = portfolio_id
    result["as_of_date"] = today
    result["data_source"] = "Yahoo Finance"
    return result


# ── Scenario Analysis ──────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/scenarios/run")
def run_portfolio_scenario(
    portfolio_id: str,
    body: ScenarioRequest,
    db: Session = Depends(get_db),
    _: str = Depends(require_write_key),
) -> dict:
    """Run a portfolio scenario: market_shock, vol_shock, or historical_replay."""
    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).all()
    if not positions:
        raise HTTPException(status_code=422, detail="No positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    weights = {t: w / total_w for t, w in zip(tickers, raw_weights)}

    today = date.today().isoformat()

    if body.scenario_type == "market_shock":
        if body.shock_pct is None:
            raise HTTPException(status_code=400, detail="shock_pct required for market_shock.")
        result = run_market_shock(weights, body.shock_pct)

    elif body.scenario_type == "vol_shock":
        if body.vol_scale is None:
            raise HTTPException(status_code=400, detail="vol_scale required for vol_shock.")
        start_str = (date.today() - timedelta(days=732)).isoformat()
        prices = fetch_prices(tuple(sorted(tickers)), start_str, today)
        if prices is None or prices.empty:
            raise HTTPException(status_code=422, detail="Could not fetch price data.")
        result = run_vol_shock(prices, weights, body.vol_scale)

    elif body.scenario_type == "historical_replay":
        if not body.start_date or not body.end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required for historical_replay.")
        prices = fetch_prices(tuple(sorted(tickers)), body.start_date, body.end_date)
        if prices is None or prices.empty:
            raise HTTPException(status_code=422, detail=f"No price data between {body.start_date} and {body.end_date}.")
        result = run_historical_replay(prices, weights, body.start_date, body.end_date)

    else:
        raise HTTPException(status_code=400, detail="Unknown scenario_type.")

    result["scenario_type"] = body.scenario_type
    result["portfolio_id"] = portfolio_id
    result["as_of_date"] = today
    return result


# ── Rebalance ─────────────────────────────────────────────────────────────────

@router.post("/portfolios/{portfolio_id}/rebalance")
def compute_portfolio_rebalance(
    portfolio_id: str,
    body: RebalanceRequest,
    db: Session = Depends(get_db),
    _: str = Depends(require_write_key),
) -> dict:
    """Compute drift, turnover, and top trades between current and target weights."""
    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).all()
    if not positions:
        raise HTTPException(status_code=422, detail="No positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_weights = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_weights) or 1.0
    current_weights = {t: w / total_w for t, w in zip(tickers, raw_weights)}

    result = compute_rebalance(current_weights, body.target_weights)
    result["portfolio_id"] = portfolio_id
    result["as_of_date"] = date.today().isoformat()
    result["warnings"] = []
    return result
