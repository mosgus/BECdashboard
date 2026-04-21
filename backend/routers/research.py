"""Research Suite endpoints — optimizer comparison, walk-forward, correlation,
composite scoring, decision memo CRUD, universe audit, and asset research."""
from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.asset_research import (
    classify_portfolio_role,
    compute_asset_correlation,
    compute_asset_profile,
    compute_fama_french_exposure,
    compute_portfolio_attribution,
)
from core.cache import fetch_prices_hybrid as fetch_prices
from core.portfolio import (
    compute_metrics,
    compute_portfolio_returns,
    compute_returns,
)
from core.rebalance import compute_rebalance
from core.risk import compute_concentration
from core.stats import run_validation_suite
from core.universe_audit import audit_data_quality, compute_universe_stats, screen_universe
from core.walk_forward import AVAILABLE_MODES, dispatch_optimizer, run_walk_forward
from db.base import get_db
from db.models import DecisionMemo, Portfolio, Position, UniverseTicker

import logging
logger = logging.getLogger(__name__)

router = APIRouter()

BENCHMARK = "SPY"
DEFAULT_LOOKBACK_DAYS = 1825  # 5 calendar years


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_portfolio(pid: str, db: Session) -> tuple[Portfolio, list[Position]]:
    portfolio = db.query(Portfolio).filter(Portfolio.id == pid).first()
    if not portfolio:
        raise HTTPException(404, f"Portfolio {pid} not found")
    positions = db.query(Position).filter(Position.portfolio_id == pid).all()
    if not positions:
        raise HTTPException(400, "Portfolio has no positions")
    return portfolio, positions


def _weights_from_positions(positions: list[Position]) -> dict[str, float]:
    raw = {p.ticker: float(p.weight or 0) for p in positions}
    total = sum(raw.values())
    if total <= 0:
        n = len(raw)
        return {t: 1.0 / n for t in raw}
    return {t: w / total for t, w in raw.items()}


def _fetch_returns(tickers: list[str], lookback_days: int = DEFAULT_LOOKBACK_DAYS) -> pd.DataFrame:
    end = datetime.now()
    start = end - timedelta(days=int(lookback_days * 1.6))
    prices = fetch_prices(tickers, start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
    if prices.empty:
        raise HTTPException(400, "No price data available for portfolio tickers")
    return compute_returns(prices)


# ── Schemas ──────────────────────────────────────────────────────────────────

class OptimizerComparisonRequest(BaseModel):
    modes: list[str] = AVAILABLE_MODES
    max_weight: float = 1.0
    lookback_days: int = DEFAULT_LOOKBACK_DAYS


class WalkForwardRequest(BaseModel):
    mode: str = "max_sharpe"
    train_days: int = 504
    test_days: int = 63
    n_folds: int = 4
    max_weight: float = 1.0
    lookback_days: int = DEFAULT_LOOKBACK_DAYS


class DecisionMemoCreate(BaseModel):
    portfolio_id: str
    status: str = "draft"
    composite_score: Optional[float] = None
    recommendation: Optional[str] = None
    rationale: Optional[str] = None
    red_flags: Optional[list[dict]] = None
    scorecard_json: Optional[dict] = None
    monitoring_plan: Optional[str] = None
    created_by: Optional[str] = None


class UniverseAuditRequest(BaseModel):
    tickers: Optional[list[str]] = None  # None = all active tickers
    min_history_days: int = 504
    lookback_years: int = 3


class UniverseScreenRequest(BaseModel):
    min_market_cap: Optional[float] = None
    max_pe: Optional[float] = None
    min_div_yield: Optional[float] = None
    sectors_include: Optional[list[str]] = None
    sectors_exclude: Optional[list[str]] = None
    min_history_days: Optional[int] = None


# ── Optimizer Comparison ─────────────────────────────────────────────────────

@router.post("/research/{portfolio_id}/optimizer_comparison")
def optimizer_comparison(
    portfolio_id: str,
    body: OptimizerComparisonRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
):
    """Run multiple optimizer modes and return side-by-side metrics."""
    portfolio, positions = _load_portfolio(portfolio_id, db)
    current_weights = _weights_from_positions(positions)
    tickers = list(current_weights.keys())
    returns = _fetch_returns(tickers, body.lookback_days)

    # Align tickers to what's available in price data
    available = [t for t in tickers if t in returns.columns]
    if not available:
        raise HTTPException(400, "No price data for any portfolio ticker")
    returns = returns[available]

    current_w_aligned = {t: current_weights.get(t, 0) for t in available}
    total = sum(current_w_aligned.values())
    if total > 0:
        current_w_aligned = {t: w / total for t, w in current_w_aligned.items()}

    # Current portfolio metrics
    w_arr = np.array([current_w_aligned[t] for t in available])
    port_ret = compute_portfolio_returns(returns, w_arr)
    current_metrics = compute_metrics(port_ret)
    current_conc = compute_concentration(current_w_aligned)

    results = [{
        "mode": "current",
        "label": "Current Portfolio",
        "weights": {k: round(v, 4) for k, v in current_w_aligned.items()},
        "metrics": current_metrics,
        "concentration": current_conc,
        "turnover": 0.0,
    }]

    # Run each optimizer (threaded for speed)
    def _run_mode(mode: str) -> dict:
        try:
            opt_weights = dispatch_optimizer(returns, mode, body.max_weight)
            w = np.array([opt_weights.get(t, 0.0) for t in available])
            pr = compute_portfolio_returns(returns, w)
            metrics = compute_metrics(pr)
            conc = compute_concentration(opt_weights)
            rebal = compute_rebalance(current_w_aligned, opt_weights)
            return {
                "mode": mode,
                "label": mode.replace("_", " ").title(),
                "weights": {k: round(v, 4) for k, v in opt_weights.items()},
                "metrics": metrics,
                "concentration": conc,
                "turnover": rebal["turnover"],
            }
        except Exception as exc:
            return {
                "mode": mode,
                "label": mode.replace("_", " ").title(),
                "error": str(exc),
            }

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(_run_mode, m): m for m in body.modes}
        for fut in as_completed(futures):
            results.append(fut.result())

    # Sort: current first, then by mode name
    current = [r for r in results if r["mode"] == "current"]
    others = sorted([r for r in results if r["mode"] != "current"], key=lambda r: r["mode"])
    return {"results": current + others, "tickers": available}


