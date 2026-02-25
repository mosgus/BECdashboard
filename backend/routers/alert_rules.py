"""Alert rule CRUD + synchronous evaluate_now + event inbox.

Rule types and their default params_json schemas:
  sma_cross_up / sma_cross_down   → {"fast": 20, "slow": 50}
  rsi_rebound                     → {"window": 14, "oversold": 30}
  rsi_fade                        → {"window": 14, "overbought": 70}
  macd_cross_up / macd_cross_down → {"fast": 12, "slow": 26, "signal_period": 9}
  price_cross_above / below       → {"threshold": <float>}

Evaluation logic lives in core/alert_evaluation.py.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import require_write_key
from core.alert_evaluation import DEFAULT_PARAMS, evaluate_all_enabled
from db.base import get_db
from db.models import AlertEvent, AlertRule

router = APIRouter()

VALID_RULE_TYPES = frozenset({
    "sma_cross_up", "sma_cross_down",
    "rsi_rebound", "rsi_fade",
    "macd_cross_up", "macd_cross_down",
    "price_cross_above", "price_cross_below",
})

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
        "as_of_date": e.asof_date.isoformat(),
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
    return evaluate_all_enabled(db)


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
