"""Portfolio value-series endpoint over stored adjusted closing prices."""

import math

import pandas as pd
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import is_enabled, session
from app.indicators import CLOSE_ONLY_INDICATORS, indicator_series
from app.models import PriceBar
from app.portfolio_series import build_portfolio_series
from app.schemas import PortfolioSeriesResponse
from app.signals import compute_all_signals

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

_DATABASE_NOT_CONFIGURED = "Database not configured"


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)


@router.get("/series", response_model=PortfolioSeriesResponse)
def get_portfolio_series(
    tickers: str = "", weights: str = "", cash: str = "0", include: str = ""
) -> dict:
    _require_database()
    requested = [ticker.strip().upper() for ticker in tickers.split(",") if ticker.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="At least one ticker is required")
    if len(requested) > 100:
        raise HTTPException(status_code=400, detail="At most 100 tickers may be requested")
    seen = set()
    for ticker in requested:
        if ticker in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate ticker: {ticker}")
        seen.add(ticker)

    try:
        requested_weights = [float(weight.strip()) for weight in weights.split(",")]
    except ValueError:
        requested_weights = []
    if len(requested_weights) != len(requested):
        raise HTTPException(status_code=400, detail="weights must be one number per ticker")
    if any(weight <= 0 or not math.isfinite(weight) for weight in requested_weights):
        raise HTTPException(status_code=400, detail="Every weight must be positive")
    try:
        cash_value = float(cash)
    except ValueError:
        cash_value = float("nan")
    if cash_value < 0 or not math.isfinite(cash_value):
        raise HTTPException(status_code=400, detail="cash must be zero or positive")

    include_set = {key.strip() for key in include.split(",") if key.strip()}
    for key in include_set:
        if key not in CLOSE_ONLY_INDICATORS:
            raise HTTPException(
                status_code=400,
                detail=(f"{key} is not available for a portfolio: it needs a single "
                        "security's high, low or volume"),
            )

    with session() as db:
        rows = db.execute(
            select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)
            .where(PriceBar.ticker.in_(requested), PriceBar.adj_close.is_not(None))
            .order_by(PriceBar.ticker, PriceBar.date)
        ).all()

    bars: dict[str, list[tuple]] = {}
    for ticker, bar_date, adj_close in rows:
        bars.setdefault(ticker, []).append((bar_date, adj_close))
    for ticker in requested:
        if ticker not in bars:
            raise HTTPException(status_code=404, detail=f"No stored price history for {ticker}")

    closes = {
        ticker: pd.Series([price for _, price in bars[ticker]], index=[bar_date for bar_date, _ in bars[ticker]])
        for ticker in requested
    }
    allocation = dict(zip(requested, requested_weights, strict=True))
    portfolio = build_portfolio_series(allocation, cash_value, closes)
    total_series = pd.Series(portfolio.total, index=pd.to_datetime(portfolio.dates))
    return {
        "dates": portfolio.dates,
        "value": portfolio.total,
        "cash_value": portfolio.cash_value,
        "holdings": [
            {
                "ticker": ticker,
                "weight": allocation[ticker],
                "first_bar": portfolio.first_bar[ticker],
                "last_close": portfolio.last_close[ticker],
            }
            for ticker in requested
        ],
        "series": indicator_series(include_set, total_series),
        "signals": compute_all_signals(total_series),
    }