# ── Walk-Forward ─────────────────────────────────────────────────────────────

@router.post("/research/{portfolio_id}/walk_forward")
def walk_forward(
    portfolio_id: str,
    body: WalkForwardRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
):
    """Run anchored walk-forward OOS backtest."""
    portfolio, positions = _load_portfolio(portfolio_id, db)
    tickers = [p.ticker for p in positions]
    returns = _fetch_returns(tickers, body.lookback_days)

    available = [t for t in tickers if t in returns.columns]
    if not available:
        raise HTTPException(400, "No price data for any portfolio ticker")

    result = run_walk_forward(
        returns=returns[available],
        mode=body.mode,
        train_days=body.train_days,
        test_days=body.test_days,
        n_folds=body.n_folds,
        max_weight=body.max_weight,
    )
    result["portfolio_id"] = portfolio_id
    return result


# ── Correlation Matrix ───────────────────────────────────────────────────────

@router.get("/research/{portfolio_id}/correlation")
def correlation_matrix(
    portfolio_id: str,
    db: Session = Depends(get_db),
):
    """Pairwise correlation matrix + hierarchical clustering order."""
    portfolio, positions = _load_portfolio(portfolio_id, db)
    tickers = [p.ticker for p in positions]
    returns = _fetch_returns(tickers)

    available = [t for t in tickers if t in returns.columns]
    if len(available) < 2:
        raise HTTPException(400, "Need at least 2 tickers with price data for correlation")

    corr = returns[available].corr()

    # Hierarchical clustering for optimal display order
    cluster_order = available  # default
    try:
        from scipy.cluster.hierarchy import leaves_list, linkage
        from scipy.spatial.distance import squareform

        dist = 1 - corr.values
        np.fill_diagonal(dist, 0)
        dist = (dist + dist.T) / 2
        dist = np.clip(dist, 0, None)
        linkage_matrix = linkage(squareform(dist), method="ward")
        order = leaves_list(linkage_matrix)
        cluster_order = [available[i] for i in order]
    except Exception:
        logger.debug("Hierarchical clustering failed; using default order", exc_info=True)

    # Convert to serialisable format
    matrix = {
        t1: {t2: round(float(corr.loc[t1, t2]), 4) for t2 in available}
        for t1 in available
    }

    return {
        "tickers": available,
        "cluster_order": cluster_order,
        "matrix": matrix,
    }


