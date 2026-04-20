"""Portfolio candidates and indicator configuration endpoints."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices_hybrid as fetch_prices
from core.signals import compute_all_signals
from db.base import get_db
from db.models import PortfolioCandidate, PortfolioIndicatorConfig
from routers._portfolio_helpers import _assert_universe, _get_or_404

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class CandidateAdd(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


class IndicatorConfigUpsert(BaseModel):
    ticker: str
    indicator_type: Literal["sma", "rsi", "macd", "atr"]
    params_json: Optional[dict] = None
    enabled: bool = True

    @field_validator("ticker")
    @classmethod
    def upper(cls, v: str) -> str:
        return v.upper().strip()


# ── Local helpers ────────────────────────────────────────────────────────────

CANDIDATE_LOOKBACK_DAYS = 400


def _candidate_refresh_rows(portfolio_id: uuid.UUID, db: Session) -> list[dict]:
    """Fetch prices + signals for all candidates. Returns list of row dicts."""
    candidates = (
        db.query(PortfolioCandidate)
        .filter(PortfolioCandidate.portfolio_id == portfolio_id)
        .order_by(PortfolioCandidate.ticker)
        .all()
    )
    if not candidates:
        return []

    tickers = [c.ticker for c in candidates]
    today = date.today()
    start_str = (today - timedelta(days=CANDIDATE_LOOKBACK_DAYS)).isoformat()
    end_str = today.isoformat()

    prices = fetch_prices(tuple(sorted(tickers)), start_str, end_str)

    rows = []
    for ticker in tickers:
        if prices is None or ticker not in prices.columns:
            rows.append({"ticker": ticker, "last_close": None, "as_of_date": None, "signals": []})
            continue
        ser = prices[ticker].dropna()
        if ser.empty:
            rows.append({"ticker": ticker, "last_close": None, "as_of_date": None, "signals": []})
            continue
        last_close = round(float(ser.iloc[-1]), 4)
        as_of_date = str(ser.index[-1].date())
        sigs = compute_all_signals(ser) if len(ser) >= 50 else []
        rows.append({"ticker": ticker, "last_close": last_close, "as_of_date": as_of_date, "signals": sigs})

    return rows


def _config_dict(cfg: PortfolioIndicatorConfig) -> dict:
    return {
        "id": str(cfg.id),
        "portfolio_id": str(cfg.portfolio_id),
        "ticker": cfg.ticker,
        "indicator_type": cfg.indicator_type,
        "params_json": cfg.params_json,
        "enabled": cfg.enabled,
        "created_at": cfg.created_at.isoformat(),
    }


# ── Portfolio Candidates ─────────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/candidates")
def list_candidates(
    portfolio_id: str,
    db: Session = Depends(get_db),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    rows = _candidate_refresh_rows(p.id, db)
    as_of = rows[0]["as_of_date"] if rows else date.today().isoformat()
    return {
        "portfolio_id": portfolio_id,
        "rows": rows,
        "as_of_date": as_of,
        "data_source": "Yahoo Finance",
    }


@router.post("/portfolios/{portfolio_id}/candidates", status_code=201)
def add_candidate(
    portfolio_id: str,
    body: CandidateAdd,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    _assert_universe(db, body.ticker)
    existing = db.query(PortfolioCandidate).filter(
        PortfolioCandidate.portfolio_id == p.id,
        PortfolioCandidate.ticker == body.ticker,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"{body.ticker} is already a candidate.")
    db.add(PortfolioCandidate(portfolio_id=p.id, ticker=body.ticker))
    db.commit()
    return {"portfolio_id": portfolio_id, "ticker": body.ticker}


@router.delete("/portfolios/{portfolio_id}/candidates/{ticker}", status_code=204)
def remove_candidate(
    portfolio_id: str,
    ticker: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    obj = db.query(PortfolioCandidate).filter(
        PortfolioCandidate.portfolio_id == p.id,
        PortfolioCandidate.ticker == ticker,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{ticker} not in candidates.")
    db.delete(obj)
    db.commit()


@router.post("/portfolios/{portfolio_id}/candidates/refresh")
def refresh_candidates(
    portfolio_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    rows = _candidate_refresh_rows(p.id, db)
    as_of = rows[0]["as_of_date"] if rows else date.today().isoformat()
    return {
        "portfolio_id": portfolio_id,
        "rows": rows,
        "as_of_date": as_of,
        "data_source": "Yahoo Finance",
    }


# ── Indicator Configs ────────────────────────────────────────────────────────

@router.get("/portfolios/{portfolio_id}/indicator_configs")
def list_indicator_configs(
    portfolio_id: str,
    db: Session = Depends(get_db),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    configs = (
        db.query(PortfolioIndicatorConfig)
        .filter(PortfolioIndicatorConfig.portfolio_id == p.id)
        .order_by(PortfolioIndicatorConfig.ticker, PortfolioIndicatorConfig.indicator_type)
        .all()
    )
    return {"configs": [_config_dict(c) for c in configs]}


@router.post("/portfolios/{portfolio_id}/indicator_configs", status_code=201)
def upsert_indicator_config(
    portfolio_id: str,
    body: IndicatorConfigUpsert,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    p = _get_or_404(db, portfolio_id)
    existing = db.query(PortfolioIndicatorConfig).filter(
        PortfolioIndicatorConfig.portfolio_id == p.id,
        PortfolioIndicatorConfig.ticker == body.ticker,
        PortfolioIndicatorConfig.indicator_type == body.indicator_type,
    ).first()
    if existing:
        existing.params_json = body.params_json
        existing.enabled = body.enabled
        db.commit()
        return _config_dict(existing)
    cfg = PortfolioIndicatorConfig(
        portfolio_id=p.id,
        ticker=body.ticker,
        indicator_type=body.indicator_type,
        params_json=body.params_json,
        enabled=body.enabled,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return _config_dict(cfg)


@router.delete("/portfolios/{portfolio_id}/indicator_configs/{ticker}/{indicator}", status_code=204)
def delete_indicator_config(
    portfolio_id: str,
    ticker: str,
    indicator: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    p = _get_or_404(db, portfolio_id)
    ticker = ticker.upper()
    obj = db.query(PortfolioIndicatorConfig).filter(
        PortfolioIndicatorConfig.portfolio_id == p.id,
        PortfolioIndicatorConfig.ticker == ticker,
        PortfolioIndicatorConfig.indicator_type == indicator,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"Config {ticker}/{indicator} not found.")
    db.delete(obj)
    db.commit()
