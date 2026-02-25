"""Alert evaluation logic — extracted from routers/alert_rules.py.

Contains:
  - resolve_tickers: scope → ticker list
  - in_cooldown: cooldown window check
  - evaluate_signal: rule_type → signal fn → evidence dict
  - evaluate_all_enabled: full evaluate_now orchestration
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy.orm import Session

from core.cache import fetch_prices
from core.signals import signal_macd_cross, signal_rsi_threshold, signal_sma_cross
from db.models import AlertEvent, AlertRule, Position, WatchlistItem

DATA_SOURCE = "Yahoo Finance"
MAX_EVALUATE_RULES = 50
LOOKBACK_DAYS = 400

DEFAULT_PARAMS: dict[str, dict] = {
    "sma_cross_up":      {"fast": 20, "slow": 50},
    "sma_cross_down":    {"fast": 20, "slow": 50},
    "rsi_rebound":       {"window": 14, "oversold": 30},
    "rsi_fade":          {"window": 14, "overbought": 70},
    "macd_cross_up":     {"fast": 12, "slow": 26, "signal_period": 9},
    "macd_cross_down":   {"fast": 12, "slow": 26, "signal_period": 9},
    "price_cross_above": {"threshold": 0.0},
    "price_cross_below": {"threshold": 0.0},
}


def resolve_tickers(db: Session, rule: AlertRule) -> list[str]:
    """Return the list of tickers to evaluate for a given rule based on its scope."""
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


def in_cooldown(db: Session, rule: AlertRule) -> bool:
    """Return True if a trigger event for this rule was written within cooldown_days."""
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


def evaluate_signal(rule_type: str, params: dict, prices_ser: pd.Series) -> dict | None:
    """Map rule_type to the appropriate signal function and extract evidence.

    Returns an evidence dict if the rule condition is met, else None.
    Price/threshold rules return a simple dict; signal rules return the full signal dict.
    """
    if rule_type == "sma_cross_up":
        sig = signal_sma_cross(prices_ser, fast=params.get("fast", 20), slow=params.get("slow", 50))
        return sig if (sig["state"] == "BULLISH" and sig.get("last_trigger_date")) else None

    if rule_type == "sma_cross_down":
        sig = signal_sma_cross(prices_ser, fast=params.get("fast", 20), slow=params.get("slow", 50))
        return sig if (sig["state"] == "BEARISH" and sig.get("last_trigger_date")) else None

    if rule_type == "rsi_rebound":
        sig = signal_rsi_threshold(
            prices_ser, oversold=params.get("oversold", 30), overbought=params.get("overbought", 70)
        )
        return sig if sig["state"] == "OVERSOLD" else None

    if rule_type == "rsi_fade":
        sig = signal_rsi_threshold(
            prices_ser, oversold=params.get("oversold", 30), overbought=params.get("overbought", 70)
        )
        return sig if sig["state"] == "OVERBOUGHT" else None

    if rule_type == "macd_cross_up":
        sig = signal_macd_cross(prices_ser)
        return sig if (sig["state"] == "BULLISH" and sig.get("last_trigger_date")) else None

    if rule_type == "macd_cross_down":
        sig = signal_macd_cross(prices_ser)
        return sig if (sig["state"] == "BEARISH" and sig.get("last_trigger_date")) else None

    if rule_type == "price_cross_above":
        threshold = float(params.get("threshold", 0))
        if threshold > 0 and float(prices_ser.iloc[-1]) > threshold:
            return {"threshold": threshold, "current_price": round(float(prices_ser.iloc[-1]), 4)}

    if rule_type == "price_cross_below":
        threshold = float(params.get("threshold", 0))
        if threshold > 0 and float(prices_ser.iloc[-1]) < threshold:
            return {"threshold": threshold, "current_price": round(float(prices_ser.iloc[-1]), 4)}

    return None


def evaluate_all_enabled(db: Session) -> dict:
    """Evaluate all enabled alert rules as-of today.

    Resolves tickers per rule from scope, deduplicates price fetches, checks cooldown,
    evaluates signal, and writes AlertEvent rows for triggered rules.

    Returns {evaluated, triggered, skipped, as_of_date, data_source, events}.
    """
    rules = (
        db.query(AlertRule)
        .filter(AlertRule.enabled == True)  # noqa: E712
        .limit(MAX_EVALUATE_RULES)
        .all()
    )

    # Build (rule, ticker) pairs
    pairs: list[tuple[AlertRule, str]] = []
    for rule in rules:
        for t in resolve_tickers(db, rule):
            pairs.append((rule, t))

    # Deduplicate price fetches
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

    evaluated = 0
    triggered = 0
    skipped = 0
    new_events: list[dict] = []

    for rule, ticker in pairs:
        if ticker not in prices_map or len(prices_map[ticker]) < 2:
            skipped += 1
            continue

        if in_cooldown(db, rule):
            skipped += 1
            continue

        evaluated += 1
        params = rule.params_json or DEFAULT_PARAMS.get(rule.rule_type, {})
        evidence = evaluate_signal(rule.rule_type, params, prices_map[ticker])

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
                asof_date=today,
                payload_json=payload,
            )
            db.add(event)
            new_events.append(payload)

    db.commit()

    return {
        "evaluated": evaluated,
        "triggered": triggered,
        "skipped": skipped,
        "as_of_date": end_str,
        "data_source": DATA_SOURCE,
        "events": new_events,
    }