# ── Composite Score ──────────────────────────────────────────────────────────

@router.get("/research/{portfolio_id}/tearsheet_data")
def tearsheet_data(
    portfolio_id: str,
    lookback_days: int = 252,
    db: Session = Depends(get_db),
):
    """One-shot aggregator for the PDF tear sheet.

    Combines: portfolio metadata, composite score, analytics summary,
    health/concentration, attribution, top holdings with role classification,
    and latest decision memo. Frontend renders all of this into a PDF.
    """
    from core.portfolio import compute_metrics
    from core.risk import compute_portfolio_health
    from datetime import datetime as dt_inner

    portfolio, positions = _load_portfolio(portfolio_id, db)
    weights = _weights_from_positions(positions)
    tickers = list(weights.keys())
    returns = _fetch_returns(tickers, lookback_days=lookback_days)
    available = [t for t in tickers if t in returns.columns]
    if not available:
        raise HTTPException(400, "No price data for portfolio tickers")

    # Alignment
    w_aligned = {t: weights.get(t, 0) for t in available}
    total = sum(w_aligned.values())
    if total > 0:
        w_aligned = {t: w / total for t, w in w_aligned.items()}
    w_arr = np.array([w_aligned[t] for t in available])

    # Portfolio returns + metrics
    port_ret = compute_portfolio_returns(returns[available], w_arr)
    if len(port_ret) > lookback_days:
        port_ret = port_ret.iloc[-lookback_days:]
    metrics = compute_metrics(port_ret)

    # Validation suite
    val = run_validation_suite(port_ret.values, quick=True)
    validation_score = val["n_passing"] / val["n_total"]

    # Concentration + health
    conc = compute_concentration(w_aligned)
    n_assets = len(available)
    min_hhi = 1.0 / n_assets if n_assets > 0 else 1.0
    concentration_score = max(0.0, 1.0 - (conc["hhi"] - min_hhi) / (1.0 - min_hhi)) if n_assets > 1 else 0.0

    sharpe = metrics.get("sharpe", 0.0)
    performance_score = min(1.0, max(0.0, (sharpe + 0.5) / 2.0))
    max_dd = metrics.get("max_dd", -1.0)
    drawdown_score = min(1.0, max(0.0, 1.0 + max_dd * 2.0))

    composite = (
        0.30 * validation_score
        + 0.25 * concentration_score
        + 0.25 * performance_score
        + 0.20 * drawdown_score
    )
    total_score = round(composite * 100, 1)

    # Attribution
    attribution = compute_portfolio_attribution(port_ret)

    # Health (beta, vol, RCs) — needs benchmark prices
    try:
        bench_prices = fetch_prices((BENCHMARK,),
                                    (datetime.now() - timedelta(days=int(lookback_days * 1.6))).strftime("%Y-%m-%d"),
                                    datetime.now().strftime("%Y-%m-%d"))
        health = compute_portfolio_health(returns[available].dropna().to_frame() if len(available) == 1 else
                                          (returns[available] + 1).cumprod().dropna(),
                                          w_aligned,
                                          bench_prices if bench_prices is not None else returns[available[:1]],
                                          lookback=lookback_days)
    except Exception:
        logger.warning("Portfolio health computation failed", exc_info=True)
        health = {"concentration": conc, "beta": None, "vol": None, "risk_contributions": [], "warnings": []}

    # Top 10 holdings
    sorted_holdings = sorted(w_aligned.items(), key=lambda kv: -kv[1])[:10]
    top_holdings = [
        {"ticker": t, "weight_pct": round(w * 100, 2)}
        for t, w in sorted_holdings
    ]

    # Latest decision memo
    memo = (
        db.query(DecisionMemo)
        .filter(DecisionMemo.portfolio_id == portfolio_id)
        .order_by(DecisionMemo.created_at.desc())
        .first()
    )
    memo_dict = None
    if memo:
        memo_dict = {
            "recommendation": memo.recommendation,
            "rationale": memo.rationale,
            "red_flags": memo.red_flags,
            "monitoring_plan": memo.monitoring_plan,
            "created_by": memo.created_by,
            "created_at": memo.created_at.isoformat() if memo.created_at else None,
        }

    return {
        "portfolio": {
            "id": portfolio_id,
            "name": portfolio.name,
            "notional_value": float(portfolio.notional_value) if portfolio.notional_value else None,
            "created_at": portfolio.created_at.isoformat() if portfolio.created_at else None,
            "n_holdings": len(available),
        },
        "as_of_date": dt_inner.now().strftime("%Y-%m-%d"),
        "lookback_days": lookback_days,
        "composite_score": {
            "total": total_score,
            "categories": {
                "validation":    {"score": round(validation_score, 3),    "detail": f"{val['n_passing']}/{val['n_total']} tests passed", "weight": 0.30},
                "concentration": {"score": round(concentration_score, 3), "detail": f"HHI={conc['hhi']:.3f}, N_eff={conc['n_eff']:.1f}", "weight": 0.25},
                "performance":   {"score": round(performance_score, 3),   "detail": f"Sharpe={sharpe:.2f}", "weight": 0.25},
                "drawdown":      {"score": round(drawdown_score, 3),      "detail": f"Max DD={max_dd:.1%}", "weight": 0.20},
            },
            "go_decision": val["go_decision"],
        },
        "metrics": {
            "cagr": metrics.get("cagr"),
            "vol": metrics.get("vol"),
            "sharpe": metrics.get("sharpe"),
            "max_dd": metrics.get("max_dd"),
        },
        "health": {
            "hhi": conc["hhi"],
            "n_eff": conc["n_eff"],
            "top5": conc["top5"],
            "beta": health.get("beta"),
            "vol": health.get("vol"),
        },
        "attribution": attribution,
        "top_holdings": top_holdings,
        "latest_memo": memo_dict,
    }


