"""Rebuilds the Macro page payload from the live uploads and prices, and stores it (contract 0204).

`run_build` is the body. It runs in a separate process (`python -m app.macro_build`, started by
`request_rebuild`): `build_snapshot` peaks near 174 MB, the web process already holds pandas, scipy and
prophet, and Render's free tier has 512 MB. A subprocess hands that memory back when it exits, and a
crash in it cannot take the API down.

`request_rebuild` is non-blocking and coalescing: one build at a time, and any number of requests that
arrive during a build schedule exactly one more. The trigger lives in memory, so a restart that kills a
running build loses it; GET /macro/scorecard heals that by comparing `current_inputs_key()` with the
newest snapshot's key on every request. A key whose build failed is not retried for
RETRY_FAILED_AFTER: the same inputs fail the same way, and without the memo every page view would start
another failing subprocess.
"""

import json
import logging
import subprocess
import sys
import threading
import traceback
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from app.db import is_enabled, session
from app.jobrun import record_run
from app.macro_inputs import SLOTS, parse_inputs
from app.macro_prices import load_prices, prices_version
from app.macro_snapshot import build_snapshot
from app.macro_store import live_upload_ids, live_versions
from app.models import JobRun, MacroSnapshot

logger = logging.getLogger(__name__)

JOB_NAME = "macro_rebuild"
SNAPSHOTS_KEPT = 3
WORKER_TIMEOUT_S = 900
RETRY_FAILED_AFTER = timedelta(hours=1)
_BACKEND_DIR = Path(__file__).resolve().parents[1]
_STDERR_TAIL = 500
_NEW_YORK = ZoneInfo("America/New_York")


def inputs_key(upload_ids: Mapping[str, int], prices_version: str | None) -> str | None:
    """Names the live uploads and the price version a snapshot is built from. None until every slot has one."""
    if any(slot.id not in upload_ids for slot in SLOTS):
        return None
    return ",".join(f"{slot.id}:{upload_ids[slot.id]}" for slot in SLOTS) + "|prices:" + (prices_version or "none")


def current_inputs_key() -> str | None:
    return inputs_key(live_upload_ids(), prices_version())


def latest_snapshot_meta() -> tuple[int, str] | None:
    """(id, inputs_key) of the newest snapshot, without loading its body."""
    with session() as db:
        row = db.execute(
            select(MacroSnapshot.id, MacroSnapshot.inputs_key).order_by(MacroSnapshot.id.desc()).limit(1)).first()
    return None if row is None else (row.id, row.inputs_key)


def snapshot_body(snapshot_id: int) -> bytes:
    """The exact JSON bytes of one snapshot. KeyError when it no longer exists."""
    with session() as db:
        body = db.scalar(select(MacroSnapshot.body).where(MacroSnapshot.id == snapshot_id))
    if body is None:
        raise KeyError(snapshot_id)
    return bytes(body)


@dataclass(frozen=True)
class BuildRun:
    status: str  # job_runs.status: "success" | "partial" | "failure"
    started_at: datetime
    finished_at: datetime | None
    result: str | None  # detail["result"] ("built" | "unchanged" | "incomplete") when present
    error: str | None  # the last non-empty line of detail["error"]["message"], when present


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite (used in tests) hands a DateTime(timezone=True) column back naive; Postgres round-trips it
    tz-aware. Times are written here as UTC, so relabeling a naive read is a relabel, not a guess (the
    same pattern as autorefresh._as_utc)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def last_build() -> BuildRun | None:
    """The newest recorded rebuild run, whatever its outcome."""
    with session() as db:
        row = db.execute(
            select(JobRun.status, JobRun.started_at, JobRun.finished_at, JobRun.detail)
            .where(JobRun.job_name == JOB_NAME).order_by(JobRun.started_at.desc(), JobRun.id.desc()).limit(1)).first()
    if row is None:
        return None
    detail = row.detail if isinstance(row.detail, dict) else {}
    result = detail.get("result")
    error = detail.get("error")
    message = error.get("message") if isinstance(error, dict) else None
    lines = [line.strip() for line in message.splitlines() if line.strip()] if isinstance(message, str) else []
    return BuildRun(row.status, _as_utc(row.started_at), _as_utc(row.finished_at),
                    result if isinstance(result, str) and result else None, lines[-1] if lines else None)


