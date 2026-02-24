"""POST /api/technicals — SMA, RSI, MACD for a single ticker."""
from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from auth import require_write_key

from core.cache import fetch_prices
from core.indicators import compute_macd, compute_rsi, compute_sma

router = APIRouter()


class TechnicalsRequest(BaseModel):
    ticker: str
    start: str = "2020-01-01"
    end: str = "2025-12-31"

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


def _clean(v: float) -> float | None:
    return None if (isinstance(v, float) and np.isnan(v)) else round(float(v), 4)


@router.post("/technicals")
def technicals(req: TechnicalsRequest, _: None = Depends(require_write_key)) -> dict:
    prices = fetch_prices((req.ticker,), req.start, req.end)
    if prices is None or prices.empty or req.ticker not in prices.columns:
        raise HTTPException(status_code=422, detail=f"No data for ticker {req.ticker}.")

    series = prices[req.ticker].dropna()

    sma20 = compute_sma(series, 20)
    sma50 = compute_sma(series, 50)
    rsi = compute_rsi(series)
    macd_line, signal_line, histogram = compute_macd(series)

    price_sma = []
    for d in series.index:
        price_sma.append({
            "date": str(d.date()),
            "price": _clean(series[d]),
            "sma20": _clean(sma20[d]),
            "sma50": _clean(sma50[d]),
        })

    rsi_records = [{"date": str(d.date()), "rsi": _clean(rsi[d])} for d in rsi.index]

    macd_records = []
    for d in macd_line.index:
        macd_records.append({
            "date": str(d.date()),
            "macd": _clean(macd_line[d]),
            "signal": _clean(signal_line[d]),
            "histogram": _clean(histogram[d]),
        })

    return {
        "ticker": req.ticker,
        "price_sma": price_sma,
        "rsi": rsi_records,
        "macd": macd_records,
    }
