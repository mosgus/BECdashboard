"""The two ops endpoints (contract 0044): a read-only system snapshot and the stored job-run
history. No `/{something}` catch-all here, so the route-ordering trap contracts 0028/0029 hit
in app/routers/universe.py does not apply — nothing to declare above."""

from fastapi import APIRouter, HTTPException

from app.db import is_enabled
from app.ops import recent_job_runs, system_health
from app.schemas import JobRunsResponse, OpsStatus

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
