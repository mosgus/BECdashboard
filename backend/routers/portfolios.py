"""Portfolio CRUD, positions management, analytics (simulated), and optimization."""
from __future__ import annotations

import csv
import io
import json
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices_hybrid as fetch_prices
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
from core.rates import fetch_risk_free_rate
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
DEFAULT_LOOKBACK_DAYS = 1825  # 5 calendar years


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str


class PortfolioRename(BaseModel):
    name: str


class PortfolioNotional(BaseModel):
    notional_value: Optional[float] = None


class CashUpdateRequest(BaseModel):
    cash_value: Optional[float] = None
    cash_pct_target: Optional[float] = None  # 0–100


class PositionUpsert(BaseModel):
    ticker: str
    weight: Optional[float] = None                          # percentage units (25 = 25%); set by targets page
    shares: Optional[float] = None                          # number of shares; set by holdings page
    cost_basis: Optional[float] = None                      # per-share cost basis for P&L
    position_type: Literal["stock", "cash"] = "stock"      # 'cash' = excluded from optimization

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
    scenario_type: Literal["market_shock", "vol_shock", "historical_replay", "factor_replay"]
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

def _parse_bloomberg_format(content: str) -> list[dict] | None:
    """Parse Bloomberg holdings export format.

    Expected columns: Security, Position (shares), Price, Market Val, Cost Date, etc.
    Skips: <Search>, Totals, Cash rows.
    Returns synthetic cost_basis (market value) if cost data is missing.
    """
    try:
        reader = csv.DictReader(io.StringIO(content))
        fieldnames = [h.lower().strip() for h in (reader.fieldnames or [])]

        # Verify this is Bloomberg format by checking for required columns
        if not ("security" in fieldnames and "position" in fieldnames):
            return None

        def _row_get(row: dict, *keys: str) -> str:
            """Case-insensitive lookup across multiple possible column names."""
            lower_map = {k.lower().strip(): v for k, v in row.items()}
            for key in keys:
                val = lower_map.get(key)
                if val is not None:
                    return val
            return ""

        results = []
        for row in reader:
            security = _row_get(row, "security").strip()

            # Skip special rows
            if not security or security.startswith("<") or security.lower() in ("totals", "cash"):
                continue

            # Extract ticker from security (e.g., "BAESY US" → "BAESY", "SHOP CN" → "SHOP")
            ticker = security.split()[0].strip().upper() if security else ""
            # Skip invalid tickers (empty, "0", numeric-only, too short)
            if not ticker or ticker == "0" or len(ticker) < 1 or ticker.isdigit():
                continue
            if ticker in ("TICKER", "SYMBOL", "SECURITY"):  # Skip header-like entries
                continue

            # Extract shares (Position column)
            position_str = _row_get(row, "position").strip()
            shares = None
            if position_str:
                try:
                    shares = int(float(position_str))
                except (ValueError, TypeError):
                    try:
                        shares = float(position_str)
                    except (ValueError, TypeError):
                        pass

            # Extract current price
            price_str = _row_get(row, "price", "current price").strip()
            current_price = None
            if price_str:
                try:
                    current_price = float(price_str)
                except (ValueError, TypeError):
                    pass

            # Extract market value (current value)
            market_val_str = _row_get(row, "market val", "marketval", "market_val").strip()
            market_val = None
            if market_val_str:
                try:
                    market_val = float(market_val_str)
                except (ValueError, TypeError):
                    pass

            # Extract cost basis if available; otherwise use market value as synthetic cost
            cost_val_str = _row_get(row, "cost val", "costval", "cost_val").strip()
            cost_basis = None
            if cost_val_str:
                try:
                    cost_basis = float(cost_val_str)
                except (ValueError, TypeError):
                    pass

            # If cost basis is missing, calculate per-share cost from market value and shares
            # Otherwise use current price as synthetic cost per share
            if cost_basis is None:
                if market_val is not None and shares is not None and shares > 0:
                    # Calculate per-share cost: total market value / shares
                    cost_basis = market_val / shares
                elif current_price is not None:
                    # Fall back to current price as synthetic cost per share
                    cost_basis = current_price

            # Extract cost date if available
            cost_date_str = _row_get(row, "cost date", "costdate", "cost_date").strip()

            # Detect cash/money-market equivalents:
            # 1. Price is $1.00 ± $0.01 (money-market fund NAV)
            # 2. shares ≈ market_value (implies $1/share parity)
            # Either condition is sufficient.
            is_cash_price = current_price is not None and abs(current_price - 1.0) < 0.01
            is_cash_parity = (
                shares is not None and shares > 0
                and market_val is not None
                and abs(market_val / shares - 1.0) < 0.01
            )
            position_type = "cash" if (is_cash_price or is_cash_parity) else "stock"

            results.append({
                "ticker": ticker,
                "shares": shares,
                "price": current_price,
                "market_value": market_val,
                "cost_basis": cost_basis,
                "cost_date": cost_date_str or None,
                "weight": None,  # Will be calculated from shares/prices if needed
                "position_type": position_type,
            })

        return results if results else None

    except Exception:
        return None