@router.get("/research/{portfolio_id}/attribution")
def portfolio_attribution(
    portfolio_id: str,
    lookback_days: int = 252,
    db: Session = Depends(get_db),
):
    """Fama-French 3-factor decomposition of portfolio return over the lookback window.

    Regresses portfolio excess returns on [Mkt-RF, SMB, HML] and breaks the
    total period return into alpha + market + SMB + HML + residual contributions.
    """
    portfolio, positions = _load_portfolio(portfolio_id, db)
    weights = _weights_from_positions(positions)
    tickers = list(weights.keys())
    returns = _fetch_returns(tickers, lookback_days=lookback_days)

    available = [t for t in tickers if t in returns.columns]
    if not available:
        raise HTTPException(400, "No price data for portfolio tickers")

    w_aligned = {t: weights.get(t, 0) for t in available}
    total = sum(w_aligned.values())
    if total > 0:
        w_aligned = {t: w / total for t, w in w_aligned.items()}

    w_arr = np.array([w_aligned[t] for t in available])
    port_ret = compute_portfolio_returns(returns[available], w_arr)

    # Trim to lookback window
    if len(port_ret) > lookback_days:
        port_ret = port_ret.iloc[-lookback_days:]

    result = compute_portfolio_attribution(port_ret)
    result["portfolio_id"] = portfolio_id
    result["lookback_days"] = lookback_days
    return result


