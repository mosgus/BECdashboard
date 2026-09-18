from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.db import get_engine, session
from app.jobrun import JOB_RETENTION_DAYS, record_run
from app.models import Base, JobRun


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_jobrun.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite hands DateTime(timezone=True) columns back naive; relabel as UTC the same way
    every other module in this codebase does, since started_at/finished_at are always written
    as UTC values."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _all_runs() -> list[dict]:
    with session() as db:
        rows = db.execute(select(JobRun).order_by(JobRun.id)).scalars().all()
        return [
            {
                **{col.name: getattr(row, col.name) for col in JobRun.__table__.columns},
                "started_at": _as_utc(row.started_at),
                "finished_at": _as_utc(row.finished_at),
            }
            for row in rows
        ]


def _now() -> datetime:
    return datetime(2026, 9, 18, 10, 0, tzinfo=timezone.utc)


# --- status derivation -------------------------------------------------------------------------


def test_clean_exit_with_no_errors_records_success(db_mode):
    now = _now()
    with record_run("universe_refresh", now) as detail:
        detail["tickers"] = 3

    runs = _all_runs()
    assert len(runs) == 1
    assert runs[0]["job_name"] == "universe_refresh"
    assert runs[0]["status"] == "success"
    assert runs[0]["started_at"] == now
    assert runs[0]["finished_at"] is not None
    assert runs[0]["duration_ms"] is not None
    assert runs[0]["duration_ms"] >= 0
    assert runs[0]["detail"] == {"tickers": 3}


def test_truthy_errors_records_partial(db_mode):
    now = _now()
    with record_run("universe_refresh", now) as detail:
        detail["errors"] = ["AAPL"]

    runs = _all_runs()
    assert runs[0]["status"] == "partial"


def test_empty_errors_list_still_records_success(db_mode):
    """An empty list is falsy — a run that walked every ticker without incident must not be
    downgraded to partial just because an `errors` key exists."""
    now = _now()
    with record_run("universe_refresh", now) as detail:
        detail["errors"] = []

    runs = _all_runs()
    assert runs[0]["status"] == "success"


def test_exception_records_failure_with_type_and_message_and_reraises(db_mode):
    now = _now()
    with pytest.raises(RuntimeError, match="boom"):
        with record_run("news_refresh", now) as detail:
            detail["feeds"] = 7
            raise RuntimeError("boom")

    runs = _all_runs()
    assert len(runs) == 1
    assert runs[0]["status"] == "failure"
    assert runs[0]["detail"]["error"]["type"] == "RuntimeError"
    assert runs[0]["detail"]["error"]["message"] == "boom"
    # Whatever the caller had already put in detail before raising survives alongside error.
    assert runs[0]["detail"]["feeds"] == 7


def test_exception_message_is_truncated_to_500_characters(db_mode):
    now = _now()
    long_message = "x" * 1000
    with pytest.raises(RuntimeError):
        with record_run("news_refresh", now):
            raise RuntimeError(long_message)

    runs = _all_runs()
    assert len(runs[0]["detail"]["error"]["message"]) == 500


# --- duration_ms from monotonic, never negative -------------------------------------------------


def test_duration_ms_is_non_negative_even_if_wall_clock_is_far_in_the_past(db_mode):
    """now_utc (the started_at value) is caller-supplied and can be arbitrarily far from the
    real wall clock — duration_ms must come from time.monotonic(), not from subtracting
    started_at from datetime.now(), or a now_utc far in the past would produce an enormous or
    even negative-looking duration."""
    with record_run("universe_refresh", datetime(2000, 1, 1, tzinfo=timezone.utc)):
        pass

    runs = _all_runs()
    assert 0 <= runs[0]["duration_ms"] < 1000


# --- recording must never break the job it is recording -----------------------------------------


def test_a_failing_insert_does_not_propagate_and_the_body_still_completes(db_mode, monkeypatch):
    """Patch the insert itself to raise — the surrounding refresh (the `with` block's own body)
    must still run to completion and the context manager must not raise, even though nothing
    ends up recorded."""

    def _raise_session():
        raise RuntimeError("db is down")

    monkeypatch.setattr("app.jobrun.session", _raise_session)

    body_completed = False
    with record_run("universe_refresh", _now()) as detail:
        detail["tickers"] = 1
        body_completed = True

    assert body_completed is True
    assert _all_runs() == []


def test_a_failing_insert_does_not_mask_the_original_exception(db_mode, monkeypatch):
    """When the job body itself raises AND the job_runs insert also fails, the caller must see
    the original exception, not a swallowed job_runs failure."""

    def _raise_session():
        raise RuntimeError("db is down")

    monkeypatch.setattr("app.jobrun.session", _raise_session)

    with pytest.raises(RuntimeError, match="original failure"):
        with record_run("universe_refresh", _now()):
            raise RuntimeError("original failure")

    assert _all_runs() == []


# --- retention pruning ---------------------------------------------------------------------------


def test_prune_removes_rows_older_than_retention_and_keeps_the_new_one(db_mode):
    now = _now()
    with session() as db:
        db.add(
            JobRun(
                job_name="universe_refresh",
                started_at=now - timedelta(days=JOB_RETENTION_DAYS + 1),
                finished_at=now - timedelta(days=JOB_RETENTION_DAYS + 1),
                status="success",
                duration_ms=10,
                detail={},
            )
        )

    with record_run("universe_refresh", now):
        pass

    runs = _all_runs()
    assert len(runs) == 1
    assert runs[0]["started_at"] == now


def test_prune_keeps_rows_within_retention(db_mode):
    now = _now()
    with session() as db:
        db.add(
            JobRun(
                job_name="universe_refresh",
                started_at=now - timedelta(days=JOB_RETENTION_DAYS - 1),
                finished_at=now - timedelta(days=JOB_RETENTION_DAYS - 1),
                status="success",
                duration_ms=10,
                detail={},
            )
        )

    with record_run("universe_refresh", now):
        pass

    assert len(_all_runs()) == 2
