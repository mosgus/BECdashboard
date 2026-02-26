"""Ops data status aggregator.

Summarises system health from job_runs and alert_events tables.
Never crashes — returns partial data if tables are missing or empty.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from db.models import AlertEvent, AlertRule, JobRun


def get_ops_status(db: Session) -> dict:
    """Return a lightweight system health summary."""
    today = date.today()

    # Last job run
    last_run = (
        db.query(JobRun)
        .order_by(JobRun.started_at.desc())
        .first()
    )

    last_run_dict = None
    if last_run:
        last_run_dict = {
            "id": str(last_run.id),
            "job_name": last_run.job_name,
            "asof_date": last_run.asof_date.isoformat(),
            "status": last_run.status,
            "started_at": last_run.started_at.isoformat() if last_run.started_at else None,
            "finished_at": last_run.finished_at.isoformat() if last_run.finished_at else None,
            "duration_ms": last_run.duration_ms,
        }

    # Count enabled rules
    enabled_rules = db.query(AlertRule).filter(AlertRule.enabled == True).count()  # noqa: E712

    # Count unacknowledged alert events
    new_events = db.query(AlertEvent).filter(AlertEvent.status == "new").count()

    # Check email config — prefer in-memory override (DB-backed), fall back to env vars
    try:
        from core.notify.email import is_configured
        email_configured = is_configured()
    except Exception:
        email_configured = False

    return {
        "as_of_date": today.isoformat(),
        "last_job_run": last_run_dict,
        "alert_rules_enabled": enabled_rules,
        "alert_events_new": new_events,
        "email_configured": email_configured,
        "data_source": "yfinance",
    }


def get_recent_job_runs(db: Session, limit: int = 10) -> list[dict]:
    """Return the most recent job runs."""
    runs = db.query(JobRun).order_by(JobRun.started_at.desc()).limit(limit).all()
    result = []
    for r in runs:
        result.append({
            "id": str(r.id),
            "job_name": r.job_name,
            "asof_date": r.asof_date.isoformat(),
            "status": r.status,
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "duration_ms": r.duration_ms,
            "details_json": r.details_json,
        })
    return result