@router.get("/research/{portfolio_id}/composite_score")
def composite_score(
    portfolio_id: str,
    db: Session = Depends(get_db),
):
    """Aggregate research score (0-100) from validation, concentration, etc."""
    portfolio, positions = _load_portfolio(portfolio_id, db)
    weights = _weights_from_positions(positions)
    tickers = list(weights.keys())
    returns = _fetch_returns(tickers)

    available = [t for t in tickers if t in returns.columns]
    if not available:
        raise HTTPException(400, "No price data for portfolio tickers")

    w_aligned = {t: weights.get(t, 0) for t in available}
    total = sum(w_aligned.values())
    if total > 0:
        w_aligned = {t: w / total for t, w in w_aligned.items()}

    w_arr = np.array([w_aligned[t] for t in available])
    port_ret = compute_portfolio_returns(returns[available], w_arr)

    # 1. Validation score (0-1)
    val = run_validation_suite(port_ret.values, quick=True)
    validation_score = val["n_passing"] / val["n_total"]

    # 2. Concentration score (0-1) — lower HHI is better
    conc = compute_concentration(w_aligned)
    # HHI ranges from 1/n (perfect diversification) to 1 (single asset)
    n_assets = len(available)
    min_hhi = 1.0 / n_assets if n_assets > 0 else 1.0
    concentration_score = max(0.0, 1.0 - (conc["hhi"] - min_hhi) / (1.0 - min_hhi)) if n_assets > 1 else 0.0

    # 3. Performance score (0-1) — based on Sharpe
    metrics = compute_metrics(port_ret)
    sharpe = metrics.get("sharpe", 0.0)
    performance_score = min(1.0, max(0.0, (sharpe + 0.5) / 2.0))  # maps [-0.5, 1.5] to [0, 1]

    # 4. Drawdown score (0-1) — less negative is better
    max_dd = metrics.get("max_dd", -1.0)
    drawdown_score = min(1.0, max(0.0, 1.0 + max_dd * 2.0))  # maps [-0.5, 0] to [0, 1]

    # Weighted composite
    composite = (
        0.30 * validation_score
        + 0.25 * concentration_score
        + 0.25 * performance_score
        + 0.20 * drawdown_score
    )
    total_score = round(composite * 100, 1)

    return {
        "total": total_score,
        "categories": {
            "validation": {"score": round(validation_score, 3), "detail": f"{val['n_passing']}/{val['n_total']} tests passed", "weight": 0.30},
            "concentration": {"score": round(concentration_score, 3), "detail": f"HHI={conc['hhi']:.3f}, N_eff={conc['n_eff']:.1f}", "weight": 0.25},
            "performance": {"score": round(performance_score, 3), "detail": f"Sharpe={sharpe:.2f}", "weight": 0.25},
            "drawdown": {"score": round(drawdown_score, 3), "detail": f"Max DD={max_dd:.1%}", "weight": 0.20},
        },
        "go_decision": val["go_decision"],
        "portfolio_id": portfolio_id,
    }


# ── Decision Memo CRUD ───────────────────────────────────────────────────────

@router.post("/research/decision_memos")
def create_decision_memo(
    body: DecisionMemoCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
):
    """Save a decision memo."""
    memo = DecisionMemo(
        id=uuid.uuid4(),
        portfolio_id=uuid.UUID(body.portfolio_id),
        status=body.status,
        composite_score=body.composite_score,
        recommendation=body.recommendation,
        rationale=body.rationale,
        red_flags=body.red_flags,
        scorecard_json=body.scorecard_json,
        monitoring_plan=body.monitoring_plan,
        created_by=body.created_by,
    )
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return {
        "id": str(memo.id),
        "portfolio_id": str(memo.portfolio_id),
        "status": memo.status,
        "recommendation": memo.recommendation,
        "composite_score": memo.composite_score,
        "created_at": memo.created_at.isoformat() if memo.created_at else None,
    }


