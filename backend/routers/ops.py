"""Ops API — system health, digest, job runs, price refresh.

Endpoints:
  GET  /api/ops/status           — lightweight health summary
  GET  /api/ops/digest           — portfolio movers + job health
  POST /api/ops/job_runs         — record a job run (idempotent: UNIQUE job_name+asof_date)
  GET  /api/ops/job_runs         — list recent job runs
  POST /api/ops/refresh_prices   — manually refresh price_history from yfinance
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import require_write_key
from core.ops.data_status import get_ops_status, get_recent_job_runs
from core.price_loader import refresh_all_prices
from db.base import get_db
from db.models import JobRun, Portfolio, Position

import logging
logger = logging.getLogger(__name__)

router = APIRouter()


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class JobRunCreate(BaseModel):
    job_name: str
    asof_date: str           # YYYY-MM-DD
    status: str              # success | failure | partial
    duration_ms: Optional[int] = None
    details_json: Optional[dict] = None


class RefreshPricesRequest(BaseModel):
    backfill_years: Optional[int] = None   # None = incremental (fill gaps since last run)
    tickers: Optional[list[str]] = None    # None = all active universe tickers




# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/ops/status")
def ops_status(db: Session = Depends(get_db)) -> dict:
    """Lightweight system health summary — safe to poll every 60s."""
    return get_ops_status(db)


@router.get("/ops/job_runs")
def list_job_runs(limit: int = 10, db: Session = Depends(get_db)) -> dict:
    return {"job_runs": get_recent_job_runs(db, limit=min(limit, 50))}


@router.post("/ops/refresh_prices")
def refresh_prices_endpoint(
    body: RefreshPricesRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Manually refresh price_history from yfinance.

    Gap-aware: fetches everything since the last stored date per ticker.
    If the laptop was off for 4 days (cron missed), this fills all 4 days.
    Takes ~5-15s for ~40 tickers under normal conditions.
    """
    started_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)
    today = date.today()

    result = refresh_all_prices(
        db,
        tickers=body.tickers,
        backfill_years=body.backfill_years,
        progress_cb=None,
    )

    finished_at = datetime.now(tz=timezone.utc).replace(tzinfo=None)
    status = (
        "success" if not result["errors"]
        else ("partial" if result["rows_upserted"] > 0 else "failure")
    )

    # Record the run so it shows up in Job Runs table
    try:
        run = JobRun(
            id=uuid.uuid4(),
            job_name="price_refresh",
            asof_date=today,
            status=status,
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=int((finished_at - started_at).total_seconds() * 1000),
            details_json={
                "tickers_processed": result["tickers_processed"],
                "batches": result["batches"],
                "rows_upserted": result["rows_upserted"],
                "backfill_years": body.backfill_years,
                "trigger": "manual",
                "errors": result["errors"][:20],
            },
        )
        db.merge(run)
        db.commit()
    except Exception:
        logger.warning("Failed to record job run", exc_info=True)

    return {
        "status": status,
        "tickers_processed": result["tickers_processed"],
        "batches": result["batches"],
        "rows_upserted": result["rows_upserted"],
        "elapsed_s": result["elapsed_s"],
        "errors": result["errors"][:5],
    }


@router.post("/ops/job_runs", status_code=200)
def record_job_run(
    body: JobRunCreate,
    db: Session = Depends(get_db),
    _: None = Depends(require_write_key),
) -> dict:
    """Record a job run result (called by jobs/run_nightly.py).

    Idempotent: if a row for (job_name, asof_date) already exists, returns
    the existing row without error.
    """
    try:
        asof = date.fromisoformat(body.asof_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="asof_date must be YYYY-MM-DD")

    existing = (
        db.query(JobRun)
        .filter(JobRun.job_name == body.job_name, JobRun.asof_date == asof)
        .first()
    )
    if existing:
        return {
            "id": str(existing.id),
            "job_name": existing.job_name,
            "asof_date": existing.asof_date.isoformat(),
            "status": existing.status,
            "already_existed": True,
        }

    now = datetime.now(tz=timezone.utc)
    run = JobRun(
        id=uuid.uuid4(),
        job_name=body.job_name,
        asof_date=asof,
        status=body.status,
        started_at=now,
        finished_at=now,
        duration_ms=body.duration_ms,
        details_json=body.details_json,
    )
    db.add(run)
    db.commit()
    return {
        "id": str(run.id),
        "job_name": run.job_name,
        "asof_date": run.asof_date.isoformat(),
        "status": run.status,
        "already_existed": False,
    }


