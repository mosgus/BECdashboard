"""Per-job-run bookkeeping (contract 0044): the automatic refresh sweeps write one job_runs
row per attempt, not per page view. GET /universe/strip fires on every visit, but a sweep
whose window is already claimed returns before ever entering record_run, so a gated call
writes nothing — the "did the 09:30 refresh run, and did it work?" question app_state alone
cannot answer.

record_run wraps the sweep's own body: it yields a mutable `detail` dict the caller fills with
whatever counts it has, and the status (success/partial/failure) is derived from what ends up
in that dict — or from an exception — rather than the caller computing its own status."""

import logging
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterator

from sqlalchemy import delete

from app.db import session
from app.models import JobRun

logger = logging.getLogger(__name__)

JOB_RETENTION_DAYS = 30


@contextmanager
def record_run(job_name: str, now_utc: datetime) -> Iterator[dict]:
    """Record one job run. Yields a mutable detail dict the caller fills in.

    On clean exit: status is "partial" when detail["errors"] is truthy — some tickers or feeds
    failed but the run otherwise completed — otherwise "success". On an exception, status is
    "failure", the exception's type name and a truncated message land in detail["error"], and
    the exception is re-raised unchanged: swallowing it here would turn a crash into a green
    row, which defeats the entire point of recording runs.

    duration_ms comes from a time.monotonic() pair, not wall-clock subtraction — a clock
    adjustment mid-run (NTP sync, DST) must not produce a negative duration."""
    detail: dict = {}
    start = time.monotonic()
    try:
        yield detail
    except Exception as exc:
        duration_ms = round((time.monotonic() - start) * 1000)
        detail["error"] = {"type": type(exc).__name__, "message": str(exc)[:500]}
        _record(job_name, now_utc, duration_ms, "failure", detail)
        raise
    else:
        duration_ms = round((time.monotonic() - start) * 1000)
        status = "partial" if detail.get("errors") else "success"
        _record(job_name, now_utc, duration_ms, status, detail)


def _record(job_name: str, started_at: datetime, duration_ms: int, status: str, detail: dict) -> None:
    """Recording must never break the job it is recording — a job_runs write failing is worth
    a log line, not a second failure stacked on top of (or masking a clean exit from) the
    refresh it was trying to describe."""
    try:
        with session() as db:
            row = JobRun(
                job_name=job_name,
                started_at=started_at,
                finished_at=datetime.now(timezone.utc),
                status=status,
                duration_ms=duration_ms,
                detail=detail,
            )
            db.add(row)
            db.flush()
            new_id = row.id
        _prune_old_runs(keep_id=new_id)
    except Exception:
        logger.exception("app.jobrun: failed to record job run for %s", job_name)


def _prune_old_runs(keep_id: int) -> None:
    """By age, never a wipe, and excludes the row just inserted — the same shape as
    app/briefing.py's _prune_old_summaries. Without the exclusion, a job whose caller-supplied
    started_at is itself older than JOB_RETENTION_DAYS (a backfill, a slow-clock test, a
    replayed run) would have its own just-written row deleted in the same breath."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=JOB_RETENTION_DAYS)
    with session() as db:
        db.execute(delete(JobRun).where(JobRun.started_at <= cutoff, JobRun.id != keep_id))
