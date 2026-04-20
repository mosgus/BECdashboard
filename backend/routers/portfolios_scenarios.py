"""Portfolio validation, forecast, health, scenarios, and rebalance."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices_hybrid as fetch_prices
from core.forecast import (
    forecast_arima,
    forecast_ensemble,
    forecast_ewma,
    forecast_prophet,
)
from core.portfolio import compute_equity_curve, compute_metrics, compute_returns
from core.rebalance import compute_rebalance
from core.risk import compute_portfolio_health
from core.scenarios import run_historical_replay, run_market_shock, run_vol_shock
from core.stats import run_validation_suite
from db.base import get_db
from db.models import Position
from routers._portfolio_helpers import (
    BENCHMARK,
    DEFAULT_LOOKBACK_DAYS,
    _get_or_404,
)

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

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


# ── Portfolio Validate ───────────────────────────────────────────────────────

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


# ── Portfolio Forecast ───────────────────────────────────────────────────────

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


# ── Portfolio Health ─────────────────────────────────────────────────────────

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


# ── Scenario Analysis ────────────────────────────────────────────────────────

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


# ── Rebalance ────────────────────────────────────────────────────────────────

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
