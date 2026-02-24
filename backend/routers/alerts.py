"""POST /api/alerts/check — evaluate alert conditions on latest bar."""
from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from core.cache import fetch_prices
from core.indicators import (
    check_price_threshold,
    check_rsi_threshold,
    check_sma_crossover,
    simulate_email_alert,
)

router = APIRouter()


class AlertRequest(BaseModel):
    ticker: str
    alert_type: Literal["sma_crossover", "rsi_threshold", "price_threshold"]
    start: str = "2020-01-01"
    end: str = "2025-12-31"
    params: Optional[dict[str, Any]] = None

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


@router.post("/alerts/check")
def check_alert(req: AlertRequest) -> dict:
    prices = fetch_prices((req.ticker,), req.start, req.end)
    if prices is None or prices.empty or req.ticker not in prices.columns:
        raise HTTPException(status_code=422, detail=f"No data for ticker {req.ticker}.")

    series = prices[req.ticker].dropna()
    p = req.params or {}

    if req.alert_type == "sma_crossover":
        result = check_sma_crossover(series, fast=int(p.get("fast", 20)), slow=int(p.get("slow", 50)))
    elif req.alert_type == "rsi_threshold":
        result = check_rsi_threshold(series, overbought=int(p.get("overbought", 70)), oversold=int(p.get("oversold", 30)))
    elif req.alert_type == "price_threshold":
        threshold = float(p.get("threshold", series.iloc[-1]))
        direction = str(p.get("direction", "above"))
        result = check_price_threshold(series, threshold=threshold, direction=direction)
    else:
        raise HTTPException(status_code=422, detail="Unknown alert_type")

    email_payload = simulate_email_alert(req.ticker, result)
    return {**result, "email_payload": email_payload, "ticker": req.ticker, "alert_type": req.alert_type}