@router.get("/research/{portfolio_id}/decision_memos")
def list_decision_memos(
    portfolio_id: str,
    db: Session = Depends(get_db),
):
    """List all decision memos for a portfolio, newest first."""
    memos = (
        db.query(DecisionMemo)
        .filter(DecisionMemo.portfolio_id == portfolio_id)
        .order_by(DecisionMemo.created_at.desc())
        .all()
    )
    return {
        "memos": [
            {
                "id": str(m.id),
                "portfolio_id": str(m.portfolio_id),
                "status": m.status,
                "recommendation": m.recommendation,
                "composite_score": m.composite_score,
                "rationale": m.rationale,
                "red_flags": m.red_flags,
                "scorecard_json": m.scorecard_json,
                "monitoring_plan": m.monitoring_plan,
                "created_by": m.created_by,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in memos
        ]
    }


# ── Universe Research ────────────────────────────────────────────────────────

def _ticker_dicts(db: Session, tickers: Optional[list[str]] = None) -> list[dict]:
    """Load universe tickers as dicts. If tickers is None, load all active."""
    query = db.query(UniverseTicker)
    if tickers:
        query = query.filter(UniverseTicker.ticker.in_(tickers))
    else:
        query = query.filter(UniverseTicker.active == True)
    rows = query.all()
    return [
        {
            "ticker": t.ticker,
            "name": t.name,
            "active": t.active,
            "sector": t.sector,
            "market_cap": t.market_cap,
            "pe_ratio": t.pe_ratio,
            "dividend_yield": t.dividend_yield,
            "fifty_two_week_high": t.fifty_two_week_high,
            "fifty_two_week_low": t.fifty_two_week_low,
        }
        for t in rows
    ]


@router.get("/research/universe/stats")
def universe_stats(db: Session = Depends(get_db)):
    """Universe summary stats: sector distribution, market cap percentiles, coverage."""
    tickers = _ticker_dicts(db)
    if not tickers:
        raise HTTPException(400, "No active tickers in universe")
    return compute_universe_stats(tickers)


@router.post("/research/universe/audit")
def universe_audit(
    body: UniverseAuditRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
):
    """Data quality audit for universe tickers."""
    if body.tickers:
        ticker_list = body.tickers
    else:
        rows = db.query(UniverseTicker.ticker).filter(UniverseTicker.active == True).all()
        ticker_list = [r[0] for r in rows]

    if not ticker_list:
        raise HTTPException(400, "No tickers to audit")

    results = audit_data_quality(
        ticker_list,
        min_history_days=body.min_history_days,
        lookback_years=body.lookback_years,
    )

    # Summary
    grades = [r["grade"] for r in results]
    return {
        "results": results,
        "summary": {
            "total": len(results),
            "grade_A": grades.count("A"),
            "grade_B": grades.count("B"),
            "grade_C": grades.count("C"),
            "grade_F": grades.count("F"),
        },
    }


@router.post("/research/universe/screen")
def universe_screen(
    body: UniverseScreenRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
):
    """Screen universe tickers against fundamental and data quality filters."""
    tickers = _ticker_dicts(db)
    if not tickers:
        raise HTTPException(400, "No active tickers in universe")

    results = screen_universe(
        tickers,
        min_market_cap=body.min_market_cap,
        max_pe=body.max_pe,
        min_div_yield=body.min_div_yield,
        sectors_include=body.sectors_include,
        sectors_exclude=body.sectors_exclude,
        min_history_days=body.min_history_days,
    )

    eligible_count = sum(1 for r in results if r["eligible"])
    return {
        "results": results,
        "summary": {
            "total": len(results),
            "eligible": eligible_count,
            "dropped": len(results) - eligible_count,
        },
    }


# ── Asset Research ───────────────────────────────────────────────────────────

@router.get("/research/{portfolio_id}/asset/{ticker}")
def asset_research(
    portfolio_id: str,
    ticker: str,
    db: Session = Depends(get_db),
):
    """Full asset research card for a ticker in context of a portfolio."""
    portfolio, positions = _load_portfolio(portfolio_id, db)
    portfolio_tickers = [p.ticker for p in positions]

    # Fetch prices: target ticker + benchmark + all portfolio holdings
    all_tickers = list(set([ticker, BENCHMARK] + portfolio_tickers))
    end = datetime.now()
    start = end - timedelta(days=int(DEFAULT_LOOKBACK_DAYS * 1.6))
    prices = fetch_prices(
        tuple(all_tickers),
        start.strftime("%Y-%m-%d"),
        end.strftime("%Y-%m-%d"),
    )
    if prices is None or prices.empty or ticker not in prices.columns:
        raise HTTPException(400, f"No price data available for {ticker}")

    # Asset profile
    bench_col = BENCHMARK if BENCHMARK in prices.columns else prices.columns[0]
    profile = compute_asset_profile(prices[ticker], prices[bench_col])
    if "error" in profile:
        raise HTTPException(400, profile["error"])

    # Fama-French exposure
    asset_returns = prices[ticker].pct_change().dropna()
    ff3 = compute_fama_french_exposure(asset_returns)

    # Correlation vs portfolio holdings
    holding_cols = [t for t in portfolio_tickers if t in prices.columns and t != ticker]
    if holding_cols:
        portfolio_returns = prices[holding_cols].pct_change().dropna()
        correlations = compute_asset_correlation(asset_returns, portfolio_returns)
    else:
        correlations = {
            "per_holding": [],
            "avg_correlation": None,
            "max_correlation": None,
            "max_corr_ticker": None,
            "crowding_warning": False,
        }

    # Portfolio role classification
    avg_corr = correlations.get("avg_correlation") or 0.5
    universe_ticker = db.query(UniverseTicker).filter(UniverseTicker.ticker == ticker).first()
    div_yield = universe_ticker.dividend_yield if universe_ticker else None
    role = classify_portfolio_role(profile, avg_corr, div_yield)

    return {
        "ticker": ticker,
        "portfolio_id": portfolio_id,
        "profile": profile,
        "factor_exposure": ff3,
        "correlations": correlations,
        "role": role,
    }
