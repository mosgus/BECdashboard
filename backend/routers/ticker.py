"""Ticker OHLCV bars and enhanced technicals with signal states."""
from __future__ import annotations

import datetime
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_write_key
from core.indicators import compute_atr, compute_macd, compute_rsi, compute_sma
from core.provider import provider as data_provider
from core.signals import compute_all_signals

router = APIRouter()

_TODAY = lambda: datetime.date.today().isoformat()  # noqa: E731
_YEAR_AGO = lambda: (datetime.date.today() - datetime.timedelta(days=365)).isoformat()  # noqa: E731


def _clean(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if (isinstance(f, float) and np.isnan(f)) else round(f, 4)
    except (TypeError, ValueError):
        return None


@router.get("/ticker/{ticker}/bars")
def get_ticker_bars(
    ticker: str,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
) -> dict:
    """OHLCV bars for a single ticker (no auth required — read-only)."""
    ticker = ticker.upper()
    start = start or _YEAR_AGO()
    end = end or _TODAY()

    df = data_provider.get_ohlcv(ticker, start, end)
    if df is None or df.empty:
        raise HTTPException(status_code=422, detail=f"No OHLCV data for {ticker}.")

    bars = [
        {
            "date": str(idx.date()),
            "open": _clean(row["open"]),
            "high": _clean(row["high"]),
            "low": _clean(row["low"]),
            "close": _clean(row["close"]),
            "volume": None if np.isnan(float(row["volume"])) else int(row["volume"]),
        }
        for idx, row in df.iterrows()
    ]
    return {
        "ticker": ticker,
        "bars": bars,
        "as_of_date": bars[-1]["date"] if bars else None,
        "data_source": "Yahoo Finance",
    }


@router.get("/ticker/{ticker}/technicals")
def get_ticker_technicals(
    ticker: str,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    signals: int = Query(0, description="Set to 1 to include signal states"),
) -> dict:
    """Enhanced technicals: SMA20/50, RSI14, MACD, ATR14, optional signal states."""
    ticker = ticker.upper()
    start = start or _YEAR_AGO()
    end = end or _TODAY()

    df = data_provider.get_ohlcv(ticker, start, end)
    if df is None or df.empty:
        raise HTTPException(status_code=422, detail=f"No data for {ticker}.")

    close = df["close"]
    high = df["high"]
    low = df["low"]

    sma20 = compute_sma(close, 20)
    sma50 = compute_sma(close, 50)
    rsi = compute_rsi(close)
    macd_line, signal_line, histogram = compute_macd(close)
    atr = compute_atr(high, low, close)

    price_sma = [
        {
            "date": str(d.date()),
            "price": _clean(close[d]),
            "sma20": _clean(sma20[d]),
            "sma50": _clean(sma50[d]),
        }
        for d in close.index
    ]

    rsi_records = [
        {"date": str(d.date()), "rsi": _clean(rsi[d])}
        for d in rsi.index
    ]

    macd_records = [
        {
            "date": str(d.date()),
            "macd": _clean(macd_line[d]),
            "signal": _clean(signal_line[d]),
            "histogram": _clean(histogram[d]),
        }
        for d in macd_line.index
    ]

    atr_series = atr.dropna()
    atr14 = _clean(float(atr_series.iloc[-1])) if not atr_series.empty else None

    result: dict = {
        "ticker": ticker,
        "price_sma": price_sma,
        "rsi": rsi_records,
        "macd": macd_records,
        "atr14": atr14,
        "as_of_date": str(close.index[-1].date()),
        "data_source": "Yahoo Finance",
    }

    if signals:
        result["signals"] = compute_all_signals(close)

    return result
