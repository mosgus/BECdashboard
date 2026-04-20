"""Portfolio optimization, implementation, tilt, CAPM, Monte Carlo, and efficient frontier."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices_hybrid as fetch_prices
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
from core.rebalance import compute_implementation
from core.tilt import compute_tilt
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
    conviction_views: Optional[dict[str, float]] = None  # ticker -> u_i in %
    kappa: float = 0.05               # % annual return bump per 1% undervaluation


class ImplementationRequest(BaseModel):
    target_weights: dict[str, float]
    source: str = "manual"  # manual | optimizer | tilt


class TiltRequest(BaseModel):
    baseline: Literal["equal", "current", "optimizer"] = "current"
    optimizer_mode: Optional[str] = None  # used when baseline="optimizer"
    conviction: dict[str, float] = {}    # ticker -> u_i in %
    lam: float = 1.0
    u0: float = 20.0


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


class MonteCarloRequest(BaseModel):
    num_simulations: int = 1000
    horizon_days: int = 252
    initial_value: float = 1_000_000
    start: Optional[str] = None
    end: Optional[str] = None


class EfficientFrontierRequest(BaseModel):
    num_points: int = 30
    rf: Optional[float] = None      # None = fetch live 10Y Treasury
    market_ticker: str = "VT"       # CAPM market proxy for beta computation
    start: Optional[str] = None
    end: Optional[str] = None


# ── Optimize ─────────────────────────────────────────────────────────────────

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

    # Conviction views -> delta_mu injection (for return-based optimizers)
    views_applied = bool(body.conviction_views) and body.mode in {
        "max_sharpe", "max_sharpe_capm", "max_sortino"
    }
    delta_mu: dict[str, float] = {}
    if views_applied and body.conviction_views:
        for t in valid_tickers:
            u = body.conviction_views.get(t, 0.0)
            delta_mu[t] = body.kappa * u / 100.0  # % per 1% undervaluation -> fraction

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


# ── Implementation Worksheet + Tilt ──────────────────────────────────────────

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


# ── CAPM Optimize (Outlook tab — notebook replication) ───────────────────────

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

    # ── Action Table ─────────────────────────────────────────────────────────
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

    # ── Portfolio Metrics ────────────────────────────────────────────────────
    opt_weights_arr = np.array([target_dict.get(t, 0.0) for t in valid_tickers])
    exp_ret_arr = np.array([exp_ret.get(t, body.rf) for t in valid_tickers])
    cov_annual = returns[valid_tickers].cov().values * 252

    port_ret = float(np.dot(opt_weights_arr, exp_ret_arr))
    port_vol = float(np.sqrt(opt_weights_arr @ cov_annual @ opt_weights_arr))
    port_sharpe = (port_ret - body.rf) / port_vol if port_vol > 0 else 0.0
    port_beta = float(np.sum([betas.get(t, 0.0) * target_dict.get(t, 0.0) for t in valid_tickers]))

    # ── VaR (95% parametric) ─────────────────────────────────────────────────
    z95 = float(sp_norm.ppf(0.05))
    var_95 = {
        "daily": round(port_ret / 252 + z95 * port_vol / np.sqrt(252), 6),
        "weekly": round(port_ret / 52 + z95 * port_vol / np.sqrt(52), 6),
        "monthly": round(port_ret / 12 + z95 * port_vol / np.sqrt(12), 6),
        "quarterly": round(port_ret / 4 + z95 * port_vol / np.sqrt(4), 6),
        "annual": round(port_ret + z95 * port_vol, 6),
    }

    # ── CAPM Details ─────────────────────────────────────────────────────────
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

    # ── CAL Data (for Risk vs Return chart) ──────────────────────────────────
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


# ── Monte Carlo Simulation ──────────────────────────────────────────────────

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


# ── Efficient Frontier ──────────────────────────────────────────────────────

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
            logger.debug("Efficient frontier point computation failed", exc_info=True)
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
        logger.debug("Random portfolio metrics computation failed", exc_info=True)

    return frontier, min_var_point, max_sharpe_point, risk_parity_point, random_portfolios


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
