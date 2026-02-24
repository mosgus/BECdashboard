"""POST /api/optimize — three optimization modes:
  min_variance      | max_sharpe (historical) | max_sharpe_capm (CAPM + views)
"""
from __future__ import annotations

from typing import Literal, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth import require_write_key

from core.cache import fetch_prices
from core.portfolio import (
    compute_betas,
    compute_capm_expected_returns,
    compute_equity_curve,
    compute_metrics,
    compute_portfolio_returns,
    compute_returns,
    optimize_max_sharpe,
    optimize_max_sharpe_capm,
    optimize_min_variance,
)

router = APIRouter()


class AssetBound(BaseModel):
    min: float = 0.0
    max: float = 1.0


class OptimizeRequest(BaseModel):
    tickers: list[str]
    current_weights: Optional[list[float]] = None   # equal-weight if omitted
    benchmark: str = "SPY"
    start: str = "2020-01-01"
    end: str = "2025-12-31"
    mode: Literal["min_variance", "max_sharpe", "max_sharpe_capm"] = "max_sharpe_capm"
    max_weight: float = 1.0
    # CAPM / views params (used only for max_sharpe_capm)
    rf: float = 0.0364
    market_risk_premium: float = 0.05
    market_ticker: str = "VT"
    views: Optional[dict[str, float]] = None           # ticker → undervaluation fraction
    asset_bounds: Optional[dict[str, AssetBound]] = None  # per-ticker [min, max]
    reserved_cash_pct: float = 0.0                    # 0–1, fraction of portfolio held in cash

    @field_validator("tickers")
    @classmethod
    def upper_tickers(cls, v: list[str]) -> list[str]:
        return [t.upper().strip() for t in v]

    @field_validator("market_ticker")
    @classmethod
    def upper_mkt(cls, v: str) -> str:
        return v.upper().strip()


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    records = []
    for d, row in df.iterrows():
        r = {"date": str(d.date())}
        for col in df.columns:
            v = row[col]
            r[str(col)] = None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 6)
        records.append(r)
    return records


@router.post("/optimize")
def optimize_portfolio(req: OptimizeRequest, _: None = Depends(require_write_key)) -> dict:
    if len(req.tickers) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 tickers to optimize.")

    extra = [req.benchmark]
    if req.mode == "max_sharpe_capm":
        extra.append(req.market_ticker)

    all_tickers = tuple(sorted(set(req.tickers + extra)))
    prices = fetch_prices(all_tickers, req.start, req.end)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data.")

    port_tickers = [t for t in req.tickers if t in prices.columns]
    if len(port_tickers) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 valid tickers.")

    returns = compute_returns(prices[port_tickers])

    bench_col = req.benchmark if req.benchmark in prices.columns else None
    bench_ret: Optional[pd.Series] = None
    if bench_col:
        bench_ret = prices[bench_col].pct_change().dropna()

    # Current weights
    if req.current_weights and len(req.current_weights) == len(req.tickers):
        w_map = dict(zip(req.tickers, req.current_weights))
        raw_curr = np.array([w_map.get(t, 0.0) for t in port_tickers])
    else:
        raw_curr = np.ones(len(port_tickers))
    curr_w = raw_curr / raw_curr.sum()

    # Per-asset bounds dict (using only portfolio tickers)
    asset_bounds_dict: Optional[dict[str, tuple[float, float]]] = None
    if req.asset_bounds:
        asset_bounds_dict = {
            t: (req.asset_bounds[t].min, req.asset_bounds[t].max)
            for t in port_tickers
            if t in req.asset_bounds
        }

    # ── Run optimizer ─────────────────────────────────────────────────────────
    capm_info: dict = {}
    try:
        if req.mode == "min_variance":
            opt_weights_dict = optimize_min_variance(
                returns, max_weight=req.max_weight, asset_bounds=asset_bounds_dict
            )
        elif req.mode == "max_sharpe":
            opt_weights_dict = optimize_max_sharpe(
                returns, rf=req.rf, max_weight=req.max_weight, asset_bounds=asset_bounds_dict
            )
        else:  # max_sharpe_capm
            mkt_ticker = req.market_ticker
            # Include market ticker in returns for beta calc if available
            all_ret_cols = list(port_tickers)
            if mkt_ticker in prices.columns and mkt_ticker not in all_ret_cols:
                mkt_prices = prices[[mkt_ticker]]
                mkt_ret = mkt_prices.pct_change().dropna()
                returns_for_beta = compute_returns(prices[port_tickers + [mkt_ticker]])
            else:
                returns_for_beta = returns

            betas = compute_betas(returns_for_beta, mkt_ticker)
            # Filter to only portfolio tickers
            betas_port = {t: betas[t] for t in port_tickers if t in betas}

            exp_returns = compute_capm_expected_returns(
                betas=betas_port,
                rf=req.rf,
                mrp=req.market_risk_premium,
                views=req.views,
            )

            opt_weights_dict = optimize_max_sharpe_capm(
                returns=returns,
                expected_returns=exp_returns,
                rf=req.rf,
                max_weight=req.max_weight,
                asset_bounds=asset_bounds_dict,
            )
            capm_info = {
                "betas": {t: round(float(v), 4) for t, v in betas_port.items()},
                "expected_returns": {t: round(float(v), 4) for t, v in exp_returns.items()},
                "rf": req.rf,
                "market_risk_premium": req.market_risk_premium,
                "market_ticker": mkt_ticker,
                "views": req.views or {},
            }

    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    opt_w = np.array([opt_weights_dict.get(t, 0.0) for t in port_tickers])

    # Apply reserved cash scaling: invested fraction = (1 - reserved_cash_pct)
    invested_frac = max(0.0, 1.0 - req.reserved_cash_pct)
    opt_w_scaled = opt_w * invested_frac
    curr_w_scaled = curr_w * invested_frac

    opt_ret = compute_portfolio_returns(returns, opt_w_scaled)
    curr_ret = compute_portfolio_returns(returns, curr_w_scaled)

    if bench_ret is not None:
        opt_ret, bench_ret_aligned = opt_ret.align(bench_ret, join="inner")
        curr_ret = curr_ret.loc[opt_ret.index]
    else:
        bench_ret_aligned = None

    opt_equity = compute_equity_curve(opt_ret)
    curr_equity = compute_equity_curve(curr_ret)

    eq_df = pd.DataFrame({"optimized": opt_equity, "current": curr_equity})
    if bench_ret_aligned is not None:
        eq_df["benchmark"] = compute_equity_curve(bench_ret_aligned)

    opt_metrics = compute_metrics(opt_ret, bench_ret_aligned, rf=req.rf)
    curr_metrics = compute_metrics(curr_ret, bench_ret_aligned, rf=req.rf)

    return {
        "opt_weights": {t: round(float(opt_weights_dict.get(t, 0.0)), 4) for t in port_tickers},
        "curr_weights": {t: round(float(curr_w[i]), 4) for i, t in enumerate(port_tickers)},
        "opt_metrics": opt_metrics,
        "current_metrics": curr_metrics,
        "equity_curves": _df_to_records(eq_df),
        "tickers": port_tickers,
        "mode": req.mode,
        "capm_info": capm_info,
        "reserved_cash_pct": req.reserved_cash_pct,
    }