def _parse_portfolio_csv(content: str) -> list[dict]:
    """Parse portfolio CSV into [{ticker, shares, cost_basis, ...}] dicts.

    Accepted formats:
      1. Simple ticker list: header 'ticker' column; optional 'weight' column
      2. Time-series portfolio: columns like AAPL_Weight, MSFT_Weight, etc. (extracts latest weights)
      3. Bloomberg holdings export: Security, Position, Price, Market Val, Cost Date columns
      4. Headerless: first column = ticker, second column = optional weight

    Weights may be decimals (0.25) or percentages (25 or 25%); decimals ≤ 1
    are converted to percentage scale to match the Position model convention.

    For missing cost basis: uses market value or calculates from shares × price.
    """
    # First, detect Bloomberg format by looking for specific header patterns
    lines = content.strip().split('\n')
    if len(lines) > 10:
        # Bloomberg format has metadata rows (1-8), then a header description row,
        # then the actual column headers. Look for the row containing "Security" and "Position"
        header_idx = None
        for i in range(min(15, len(lines))):  # Look within first 15 rows
            lower_line = lines[i].lower()
            if "security" in lower_line and "position" in lower_line:
                header_idx = i
                break

        if header_idx is not None:
            # This is a Bloomberg format with headers at row (header_idx + 1)
            # Parse starting from that header row
            bloomberg_content = '\n'.join(lines[header_idx:])
            result = _parse_bloomberg_format(bloomberg_content)
            if result:
                return result

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

    def _row_get(row: dict, *keys: str) -> str:
        """Case-insensitive lookup across multiple possible column names."""
        lower_map = {k.lower().strip(): v for k, v in row.items()}
        for key in keys:
            val = lower_map.get(key)
            if val is not None:
                return val
        return ""

    # Format 1: Simple ticker list (ticker column present)
    if "ticker" in fieldnames or "symbol" in fieldnames:
        return [
            {
                "ticker": _row_get(row, "ticker", "symbol").strip().upper(),
                "weight": _parse_weight(_row_get(row, "weight", "weight_pct", "pct", "allocation")),
                "shares": _row_get(row, "shares", "quantity", "qty").strip() or None,
                "cost_basis": _row_get(row, "price", "cost_basis", "cost").strip() or None,
            }
            for row in reader
        ]

    # Format 2: Time-series portfolio (columns like AAPL_Weight, MSFT_Weight, etc.)
    # Detect by looking for columns with _weight, _share, _mktval suffixes
    weight_cols = [f for f in fieldnames if "_weight" in f]
    if weight_cols:
        # Extract tickers from column names (e.g. "aapl_weight" → "AAPL")
        tickers_found = set()
        for col in weight_cols:
            ticker = col.replace("_weight", "").strip().upper()
            if ticker and ticker not in ("PORTFOLIO", "TOTAL"):
                tickers_found.add(ticker)

        if tickers_found:
            # Use the last row (most recent date) to get current weights, shares, and cost
            all_rows = list(reader)
            if all_rows:
                last_row = all_rows[-1]
                # Create case-insensitive lookup for the last row
                last_row_lower = {k.lower().strip(): v for k, v in last_row.items()}
                result = []
                for ticker in sorted(tickers_found):
                    weight_key = f"{ticker.lower()}_weight"
                    weight_val = last_row_lower.get(weight_key, "")
                    # Time-series weights are typically decimals (0.25) or percentages (25)
                    parsed_weight = _parse_weight(weight_val) if weight_val else None

                    # Try to extract shares (look for _shares, _share, _qty, _quantity columns)
                    shares_val = (last_row_lower.get(f"{ticker.lower()}_shares") or
                                 last_row_lower.get(f"{ticker.lower()}_share") or
                                 last_row_lower.get(f"{ticker.lower()}_qty") or
                                 last_row_lower.get(f"{ticker.lower()}_quantity") or "")
                    parsed_shares = None
                    if shares_val:
                        try:
                            parsed_shares = int(float(shares_val))
                        except (ValueError, TypeError):
                            pass

                    # Try to extract cost basis (look for _close, _price, _cost, _cost_basis columns)
                    cost_val = (last_row_lower.get(f"{ticker.lower()}_close") or
                               last_row_lower.get(f"{ticker.lower()}_price") or
                               last_row_lower.get(f"{ticker.lower()}_cost") or
                               last_row_lower.get(f"{ticker.lower()}_cost_basis") or "")
                    parsed_cost = None
                    if cost_val:
                        try:
                            parsed_cost = float(cost_val)
                        except (ValueError, TypeError):
                            pass

                    result.append({
                        "ticker": ticker,
                        "weight": parsed_weight,
                        "shares": parsed_shares,
                        "cost_basis": parsed_cost,
                    })
                return result

    # Format 3: Headerless (first column = ticker, second = optional weight)
    # Only use this format if there's no header row detected
    # Skip the first line to avoid treating header as data if any fieldnames were detected
    rows: list[dict] = []
    first_line = True
    for line in csv.reader(io.StringIO(content)):
        if not line:
            continue
        # Skip first line if it looks like a header (any fieldnames were read from DictReader)
        if first_line and (reader.fieldnames is not None):
            first_line = False
            continue
        first_line = False

        # Skip lines that look like dates (YYYY-MM-DD format) - protection against data corruption
        ticker = line[0].strip().upper()
        if ticker and ("^[0-9]{4}-[0-9]{2}-[0-9]{2}" in repr(ticker) or \
                      (len(ticker) == 10 and ticker[4] == '-' and ticker[7] == '-' and \
                       ticker[:4].isdigit() and ticker[5:7].isdigit() and ticker[8:10].isdigit())):
            # Skip date-like entries
            continue

        rows.append({
            "ticker": ticker,
            "weight": _parse_weight(line[1]) if len(line) > 1 else None,
            "shares": None,
            "cost_basis": None,
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
        "position_type": pos.position_type,
        "updated_at": pos.updated_at.isoformat(),
    }


def _recompute_portfolio_from_shares(portfolio_id: uuid.UUID, db: Session) -> None:
    """Recompute all position weights and portfolio notional from shares × live price.

    Called after any add/update that sets shares. Only acts when at least one
    position in the portfolio has shares recorded.
    Weights are stored in percentage units (25.0 = 25 %) so the optimizer
    and existing analytics code continue to work without changes.

    Note: Cash is now stored at portfolio.cash_value; no cash position rows exist.
    """
    positions = db.query(Position).filter(Position.portfolio_id == portfolio_id).all()
    share_positions = [p for p in positions if p.shares is not None]
    if not share_positions:
        return

    market_values: dict[str, float] = {}

    # Fetch live prices for equity positions
    tickers_tuple = tuple(sorted(p.ticker for p in share_positions))
    today = date.today()
    start_str = (today - timedelta(days=10)).isoformat()
    try:
        prices_df = fetch_prices(tickers_tuple, start_str, today.isoformat())
    except Exception:
        prices_df = None

    if prices_df is not None and not prices_df.empty:
        latest: dict[str, float] = {}
        for t in tickers_tuple:
            if t in prices_df.columns:
                s = prices_df[t].dropna()
                if len(s) > 0:
                    latest[t] = float(s.iloc[-1])
        for p in share_positions:
            if p.ticker in latest:
                market_values[p.ticker] = p.shares * latest[p.ticker]  # type: ignore[operator]

    total_mv = sum(market_values.values())
    if total_mv <= 0:
        return

    # Update weight (%) for all share-based positions; leave weight-only positions untouched
    for p in positions:
        if p.ticker in market_values:
            p.weight = round(market_values[p.ticker] / total_mv * 100, 4)

    # Auto-update portfolio notional value to reflect current equity market value only
    # (cash is tracked separately in portfolio.cash_value)
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
            "last_rebalance_date": p.last_rebalance_date.isoformat() if p.last_rebalance_date else None,
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

    # Recompute weights + notional from shares × live price (needed for Rebalance tab)
    _recompute_portfolio_from_shares(p.id, db)

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
    bench_metrics = compute_metrics(bench_returns) if bench_returns is not None else {}

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
        "bench_metrics": bench_metrics,
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
        raise HTTPException(status_code=422, detail="Need at least 2 equity positions to optimize.")

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
            _rf = fetch_risk_free_rate()
            exp_ret = compute_capm_expected_returns(betas, rf=_rf, mrp=0.05, views=capm_views)
            # Also add kappa-based delta_mu on top
            if delta_mu:
                exp_ret = {t: v + delta_mu.get(t, 0.0) for t, v in exp_ret.items()}
            target_dict = optimize_max_sharpe_capm(
                returns, exp_ret, rf=_rf, max_weight=body.max_weight, min_weight=min_w
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
            target_weights_dict, _capm_exp_ret, returns, rf=fetch_risk_free_rate()
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

    elif body.scenario_type == "factor_replay":
        # Returns BOTH historical replay output AND factor-projected output so
        # the frontend can flip between Historical / Modeled tabs from one response.
        from core.asset_research import compute_portfolio_attribution
        from core.factor_replay import (
            characterize_regime,
            fit_current_betas,
            project_portfolio_impact,
        )
        from core.portfolio import compute_portfolio_returns, compute_returns

        if not body.start_date or not body.end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required for factor_replay.")

        # 1. Historical replay (best-effort — excluded tickers shown in warnings)
        hist_start = body.start_date
        hist_end = body.end_date
        prices_hist = fetch_prices(tuple(sorted(tickers)), hist_start, hist_end)
        if prices_hist is not None and not prices_hist.empty:
            result = run_historical_replay(prices_hist, weights, hist_start, hist_end)
        else:
            result = {
                "warnings": [f"No price data in window {hist_start} -> {hist_end}. Historical tab unavailable."],
            }

        # 2. Fit current betas on the portfolio's last ~1 year of returns
        recent_start = (date.today() - timedelta(days=500)).isoformat()
        prices_recent = fetch_prices(tuple(sorted(tickers)), recent_start, today)
        betas: dict = {"error": "No recent price data for portfolio"}
        if prices_recent is not None and not prices_recent.empty:
            available = [t for t in tickers if t in prices_recent.columns]
            if available:
                aligned_w = {t: weights.get(t, 0) for t in available}
                total_aligned = sum(aligned_w.values())
                if total_aligned > 0:
                    aligned_w = {t: w / total_aligned for t, w in aligned_w.items()}
                w_arr = np.array([aligned_w[t] for t in available])
                returns_recent = compute_returns(prices_recent[available])
                port_ret = compute_portfolio_returns(returns_recent, w_arr)
                if len(port_ret) > 252:
                    port_ret = port_ret.iloc[-252:]
                betas = fit_current_betas(port_ret)

        # 3. Characterize regime + project
        regime = characterize_regime(hist_start, hist_end)
        projection = project_portfolio_impact(betas, regime, n_monte_carlo=500, block_size=5)

        # Attach projection data to the response
        result["current_betas"] = {k: v for k, v in betas.items() if k != "error"}
        if betas.get("error"):
            result["projection_error"] = betas["error"]
        elif regime.get("error"):
            result["projection_error"] = regime["error"]
        else:
            result["regime_factors"] = {
                "mkt_rf": regime["mkt_rf_sum"],
                "smb":    regime["smb_sum"],
                "hml":    regime["hml_sum"],
                "rf":     regime["rf_sum"],
                "n_days": regime["n_days"],
            }
            if "error" in projection:
                result["projection_error"] = projection["error"]
            else:
                result["projection_point"] = projection["point_projection"]
                result["projection_mc"] = projection["mc_distribution"]
                result["projection_paths"] = projection["paths_summary"]

        # Ensure start/end always present for preset matching
        result["start"] = hist_start
        result["end"] = hist_end

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


# ── CAPM Optimize (Outlook tab — notebook replication) ────────────────────────

class TickerConfig(BaseModel):
    freeze: bool = False
    view: float = 0.0          # undervaluation % as fraction (-0.5 to 1.0)
    min_pct: float = 0.0
    max_pct: float = 100.0

class CAPMOptimizeRequest(BaseModel):
    target_value: float = 1_000_000
    rf: Optional[float] = None      # None = fetch live 10Y Treasury
    mrp: float = 0.05
    market_ticker: str = "VT"
    ticker_configs: dict[str, TickerConfig] = {}
    start: Optional[str] = None
    end: Optional[str] = None


@router.post("/portfolios/{portfolio_id}/capm_optimize")
def capm_optimize(
    portfolio_id: str,
    body: CAPMOptimizeRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """CAPM-based optimization with freeze/view controls, action table, VaR, and CAL data.

    Replicates the Colab notebook logic: computes betas via OLS, CAPM expected returns
    with analyst views, runs Max-Sharpe optimisation, then maps weights to share quantities.
    """
    from scipy.stats import norm as sp_norm

    # Resolve rf: use provided value or fetch live Treasury rate
    if body.rf is None:
        body.rf = fetch_risk_free_rate()

    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()
    if len(positions) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 positions to optimize.")

    tickers = [pos.ticker for pos in positions]
    shares_map = {pos.ticker: float(pos.shares or 0) for pos in positions}

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    # Fetch prices for holdings + market ticker
    all_tickers = tuple(sorted(set(tickers + [body.market_ticker])))
    prices = fetch_prices(all_tickers, start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid_tickers = [t for t in tickers if t in prices.columns]
    if len(valid_tickers) < 2:
        raise HTTPException(status_code=422, detail="Need price data for at least 2 tickers.")

    # Latest prices for share calculations
    latest_prices = {t: float(prices[t].dropna().iloc[-1]) for t in valid_tickers}

    # Current portfolio state
    current_values = {t: shares_map.get(t, 0) * latest_prices.get(t, 0) for t in valid_tickers}
    current_total = sum(current_values.values()) or 1.0
    current_pcts = {t: v / current_total for t, v in current_values.items()}

    # Compute returns and betas
    returns = compute_returns(prices)
    betas = compute_betas(returns, body.market_ticker)

    # Build views and bounds from ticker_configs
    views: dict[str, float] = {}
    asset_bounds: dict[str, tuple[float, float]] = {}

    for t in valid_tickers:
        cfg = body.ticker_configs.get(t, TickerConfig())
        views[t] = cfg.view

        if cfg.freeze:
            # Lock at current allocation
            frozen_w = current_pcts.get(t, 0.0)
            asset_bounds[t] = (frozen_w, frozen_w)
        else:
            asset_bounds[t] = (cfg.min_pct / 100.0, cfg.max_pct / 100.0)

    # CAPM expected returns with views
    exp_ret = compute_capm_expected_returns(betas, rf=body.rf, mrp=body.mrp, views=views)

    # Optimise
    try:
        target_dict = optimize_max_sharpe_capm(
            returns, exp_ret, rf=body.rf,
            max_weight=1.0, min_weight=0.0,
            asset_bounds=asset_bounds,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # ── Action Table ──────────────────────────────────────────────────────────
    target_value = body.target_value
    frozen_tickers = {t for t in valid_tickers if body.ticker_configs.get(t, TickerConfig()).freeze}
    action_table = []
    for t in valid_tickers:
        price = latest_prices[t]
        cur_shares = shares_map.get(t, 0)
        cur_val = cur_shares * price
        cur_pct = current_pcts.get(t, 0.0)

        if t in frozen_tickers:
            # Frozen: keep current shares exactly, no action
            action_table.append({
                "ticker": t,
                "price": round(price, 2),
                "current_shares": int(cur_shares),
                "current_value": round(cur_val, 2),
                "current_pct": round(cur_pct * 100, 4),
                "target_shares": int(cur_shares),
                "target_value": round(cur_val, 2),
                "target_pct": round(cur_pct * 100, 4),
                "action_shares": 0,
                "action_dollars": 0.0,
                "action_pct": 0.0,
                "frozen": True,
            })
        else:
            opt_w = target_dict.get(t, 0.0)
            tgt_val = opt_w * target_value
            tgt_shares = tgt_val / price if price > 0 else 0
            tgt_shares_int = int(tgt_shares)

            action_shares = tgt_shares_int - cur_shares
            action_dollars = action_shares * price
            action_pct = opt_w - cur_pct

            action_table.append({
                "ticker": t,
                "price": round(price, 2),
                "current_shares": int(cur_shares),
                "current_value": round(cur_val, 2),
                "current_pct": round(cur_pct * 100, 4),
                "target_shares": tgt_shares_int,
                "target_value": round(tgt_shares_int * price, 2),
                "target_pct": round(opt_w * 100, 4),
                "action_shares": int(action_shares),
                "action_dollars": round(action_dollars, 2),
                "action_pct": round(action_pct * 100, 4),
                "frozen": False,
            })

    action_table.sort(key=lambda r: r["target_pct"], reverse=True)

    # ── Portfolio Metrics ─────────────────────────────────────────────────────
    opt_weights_arr = np.array([target_dict.get(t, 0.0) for t in valid_tickers])
    exp_ret_arr = np.array([exp_ret.get(t, body.rf) for t in valid_tickers])
    cov_annual = returns[valid_tickers].cov().values * 252

    port_ret = float(np.dot(opt_weights_arr, exp_ret_arr))
    port_vol = float(np.sqrt(opt_weights_arr @ cov_annual @ opt_weights_arr))
    port_sharpe = (port_ret - body.rf) / port_vol if port_vol > 0 else 0.0
    port_beta = float(np.sum([betas.get(t, 0.0) * target_dict.get(t, 0.0) for t in valid_tickers]))

    # ── VaR (95% parametric) ──────────────────────────────────────────────────
    z95 = float(sp_norm.ppf(0.05))
    var_95 = {
        "daily": round(port_ret / 252 + z95 * port_vol / np.sqrt(252), 6),
        "weekly": round(port_ret / 52 + z95 * port_vol / np.sqrt(52), 6),
        "monthly": round(port_ret / 12 + z95 * port_vol / np.sqrt(12), 6),
        "quarterly": round(port_ret / 4 + z95 * port_vol / np.sqrt(4), 6),
        "annual": round(port_ret + z95 * port_vol, 6),
    }

    # ── CAPM Details ──────────────────────────────────────────────────────────
    capm_details = []
    for t in valid_tickers:
        beta_val = betas.get(t, 0.0)
        capm_ret = body.rf + beta_val * body.mrp
        adj_ret = exp_ret.get(t, capm_ret)
        capm_details.append({
            "ticker": t,
            "beta": round(beta_val, 4),
            "capm_return": round(capm_ret, 6),
            "view": views.get(t, 0.0),
            "adj_return": round(adj_ret, 6),
            "opt_weight": round(target_dict.get(t, 0.0), 6),
        })

    # ── CAL Data (for Risk vs Return chart) ───────────────────────────────────
    asset_vols = np.sqrt(np.diag(cov_annual))
    assets_cal = []
    for i, t in enumerate(valid_tickers):
        orig_ret = body.rf + betas.get(t, 0.0) * body.mrp
        assets_cal.append({
            "ticker": t,
            "vol": round(float(asset_vols[i]), 6),
            "orig_return": round(orig_ret, 6),
            "adj_return": round(exp_ret.get(t, orig_ret), 6),
        })

    cal_data = {
        "rf": body.rf,
        "optimal": {"vol": round(port_vol, 6), "ret": round(port_ret, 6)},
        "leverage_2x": {
            "vol": round(2 * port_vol, 6),
            "ret": round(body.rf + 2 * (port_ret - body.rf), 6),
        },
        "leverage_3x": {
            "vol": round(3 * port_vol, 6),
            "ret": round(body.rf + 3 * (port_ret - body.rf), 6),
        },
        "assets": assets_cal,
    }

    return {
        "portfolio_id": portfolio_id,
        "action_table": action_table,
        "metrics": {
            "expected_return": round(port_ret, 6),
            "expected_vol": round(port_vol, 6),
            "expected_sharpe": round(port_sharpe, 4),
            "portfolio_beta": round(port_beta, 4),
        },
        "var_95": var_95,
        "capm_details": capm_details,
        "cal_data": cal_data,
        "as_of_date": end_str,
    }


# ── Monte Carlo Simulation ───────────────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    num_simulations: int = 1000
    horizon_days: int = 252
    initial_value: float = 1_000_000
    start: Optional[str] = None
    end: Optional[str] = None


@router.post("/portfolios/{portfolio_id}/monte_carlo")
def monte_carlo_sim(
    portfolio_id: str,
    body: MonteCarloRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Monte Carlo simulation of portfolio forward returns using GBM."""
    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()
    if len(positions) < 1:
        raise HTTPException(status_code=422, detail="No equity positions in portfolio.")

    tickers = [pos.ticker for pos in positions]
    raw_w = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_w) or 1.0
    weights = np.array([w / total_w for w in raw_w])

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    prices = fetch_prices(tuple(sorted(tickers)), start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid = [t for t in tickers if t in prices.columns]
    if not valid:
        raise HTTPException(status_code=422, detail="No price data for any holding.")

    vw = np.array([weights[tickers.index(t)] for t in valid])
    vw = vw / vw.sum()

    returns = compute_returns(prices[valid])
    port_returns = (returns * vw).sum(axis=1)

    mu = float(port_returns.mean())
    sigma = float(port_returns.std())

    rng = np.random.default_rng(42)
    simulations = np.zeros((body.num_simulations, body.horizon_days + 1))
    simulations[:, 0] = body.initial_value

    for t in range(1, body.horizon_days + 1):
        z = rng.standard_normal(body.num_simulations)
        daily_ret = mu + sigma * z
        simulations[:, t] = simulations[:, t - 1] * (1 + daily_ret)

    # Percentile paths
    percentiles = [5, 25, 50, 75, 95]
    paths_summary = []
    for t in range(0, body.horizon_days + 1, max(1, body.horizon_days // 60)):
        row = {"day": t}
        for p_val in percentiles:
            row[f"p{p_val}"] = round(float(np.percentile(simulations[:, t], p_val)), 2)
        paths_summary.append(row)
    # Always include final day
    if paths_summary[-1]["day"] != body.horizon_days:
        row = {"day": body.horizon_days}
        for p_val in percentiles:
            row[f"p{p_val}"] = round(float(np.percentile(simulations[:, body.horizon_days], p_val)), 2)
        paths_summary.append(row)

    terminal = simulations[:, -1]
    terminal_returns = terminal / body.initial_value - 1

    return {
        "portfolio_id": portfolio_id,
        "paths_summary": paths_summary,
        "terminal_stats": {
            "mean": round(float(terminal.mean()), 2),
            "median": round(float(np.median(terminal)), 2),
            "p5": round(float(np.percentile(terminal, 5)), 2),
            "p25": round(float(np.percentile(terminal, 25)), 2),
            "p75": round(float(np.percentile(terminal, 75)), 2),
            "p95": round(float(np.percentile(terminal, 95)), 2),
            "prob_loss": round(float((terminal < body.initial_value).mean()), 4),
            "mean_return": round(float(terminal_returns.mean()), 6),
            "median_return": round(float(np.median(terminal_returns)), 6),
        },
        "horizon_days": body.horizon_days,
        "num_simulations": body.num_simulations,
        "initial_value": body.initial_value,
        "as_of_date": end_str,
        "brier_scoring": _compute_brier_scoring(port_returns, mu, sigma, body.horizon_days, body.num_simulations, body.initial_value),
    }


def _compute_brier_scoring(
    port_returns: pd.Series,
    mu: float,
    sigma: float,
    horizon: int,
    num_sims: int,
    initial_value: float,
) -> dict:
    """Hold-out calibration: simulate from split point forward and compare vs actuals."""
    n = len(port_returns)
    if n < horizon + 60:
        return {"brier_score": None, "coverage_50": None, "coverage_90": None, "interpretation": "insufficient_data"}

    split = n - horizon
    actual_returns = port_returns.iloc[split:].values
    actual_path = initial_value * np.cumprod(1 + actual_returns)

    # Train on first 'split' days
    train = port_returns.iloc[:split]
    train_mu = float(train.mean())
    train_sigma = float(train.std())

    rng = np.random.default_rng(99)
    sims = np.zeros((num_sims, horizon))
    sims[:, 0] = initial_value * (1 + train_mu + train_sigma * rng.standard_normal(num_sims))
    for t in range(1, horizon):
        z = rng.standard_normal(num_sims)
        sims[:, t] = sims[:, t - 1] * (1 + train_mu + train_sigma * z)

    # Check coverage: what fraction of actuals fell within predicted bands
    in_50 = 0
    in_90 = 0
    brier_sum = 0.0
    check_points = min(len(actual_path), horizon)

    for t in range(check_points):
        col = sims[:, t]
        p25, p75 = np.percentile(col, [25, 75])
        p5, p95 = np.percentile(col, [5, 95])
        actual = actual_path[t]

        if p25 <= actual <= p75:
            in_50 += 1
        if p5 <= actual <= p95:
            in_90 += 1

        # Brier-style: probability of being above actual
        prob_above = float((col >= actual).mean())
        outcome = 1.0  # actual is a realized point
        brier_sum += (prob_above - 0.5) ** 2

    coverage_50 = round(in_50 / check_points, 4) if check_points > 0 else None
    coverage_90 = round(in_90 / check_points, 4) if check_points > 0 else None
    brier_score = round(brier_sum / check_points, 4) if check_points > 0 else None

    # Interpretation
    if coverage_90 is not None:
        if 0.85 <= coverage_90 <= 0.95:
            interp = "well_calibrated"
        elif coverage_90 < 0.85:
            interp = "overconfident"
        else:
            interp = "underconfident"
    else:
        interp = "insufficient_data"

    return {
        "brier_score": brier_score,
        "coverage_50": coverage_50,
        "coverage_90": coverage_90,
        "interpretation": interp,
    }


# ── Efficient Frontier ───────────────────────────────────────────────────────

def _compute_frontier_data(
    mu: np.ndarray, C: np.ndarray, n: int,
    x0: np.ndarray, bounds: tuple, num_points: int, rf: float,
) -> tuple:
    """Pure-function frontier computation — no closures over mutable state."""
    from scipy.optimize import minimize as _min

    # Min variance
    mv = _min(lambda w: float(np.sqrt(w @ C @ w)), x0, method="SLSQP",
              bounds=bounds,
              constraints=[{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}],
              options={"ftol": 1e-12, "maxiter": 2000})
    mv_w = mv.x if mv.success else x0
    mv_vol = float(np.sqrt(mv_w @ C @ mv_w))
    mv_ret = float(mv_w @ mu)
    min_var_point = {"vol": round(mv_vol, 6), "ret": round(mv_ret, 6)}

    # Max Sharpe
    def _neg_sh(w):
        r = float(w @ mu)
        v = float(np.sqrt(w @ C @ w))
        return -(r - rf) / v if v > 1e-8 else 0.0
    ms = _min(_neg_sh, x0, method="SLSQP", bounds=bounds,
              constraints=[{"type": "eq", "fun": lambda w: float(w.sum() - 1.0)}],
              options={"ftol": 1e-12, "maxiter": 2000})
    ms_w = ms.x if ms.success else x0
    max_sharpe_point = {"vol": round(float(np.sqrt(ms_w @ C @ ms_w)), 6),
                        "ret": round(float(ms_w @ mu), 6)}

    # Frontier sweep
    target_rets = np.linspace(mv_ret, float(mu.max()), num_points)
    frontier = []
    for i, tr in enumerate(target_rets):
        target = float(tr)
        try:
            res = _min(
                lambda w: float(np.sqrt(w @ C @ w)), x0, method="SLSQP",
                bounds=bounds,
                constraints=[
                    {"type": "eq", "fun": lambda w: float(w.sum() - 1.0)},
                    {"type": "eq", "fun": lambda w, _t=target: float(w @ mu) - _t},
                ],
                options={"ftol": 1e-12, "maxiter": 2000},
            )
            if res.success:
                v = float(np.sqrt(res.x @ C @ res.x))
                r = float(res.x @ mu)
                if v > 0.005:
                    frontier.append({"vol": round(v, 6), "ret": round(r, 6)})
        except Exception:
            continue
    frontier.sort(key=lambda p: p["vol"])

    # Random portfolio cloud
    rng = np.random.default_rng(42)
    random_portfolios = []
    for _ in range(500):
        w = rng.dirichlet(np.ones(n))
        random_portfolios.append({
            "vol": round(float(np.sqrt(w @ C @ w)), 6),
            "ret": round(float(w @ mu), 6),
        })

    # Risk parity
    risk_parity_point = None
    try:
        inv_vol = 1.0 / np.sqrt(np.diag(C))
        rp_w = inv_vol / inv_vol.sum()
        risk_parity_point = {
            "vol": round(float(np.sqrt(rp_w @ C @ rp_w)), 6),
            "ret": round(float(rp_w @ mu), 6),
        }
    except Exception:
        pass

    return frontier, min_var_point, max_sharpe_point, risk_parity_point, random_portfolios


class EfficientFrontierRequest(BaseModel):
    num_points: int = 30
    rf: Optional[float] = None      # None = fetch live 10Y Treasury
    market_ticker: str = "VT"       # CAPM market proxy for beta computation
    start: Optional[str] = None
    end: Optional[str] = None


@router.post("/portfolios/{portfolio_id}/efficient_frontier")
def efficient_frontier(
    portfolio_id: str,
    body: EfficientFrontierRequest,
    db: Session = Depends(get_db),
) -> dict:
    """Compute the mean-variance efficient frontier using CAPM expected returns."""

    # Resolve rf
    rf = body.rf if body.rf is not None else fetch_risk_free_rate()

    p = _get_or_404(db, portfolio_id)
    positions = db.query(Position).filter(Position.portfolio_id == p.id).order_by(Position.ticker).all()
    if len(positions) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 equity positions to compute frontier.")

    tickers = [pos.ticker for pos in positions]
    raw_w = [(pos.weight or 1.0) for pos in positions]
    total_w = sum(raw_w) or 1.0
    current_weights = np.array([w / total_w for w in raw_w])

    today = date.today()
    end_str = body.end or today.isoformat()
    start_str = body.start or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()

    # Fetch prices for holdings + market benchmark (for beta computation)
    all_tickers = tuple(sorted(set(tickers + [body.market_ticker])))
    prices = fetch_prices(all_tickers, start_str, end_str)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    valid = [t for t in tickers if t in prices.columns]
    if len(valid) < 2:
        raise HTTPException(status_code=422, detail="Need price data for at least 2 tickers.")

    vw = np.array([current_weights[tickers.index(t)] for t in valid])
    vw = vw / vw.sum()
    n = len(valid)

    returns = compute_returns(prices)
    C = np.array(returns[valid].cov().values * 252, dtype=np.float64)

    # Use CAPM expected returns instead of historical means
    betas = compute_betas(returns, body.market_ticker)
    capm_er = compute_capm_expected_returns(betas, rf=rf, mrp=0.05)
    mu = np.array([capm_er.get(t, rf) for t in valid], dtype=np.float64)

    # Current portfolio metrics (using CAPM returns)
    cur_ret = float(vw @ mu)
    cur_vol = float(np.sqrt(vw @ C @ vw))

    bounds = tuple((0.0, 1.0) for _ in range(n))
    x0 = np.ones(n) / n

    frontier, min_var_point, max_sharpe_point, risk_parity_point, random_portfolios = \
        _compute_frontier_data(mu, C, n, x0, bounds, body.num_points, rf)

    return {
        "portfolio_id": portfolio_id,
        "frontier": frontier,
        "current_portfolio": {"vol": round(cur_vol, 6), "ret": round(cur_ret, 6)},
        "max_sharpe": max_sharpe_point,
        "min_variance": min_var_point,
        "risk_parity": risk_parity_point,
        "random_portfolios": random_portfolios,
        "as_of_date": end_str,
    }
