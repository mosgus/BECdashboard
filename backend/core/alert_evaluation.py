"""Alert evaluation logic — extracted from routers/alert_rules.py.

Contains:
  - resolve_tickers: scope → ticker list
  - fingerprint_in_cooldown: fingerprint + cooldown window check (Sprint 5)
  - evaluate_signal: rule_type → signal fn → evidence dict
  - evaluate_all_enabled: full evaluate_now orchestration
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone

import pandas as pd
from sqlalchemy.orm import Session

from core.cache import fetch_prices
from core.signals import signal_macd_cross, signal_rsi_threshold, signal_sma_cross
from db.models import AlertEvent, AlertRule, Position, WatchlistItem

# Email import is lazy to avoid circular imports at module load time
def _try_send_alert_email(events: list[dict]) -> None:
    try:
        from core.notify.email import is_configured, send_alert_email
        if is_configured() and events:
            send_alert_email(events)
    except Exception as exc:
        logger.error("alert_eval: email dispatch failed — %s", exc)

logger = logging.getLogger(__name__)

DATA_SOURCE = "Yahoo Finance"
MAX_EVALUATE_RULES = 50
LOOKBACK_DAYS = 400

# Entry rule types have direction 'up'; exit have 'dn'
ENTRY_RULES = frozenset({"sma_cross_up", "rsi_rebound", "macd_cross_up", "price_cross_above"})

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


def make_fingerprint(rule: AlertRule, ticker: str) -> str:
    """Stable dedup key: alert_id:ticker:rule_type:direction."""
    direction = "up" if rule.rule_type in ENTRY_RULES else "dn"
    return f"{rule.id}:{ticker}:{rule.rule_type}:{direction}"


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


def fingerprint_in_cooldown(db: Session, rule: AlertRule, fingerprint: str) -> bool:
    """Return True if this fingerprint was triggered within cooldown_days OR
    if there is an unresolved (non-'resolved') event for this fingerprint.

    This prevents re-spamming the same alert until the user resolves it.
    """
    if rule.cooldown_days <= 0:
        return False

    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=rule.cooldown_days)

    # Check 1: any event for this fingerprint within cooldown window
    recent = (
        db.query(AlertEvent)
        .filter(
            AlertEvent.fingerprint == fingerprint,
            AlertEvent.triggered_at >= cutoff,
        )
        .first()
    )
    if recent is not None:
        return True

    # Check 2: unresolved event for this fingerprint (regardless of age)
    unresolved = (
        db.query(AlertEvent)
        .filter(
            AlertEvent.fingerprint == fingerprint,
            AlertEvent.status != "resolved",
        )
        .order_by(AlertEvent.triggered_at.desc())
        .first()
    )
    return unresolved is not None


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

    Resolves tickers per rule from scope, deduplicates price fetches, checks
    fingerprint-based cooldown + unresolved dedup, evaluates signal, and writes
    AlertEvent rows (with ticker + fingerprint + status='new') for triggered rules.

    Returns {evaluated, triggered, skipped, warnings, as_of_date, data_source, events}.
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
                else:
                    logger.warning("alert_eval: no price data for ticker=%s", t)
        else:
            logger.warning("alert_eval: fetch_prices returned None for tickers=%s", all_tickers)

    evaluated = 0
    triggered = 0
    skipped = 0
    warnings: list[str] = []
    new_events: list[dict] = []

    for rule, ticker in pairs:
        if ticker not in prices_map or len(prices_map[ticker]) < 2:
            skipped += 1
            warnings.append(f"No price data for {ticker} — skipped rule {rule.id}")
            continue

        fingerprint = make_fingerprint(rule, ticker)

        if fingerprint_in_cooldown(db, rule, fingerprint):
            skipped += 1
            continue

        evaluated += 1
        params = rule.params_json or DEFAULT_PARAMS.get(rule.rule_type, {})

        try:
            evidence = evaluate_signal(rule.rule_type, params, prices_map[ticker])
        except Exception as exc:
            logger.error("alert_eval: error evaluating %s for %s: %s", rule.rule_type, ticker, exc)
            skipped += 1
            warnings.append(f"Evaluation error for {ticker} ({rule.rule_type}): {exc}")
            continue

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
                ticker=ticker,
                fingerprint=fingerprint,
                status="new",
            )
            db.add(event)
            new_events.append(payload)

    db.commit()

    # Send alert email if configured and events were triggered
    if new_events:
        _try_send_alert_email(new_events)

    return {
        "evaluated": evaluated,
        "triggered": triggered,
        "skipped": skipped,
        "warnings": warnings,
        "as_of_date": end_str,
        "data_source": DATA_SOURCE,
        "events": new_events,
    }