@router.get("/ops/digest")
def ops_digest(
    portfolio_id: Optional[str] = None,
    watchlist_id: Optional[str] = None,
    asof: Optional[str] = None,
    db: Session = Depends(get_db),
) -> dict:
    """Overnight digest: portfolio movers + alert summary + job health."""
    as_of_date = asof or date.today().isoformat()

    # Portfolio movers — fetch current positions and compute 1-day return
    portfolio_movers: list[dict] = []
    if portfolio_id:
        try:
            pid = uuid.UUID(portfolio_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid portfolio_id")

        positions = db.query(Position).filter(Position.portfolio_id == pid).all()
        if positions:
            from core.cache import fetch_prices
            tickers = [p.ticker for p in positions]
            weights = {p.ticker: (p.weight or 0) for p in positions}

            # Fetch last 5 days to reliably get 1-day return
            end = date.fromisoformat(as_of_date)
            start = (end - timedelta(days=10)).isoformat()

            prices_df = fetch_prices(tuple(sorted(tickers)), start, end.isoformat())
            if prices_df is not None:
                for ticker in tickers:
                    if ticker in prices_df.columns:
                        col = prices_df[ticker].dropna()
                        if len(col) >= 2:
                            daily_ret = float((col.iloc[-1] / col.iloc[-2]) - 1)
                            portfolio_movers.append({
                                "ticker": ticker,
                                "daily_return": round(daily_ret, 6),
                                "weight": round(weights.get(ticker, 0), 4),
                            })

            portfolio_movers.sort(key=lambda x: abs(x["daily_return"]), reverse=True)
            portfolio_movers = portfolio_movers[:5]

    # Watchlist movers
    watchlist_movers: list[dict] = []
    if watchlist_id:
        try:
            wid = uuid.UUID(watchlist_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid watchlist_id")

        from db.models import WatchlistItem
        items = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == wid).all()
        if items:
            from core.cache import fetch_prices
            tickers = [i.ticker for i in items]
            end = date.fromisoformat(as_of_date)
            start = (end - timedelta(days=10)).isoformat()
            prices_df = fetch_prices(tuple(sorted(tickers)), start, end.isoformat())
            if prices_df is not None:
                for ticker in tickers:
                    if ticker in prices_df.columns:
                        col = prices_df[ticker].dropna()
                        if len(col) >= 2:
                            daily_ret = float((col.iloc[-1] / col.iloc[-2]) - 1)
                            watchlist_movers.append({
                                "ticker": ticker,
                                "daily_return": round(daily_ret, 6),
                            })
            watchlist_movers.sort(key=lambda x: abs(x["daily_return"]), reverse=True)
            watchlist_movers = watchlist_movers[:5]

    # Last job run
    last_run = db.query(JobRun).order_by(JobRun.started_at.desc()).first()
    job_run_summary = None
    if last_run:
        job_run_summary = {
            "job_name": last_run.job_name,
            "asof_date": last_run.asof_date.isoformat(),
            "status": last_run.status,
            "duration_ms": last_run.duration_ms,
            "finished_at": last_run.finished_at.isoformat() if last_run.finished_at else None,
        }

    # Build plaintext digest
    lines = [
        f"── Blue Eagle Overnight Digest — {as_of_date} ──",
        "",
    ]
    if portfolio_movers:
        mover_str = ", ".join(
            f"{m['ticker']} {'+' if m['daily_return'] >= 0 else ''}{m['daily_return']*100:.1f}%"
            for m in portfolio_movers
        )
        lines.append(f"Portfolio Top Movers: {mover_str}")
    if watchlist_movers:
        mover_str = ", ".join(
            f"{m['ticker']} {'+' if m['daily_return'] >= 0 else ''}{m['daily_return']*100:.1f}%"
            for m in watchlist_movers
        )
        lines.append(f"Watchlist Top Movers: {mover_str}")
    if job_run_summary:
        dur = f"{job_run_summary['duration_ms']/1000:.1f}s" if job_run_summary["duration_ms"] else "—"
        lines.append(f"Last Job: {job_run_summary['job_name']} {job_run_summary['status'].upper()} ({dur})")
    else:
        lines.append("Last Job: never run")
    lines.append("")
    lines.append("— Blue Eagle Capital System")

    digest_text = "\n".join(lines)

    return {
        "as_of_date": as_of_date,
        "portfolio_movers": portfolio_movers,
        "watchlist_movers": watchlist_movers,
        "job_run": job_run_summary,
        "digest_text": digest_text,
    }