def run_build(now_utc: datetime) -> str:
    """The worker body. Returns "built", "unchanged" (the newest snapshot already has this key) or
    "incomplete" (a slot has no live upload). Exceptions propagate and nothing is stored."""
    key = current_inputs_key()
    if key is None:
        return "incomplete"
    meta = latest_snapshot_meta()
    if meta is not None and meta[1] == key:
        return "unchanged"
    files = {slot_id: live.content for slot_id, live in live_versions().items()}
    built = build_snapshot(parse_inputs(files), load_prices(), now_utc.astimezone(_NEW_YORK).date())
    # allow_nan=False: a NaN in the JSON breaks JSON.parse in the browser, so such a build must fail
    # and leave the previous snapshot live.
    body = json.dumps({"generated_at": now_utc.isoformat(timespec="seconds"), **built},
                      ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    with session() as db:
        db.add(MacroSnapshot(built_at=now_utc, inputs_key=key, body=body))
        db.flush()
        newest = select(MacroSnapshot.id).order_by(MacroSnapshot.id.desc()).limit(SNAPSHOTS_KEPT)
        db.execute(delete(MacroSnapshot).where(MacroSnapshot.id.not_in(newest)))
    return "built"


# --------------------------------------------------------------------------- the trigger

_STATE_LOCK = threading.Lock()
_running = False  # a runner thread owns the build loop; set and cleared only under _STATE_LOCK
_pending = False  # a request arrived while a build was running
_runner: threading.Thread | None = None
_failed: dict[str, datetime] = {}  # inputs key -> when its build last failed; in-process, under _STATE_LOCK


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _recently_failed(key: str) -> bool:
    """Caller holds _STATE_LOCK."""
    failed_at = _failed.get(key)
    return failed_at is not None and _now() - failed_at < RETRY_FAILED_AFTER


def _note_attempt(key: str | None, failed: bool) -> None:
    if key is None:
        return
    with _STATE_LOCK:
        now = _now()
        for old in [k for k, failed_at in _failed.items() if now - failed_at >= RETRY_FAILED_AFTER]:
            del _failed[old]
        if failed:
            _failed[key] = now
        else:
            _failed.pop(key, None)


def _run_worker() -> None:
    started_at = datetime.now(timezone.utc)
    with record_run(JOB_NAME, started_at) as detail:
        try:
            done = subprocess.run([sys.executable, "-m", "app.macro_build"], cwd=_BACKEND_DIR,
                                  capture_output=True, text=True, timeout=WORKER_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            raise RuntimeError(f"the build did not finish within {WORKER_TIMEOUT_S} s") from None
        detail["result"] = done.stdout.strip()
        if done.returncode != 0:
            detail["returncode"] = done.returncode
            raise RuntimeError(done.stderr[-_STDERR_TAIL:] or f"the build exited with code {done.returncode}")


def _attempted_key() -> str | None:
    """The inputs key this run will build, read in the parent. A failure to read it (a database error)
    costs only the failure memo for this run, never the build or the runner."""
    try:
        return current_inputs_key()
    except Exception:
        logger.exception("app.macro_build: could not read the inputs key")
        return None


def _run_loop() -> None:
    global _running, _pending
    follow_up = False
    while True:
        with _STATE_LOCK:
            _pending = False
        key = _attempted_key()
        with _STATE_LOCK:
            # The first run was requested explicitly (request_rebuild already checked its key). A follow-up
            # was requested while a build ran, possibly for the very key that build then failed on.
            skip = follow_up and key is not None and _recently_failed(key)
        if not skip:
            try:
                _run_worker()
            except Exception:  # one failed build must not kill the runner; record_run has recorded it
                logger.exception("app.macro_build: the rebuild failed")
                _note_attempt(key, failed=True)
            else:
                _note_attempt(key, failed=False)
        follow_up = True
        with _STATE_LOCK:
            if not _pending:
                _running = False
                return


def request_rebuild(key: str | None = None) -> None:
    """Ask for a rebuild without waiting for it. While one runs, any number of requests cause exactly
    one more run afterwards. With a `key` whose build failed less than RETRY_FAILED_AFTER ago, nothing is
    scheduled; a request without one always is, so a manual trigger can force a run."""
    global _running, _pending, _runner
    with _STATE_LOCK:
        if key is not None and _recently_failed(key):
            return
        if _running:
            _pending = True
            return
        _running = True
        _runner = threading.Thread(target=_run_loop, name="macro-rebuild", daemon=True)
        _runner.start()


def _main() -> int:
    if not is_enabled():
        print("no database")
        return 0
    try:
        print(run_build(datetime.now(timezone.utc)))
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_main())
