"""Portfolio analytics endpoint."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.cache import fetch_prices_hybrid as fetch_prices
from core.portfolio import compute_equity_curve, compute_metrics, compute_returns
from core.signals import compute_all_signals
from db.base import get_db
from db.models import Position
from routers._portfolio_helpers import (
    BENCHMARK,
    DEFAULT_LOOKBACK_DAYS,
    _equity_records,
    _get_or_404,
)

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ── Analytics ────────────────────────────────────────────────────────────────

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
