"""Alert rule CRUD + synchronous evaluate_now + event inbox.

Rule types and their default params_json schemas:
  sma_cross_up / sma_cross_down  → {"fast": 20, "slow": 50}
  rsi_rebound                    → {"window": 14, "oversold": 30}
  rsi_fade                       → {"window": 14, "overbought": 70}
  macd_cross_up / macd_cross_down → {"fast": 12, "slow": 26, "signal_period": 9}
  price_cross_above / below      → {"threshold": <float>}

Evaluate_now resolves tickers from scope (watchlist/portfolio/ticker),
deduplicates price fetches, then writes alert_events for any triggered rules.
Cooldown: skip if an event for the same alert_id was written within cooldown_days.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.cache import fetch_prices
from core.signals import signal_macd_cross, signal_rsi_threshold, signal_sma_cross
from db.base import get_db
from db.models import AlertEvent, AlertRule, Portfolio, Position, Watchlist, WatchlistItem

router = APIRouter()

VALID_RULE_TYPES = frozenset({
    "sma_cross_up", "sma_cross_down",
    "rsi_rebound", "rsi_fade",
    "macd_cross_up", "macd_cross_down",
    "price_cross_above", "price_cross_below",
})

DEFAULT_PARAMS: dict[str, dict] = {
    "sma_cross_up":     {"fast": 20, "slow": 50},
    "sma_cross_down":   {"fast": 20, "slow": 50},
    "rsi_rebound":      {"window": 14, "oversold": 30},
    "rsi_fade":         {"window": 14, "overbought": 70},
    "macd_cross_up":    {"fast": 12, "slow": 26, "signal_period": 9},
    "macd_cross_down":  {"fast": 12, "slow": 26, "signal_period": 9},
    "price_cross_above": {"threshold": 0.0},
    "price_cross_below": {"threshold": 0.0},
}

MAX_EVALUATE_RULES = 50
LOOKBACK_DAYS = 400


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class AlertRuleCreate(BaseModel):
    scope: str                         # 'watchlist' | 'portfolio' | 'ticker'
    scope_id: Optional[str] = None    # UUID of watchlist or portfolio
    ticker: Optional[str] = None      # required when scope='ticker'
    rule_type: str
    params_json: Optional[dict] = None
    enabled: bool = True
    cooldown_days: int = 1

    @field_validator("scope")
    @classmethod
    def valid_scope(cls, v: str) -> str:
        if v not in {"watchlist", "portfolio", "ticker"}:
            raise ValueError("scope must be 'watchlist', 'portfolio', or 'ticker'")
        return v

    @field_validator("rule_type")
    @classmethod
    def valid_rule_type(cls, v: str) -> str:
        if v not in VALID_RULE_TYPES:
            raise ValueError(f"Unknown rule_type. Valid: {sorted(VALID_RULE_TYPES)}")
        return v

    @field_validator("ticker")
    @classmethod
    def upper_ticker(cls, v: Optional[str]) -> Optional[str]:
        return v.upper().strip() if v else None


class AlertRuleUpdate(BaseModel):
    enabled: Optional[bool] = None
    params_json: Optional[dict] = None
    cooldown_days: Optional[int] = None
    rule_type: Optional[str] = None

    @field_validator("rule_type")
    @classmethod
    def valid_rule_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_RULE_TYPES:
            raise ValueError(f"Unknown rule_type. Valid: {sorted(VALID_RULE_TYPES)}")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

def _rule_dict(r: AlertRule) -> dict:
    return {
        "id": str(r.id),
        "scope": r.scope,
        "scope_id": str(r.scope_id) if r.scope_id else None,
        "ticker": r.ticker,
        "rule_type": r.rule_type,
        "params_json": r.params_json,
        "enabled": r.enabled,
        "cooldown_days": r.cooldown_days,
        "created_at": r.created_at.isoformat(),
    }


def _event_dict(e: AlertEvent) -> dict:
    return {
        "id": str(e.id),
        "alert_id": str(e.alert_id),
        "triggered_at": e.triggered_at.isoformat(),
        "asof_date": e.asof_date.isoformat(),
        "payload_json": e.payload_json,
    }


def _get_rule_or_404(db: Session, rule_id: str) -> AlertRule:
    try:
        rid = uuid.UUID(rule_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    r = db.query(AlertRule).filter(AlertRule.id == rid).first()
    if not r:
        raise HTTPException(status_code=404, detail="Alert rule not found.")
    return r


def _resolve_tickers(rule: AlertRule, db: Session) -> list[str]:
    """Resolve which tickers to evaluate for a given rule."""
    if rule.scope == "ticker":
        return [rule.ticker] if rule.ticker else []

    if rule.scope_id is None:
        return []

    if rule.scope == "watchlist":
        items = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == rule.scope_id).all()
        return [item.ticker for item in items]

    if rule.scope == "portfolio":
        positions = db.query(Position).filter(Position.portfolio_id == rule.scope_id).all()
        return [pos.ticker for pos in positions]

    return []


def _evaluate_signal(rule_type: str, params: dict, prices_ser: pd.Series) -> Optional[dict]:
    """Evaluate one rule type against a price series. Returns evidence dict or None."""
    if rule_type == "sma_cross_up":
        sig = signal_sma_cross(prices_ser, fast=params.get("fast", 20), slow=params.get("slow", 50))
        if sig["state"] == "BULLISH" and sig.get("last_trigger_date"):
            return sig

    elif rule_type == "sma_cross_down":
        sig = signal_sma_cross(prices_ser, fast=params.get("fast", 20), slow=params.get("slow", 50))
        if sig["state"] == "BEARISH" and sig.get("last_trigger_date"):
            return sig

    elif rule_type == "rsi_rebound":
        sig = signal_rsi_threshold(
            prices_ser, oversold=params.get("oversold", 30), overbought=params.get("overbought", 70)
        )
        if sig["state"] == "OVERSOLD":
            return sig

    elif rule_type == "rsi_fade":
        sig = signal_rsi_threshold(
            prices_ser, oversold=params.get("oversold", 30), overbought=params.get("overbought", 70)
        )
        if sig["state"] == "OVERBOUGHT":
            return sig

    elif rule_type == "macd_cross_up":
        sig = signal_macd_cross(prices_ser)
        if sig["state"] == "BULLISH" and sig.get("last_trigger_date"):
            return sig

    elif rule_type == "macd_cross_down":
        sig = signal_macd_cross(prices_ser)
        if sig["state"] == "BEARISH" and sig.get("last_trigger_date"):
            return sig

    elif rule_type == "price_cross_above":
        threshold = float(params.get("threshold", 0))
        if threshold > 0 and float(prices_ser.iloc[-1]) > threshold:
            return {"threshold": threshold, "current_price": round(float(prices_ser.iloc[-1]), 4)}

    elif rule_type == "price_cross_below":
        threshold = float(params.get("threshold", 0))
        if threshold > 0 and float(prices_ser.iloc[-1]) < threshold:
            return {"threshold": threshold, "current_price": round(float(prices_ser.iloc[-1]), 4)}

    return None


def _in_cooldown(rule: AlertRule, ticker: str, db: Session) -> bool:
    """Return True if a recent event for this rule+ticker is within cooldown window."""
    if rule.cooldown_days <= 0:
        return False
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=rule.cooldown_days)
    event = (
        db.query(AlertEvent)
        .filter(
            AlertEvent.alert_id == rule.id,
            AlertEvent.triggered_at >= cutoff,
        )
        .first()
    )
    return event is not None


# ── Alert Rule CRUD ───────────────────────────────────────────────────────────

@router.get("/alert_rules")
def list_rules(db: Session = Depends(get_db)) -> dict:
    rules = db.query(AlertRule).order_by(AlertRule.created_at.desc()).all()
    return {"rules": [_rule_dict(r) for r in rules]}


@router.post("/alert_rules", status_code=201)
def create_rule(
    body: AlertRuleCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    if body.scope == "ticker" and not body.ticker:
        raise HTTPException(status_code=422, detail="ticker is required when scope='ticker'")

    scope_uuid: Optional[uuid.UUID] = None
    if body.scope_id:
        try:
            scope_uuid = uuid.UUID(body.scope_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid scope_id UUID.")

    params = body.params_json or DEFAULT_PARAMS.get(body.rule_type, {})

    r = AlertRule(
        id=uuid.uuid4(),
        scope=body.scope,
        scope_id=scope_uuid,
        ticker=body.ticker,
        rule_type=body.rule_type,
        params_json=params,
        enabled=body.enabled,
        cooldown_days=body.cooldown_days,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _rule_dict(r)


@router.get("/alert_rules/events")
def list_events(limit: int = 50, db: Session = Depends(get_db)) -> dict:
    events = (
        db.query(AlertEvent)
        .order_by(AlertEvent.triggered_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return {"events": [_event_dict(e) for e in events]}


@router.post("/alert_rules/evaluate_now")
def evaluate_now(
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Evaluate all enabled rules as-of today. Writes alert_events for triggered rules."""
    rules = (
        db.query(AlertRule)
        .filter(AlertRule.enabled == True)
        .limit(MAX_EVALUATE_RULES)
        .all()
    )

    # Collect all (rule, ticker) pairs to evaluate
    pairs: list[tuple[AlertRule, str]] = []
    for rule in rules:
        tickers = _resolve_tickers(rule, db)
        for t in tickers:
            pairs.append((rule, t))

    # Deduplicate price fetches — one fetch per ticker
    all_tickers = list({t for _, t in pairs})
    today = date.today()
    start_str = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    end_str = today.isoformat()

    prices_map: dict[str, pd.Series] = {}
    if all_tickers:
        prices_df = fetch_prices(tuple(sorted(all_tickers)), start_str, end_str)
        if prices_df is not None:
            for t in all_tickers:
                if t in prices_df.columns:
                    prices_map[t] = prices_df[t].dropna()

    asof_date = today
    evaluated = 0
    triggered = 0
    skipped = 0
    new_events: list[dict] = []

    for rule, ticker in pairs:
        if ticker not in prices_map or len(prices_map[ticker]) < 2:
            skipped += 1
            continue

        if _in_cooldown(rule, ticker, db):
            skipped += 1
            continue

        evaluated += 1
        params = rule.params_json or DEFAULT_PARAMS.get(rule.rule_type, {})
        evidence = _evaluate_signal(rule.rule_type, params, prices_map[ticker])

        if evidence is not None:
            triggered += 1
            payload = {
                "ticker": ticker,
                "rule_type": rule.rule_type,
                "scope": rule.scope,
                **{k: v for k, v in evidence.items() if k not in ("signal", "label", "params")},
            }
            event = AlertEvent(
                id=uuid.uuid4(),
                alert_id=rule.id,
                triggered_at=datetime.now(tz=timezone.utc),
                asof_date=asof_date,
                payload_json=payload,
            )
            db.add(event)
            new_events.append(payload)

    db.commit()

    return {
        "evaluated": evaluated,
        "triggered": triggered,
        "skipped": skipped,
        "asof_date": asof_date.isoformat(),
        "events": new_events,
    }


# ── Rule update / delete ──────────────────────────────────────────────────────

@router.put("/alert_rules/{rule_id}")
def update_rule(
    rule_id: str,
    body: AlertRuleUpdate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    r = _get_rule_or_404(db, rule_id)
    if body.enabled is not None:
        r.enabled = body.enabled
    if body.params_json is not None:
        r.params_json = body.params_json
    if body.cooldown_days is not None:
        r.cooldown_days = body.cooldown_days
    if body.rule_type is not None:
        r.rule_type = body.rule_type
        if body.params_json is None:
            r.params_json = DEFAULT_PARAMS.get(body.rule_type, {})
    db.commit()
    return _rule_dict(r)


@router.delete("/alert_rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> None:
    r = _get_rule_or_404(db, rule_id)
    db.delete(r)
    db.commit()
