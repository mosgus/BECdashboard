"""System status, job-run history, and the manual universe-refresh trigger."""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.autorefresh import run_manual_refresh, try_begin_manual_refresh
from app.db import is_enabled
from app.ops import recent_job_runs, system_health
from app.schemas import ForceRefreshStarted, JobRunsResponse, OpsStatus

router = APIRouter(prefix="/ops", tags=["ops"])

_DATABASE_NOT_CONFIGURED = "Database not configured"

_DEFAULT_JOB_RUNS_LIMIT = 20


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)


@router.get("/status", response_model=OpsStatus)
def get_status() -> dict:
    _require_database()
    return system_health()


@router.get("/job_runs", response_model=JobRunsResponse)
def get_job_runs(limit: int = _DEFAULT_JOB_RUNS_LIMIT) -> dict:
    """Clamping to [1, 100] happens inside recent_job_runs itself, not here — see app/ops.py."""
    _require_database()
    return {"job_runs": recent_job_runs(limit)}


@router.post("/universe/refresh", status_code=202, response_model=ForceRefreshStarted)
def force_universe_refresh(background_tasks: BackgroundTasks) -> dict:
    _require_database()
    now_utc = datetime.now(timezone.utc)
    now_et = datetime.now(ZoneInfo("America/New_York"))
    if not try_begin_manual_refresh():
        raise HTTPException(status_code=409, detail="A universe refresh is already running")
    background_tasks.add_task(run_manual_refresh, now_utc, now_et)
    return {"started": True, "started_at": now_utc}
