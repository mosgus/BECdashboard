"""POST /api/portfolio/metrics — returns analytics for the portfolio."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth import require_write_key
from core.cache import fetch_prices
from core.portfolio import (
    compute_drawdown,
    compute_equity_curve,
    compute_metrics,
    compute_portfolio_returns,
    compute_returns,
    compute_rolling_vol,
)

router = APIRouter()


class PortfolioRequest(BaseModel):
    tickers: list[str]
    weights: Optional[list[float]] = None  # None → equal weight
    benchmark: str = "SPY"
    start: str = "2020-01-01"
    end: str = "2025-12-31"

    @field_validator("tickers")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("tickers must not be empty")
        return [t.upper().strip() for t in v]


def _series_to_records(s: pd.Series, name: str) -> list[dict]:
    return [{"date": str(d.date()), name: None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 6)}
            for d, v in s.items()]


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    records = []
    for d, row in df.iterrows():
        r = {"date": str(d.date())}
        for col in df.columns:
            v = row[col]
            r[str(col)] = None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 6)
        records.append(r)
    return records


@router.post("/metrics")
def portfolio_metrics(req: PortfolioRequest, _: None = Depends(require_write_key)) -> dict:
    all_tickers = tuple(sorted(set(req.tickers + [req.benchmark])))
    prices = fetch_prices(all_tickers, req.start, req.end)
    if prices is None or prices.empty:
        raise HTTPException(status_code=422, detail="Could not fetch price data for given tickers/range.")

    port_tickers = [t for t in req.tickers if t in prices.columns]
    if not port_tickers:
        raise HTTPException(status_code=422, detail=f"None of the requested tickers returned data: {req.tickers}")

    missing = [t for t in req.tickers if t not in prices.columns]
    bench_col = req.benchmark if req.benchmark in prices.columns else None

    port_prices = prices[port_tickers]

    # Build weights
    if req.weights and len(req.weights) == len(req.tickers):
        # Map weights to available tickers only
        w_map = dict(zip(req.tickers, req.weights))
        raw_w = np.array([w_map.get(t, 0.0) for t in port_tickers])
    else:
        raw_w = np.ones(len(port_tickers))
    weights = raw_w / raw_w.sum()

    returns = compute_returns(port_prices)
    port_ret = compute_portfolio_returns(returns, weights)

    bench_prices_s = prices[bench_col] if bench_col else None
    bench_ret: Optional[pd.Series] = None
    if bench_prices_s is not None:
        bench_ret = bench_prices_s.pct_change().dropna()
        port_ret, bench_ret = port_ret.align(bench_ret, join="inner")

    # Equity curves
    port_equity = compute_equity_curve(port_ret)
    bench_equity = compute_equity_curve(bench_ret) if bench_ret is not None else None

    # Align equity for combined records
    eq_df = pd.DataFrame({"portfolio": port_equity})
    if bench_equity is not None:
        eq_df["benchmark"] = bench_equity
    eq_df = eq_df.dropna()

    roll_vol = compute_rolling_vol(port_ret)
    dd = compute_drawdown(port_equity)

    # Normalized prices (rebased to 1 at first valid date)
    norm = port_prices.div(port_prices.iloc[0])

    # Correlation
    corr = returns.corr()

    metrics = compute_metrics(port_ret, bench_ret)
    bench_metrics = compute_metrics(bench_ret) if bench_ret is not None else {}

    # Per-asset metrics
    assets = []
    for i, t in enumerate(port_tickers):
        m = compute_metrics(returns[t], bench_ret)
        assets.append({
            "ticker": t,
            "weight": round(float(weights[i]), 4),
            **m,
        })

    as_of_date = str(port_prices.index[-1].date()) if len(port_prices) > 0 else req.end
    return {
        "metrics": metrics,
        "bench_metrics": bench_metrics,
        "equity_curve": _df_to_records(eq_df),
        "rolling_vol": _series_to_records(roll_vol.dropna(), "vol"),
        "drawdown": _series_to_records(dd, "dd"),
        "normalized_prices": _df_to_records(norm),
        "correlation": {
            row: {col: (None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 4))
                  for col, v in vals.items()}
            for row, vals in corr.to_dict().items()
        },
        "assets": assets,
        "port_tickers": port_tickers,
        "weights": weights.tolist(),
        "missing": missing,
        "benchmark": req.benchmark,
        "as_of_date": as_of_date,
        "data_source": "Yahoo Finance",
    }
