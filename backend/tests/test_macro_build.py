import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from openpyxl import load_workbook
from sqlalchemy import select

from app import macro_build
from app.db import get_engine, session
from app.macro_build import current_inputs_key, inputs_key, latest_snapshot_meta, request_rebuild, run_build, snapshot_body
from app.macro_inputs import SLOTS, template_workbook
from app.models import Base, JobRun, MacroSnapshot, MacroUpload

UTC = timezone.utc
BACKEND = Path(__file__).resolve().parents[1]
T = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
NOW = datetime(2026, 11, 25, 17, 0, tzinfo=UTC)
JOIN_TIMEOUT_S = 10


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_macro_build.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture(scope="module")
def templates():
    return {slot.id: template_workbook(slot.id) for slot in SLOTS}


@pytest.fixture(autouse=True)
def idle_runner():
    """The trigger's state is module-level; no test may inherit a running runner or a pending request."""
    def settle():
        runner = macro_build._runner
        if runner is not None:
            runner.join(JOIN_TIMEOUT_S)
        macro_build._running = False
        macro_build._pending = False
        macro_build._runner = None
        macro_build._failed.clear()

    settle()
    yield
    settle()


def _variant(content: bytes, n: int) -> bytes:
    wb = load_workbook(BytesIO(content))
    wb.active["A3"] = f"Sample Company variant {n}"
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


_uploaded_at = [T]


def _upload(slot_id: str, content: bytes) -> None:
    """A live version for a slot, written straight to the table: these tests are about the build, and
    macro_store's own tests cover how uploads are validated and gated."""
    _uploaded_at[0] += timedelta(seconds=1)
    with session() as db:
        db.add(MacroUpload(slot_id=slot_id, filename=f"{slot_id}.xlsx", content=content, size_bytes=len(content),
                           data_through=None, uploaded_by="Test", uploaded_at=_uploaded_at[0], opens_window=False))


def _upload_all(templates, skip: tuple[str, ...] = ()) -> None:
    for slot in SLOTS:
        if slot.id not in skip:
            _upload(slot.id, templates[slot.id])


def _snapshots() -> list:
    """(id, inputs_key, body) per stored snapshot, oldest first, as plain tuples."""
    with session() as db:
        rows = db.execute(select(MacroSnapshot.id, MacroSnapshot.inputs_key, MacroSnapshot.body)
                          .order_by(MacroSnapshot.id))
        return [(row.id, row.inputs_key, bytes(row.body)) for row in rows]


def _all_keys() -> dict[str, int]:
    return {slot.id: n for n, slot in enumerate(SLOTS, start=1)}


# --- the input key -------------------------------------------------------------------------


def test_inputs_key_names_every_slot_and_the_price_version():
    ids = _all_keys()
    assert inputs_key(ids, None) == (
        "cy1:1,cy2:2,macro:3,pmis:4,cons_spx:5,cons_ewc:6,cons_ewu:7,cons_ezu:8,cons_ewg:9,cons_ewq:10,"
        "cons_ewj:11,cons_mchi:12,cons_ewz:13,cons_ewy:14,cons_ewt:15|prices:none"
    )
    assert inputs_key(ids, "2026-11-09T21:00:00+00:00").endswith("|prices:2026-11-09T21:00:00+00:00")
    assert inputs_key({k: v for k, v in ids.items() if k != "pmis"}, None) is None
    assert inputs_key({}, None) is None


# --- run_build -----------------------------------------------------------------------------


def test_run_build_is_incomplete_with_a_slot_missing(db_mode, templates):
    _upload_all(templates, skip=("cons_ewt",))

    assert run_build(NOW) == "incomplete"
    assert _snapshots() == []


def test_run_build_stores_one_snapshot_and_then_reports_unchanged(db_mode, templates):
    _upload_all(templates)

    assert run_build(NOW) == "built"

    ((row_id, key, raw),) = _snapshots()
    body = json.loads(raw)
    assert body["generated_at"] == "2026-11-25T17:00:00+00:00"
    assert [group["key"] for group in body["groups"]] == ["DM", "EM"]
    assert key == current_inputs_key()
    assert latest_snapshot_meta() == (row_id, key)
    assert snapshot_body(row_id) == raw

    assert run_build(NOW + timedelta(hours=1)) == "unchanged"
    assert len(_snapshots()) == 1


def test_a_build_that_would_emit_nan_fails_and_stores_nothing(db_mode, templates, monkeypatch):
    _upload_all(templates)
    monkeypatch.setattr(macro_build, "build_snapshot", lambda *args: {"groups": [], "x": float("nan")})

    with pytest.raises(ValueError):
        run_build(NOW)
    assert _snapshots() == []


def test_snapshot_body_raises_for_an_unknown_id(db_mode):
    with pytest.raises(KeyError):
        snapshot_body(404)
    assert latest_snapshot_meta() is None


def test_only_the_newest_three_snapshots_are_kept(db_mode, templates):
    _upload_all(templates)
    for n in range(4):
        if n:  # a new live version of one slot gives the next build a different key
            _upload("cons_spx", _variant(templates["cons_spx"], n))
        assert run_build(NOW + timedelta(minutes=n)) == "built"

    rows = _snapshots()
    assert len(rows) == 3
    assert [json.loads(raw)["generated_at"] for _id, _key, raw in rows] == [
        "2026-11-25T17:01:00+00:00", "2026-11-25T17:02:00+00:00", "2026-11-25T17:03:00+00:00"]
    assert len({key for _id, key, _raw in rows}) == 3


def test_the_build_date_is_the_new_york_date(db_mode, templates, monkeypatch):
    _upload_all(templates)
    seen = []
    monkeypatch.setattr(macro_build, "build_snapshot", lambda inputs, prices, today: seen.append(today) or {"groups": []})

    run_build(datetime(2026, 11, 26, 2, 0, tzinfo=UTC))  # 21:00 on the 25th in New York

    assert [d.isoformat() for d in seen] == ["2026-11-25"]


# --- the trigger ---------------------------------------------------------------------------


class _FakeWorker:
    """Counts calls; the first `fail_first` of them raise. Optionally blocks each call until released."""

    def __init__(self, fail_first: int = 0, block: bool = False):
        self.calls = 0
        self.fail_first = fail_first
        self.entered = threading.Event()
        self.release = threading.Event()
        if not block:
            self.release.set()

    def __call__(self) -> None:
        self.calls += 1
        call = self.calls
        self.entered.set()
        assert self.release.wait(JOIN_TIMEOUT_S), "the test never released the fake worker"
        if call <= self.fail_first:
            raise RuntimeError("the build failed")


def _join_runner() -> None:
    runner = macro_build._runner
    assert runner is not None
    runner.join(JOIN_TIMEOUT_S)
    assert not runner.is_alive()


def test_requests_during_a_build_coalesce_into_exactly_one_more(monkeypatch):
    fake = _FakeWorker(block=True)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild()
    assert fake.entered.wait(JOIN_TIMEOUT_S)  # the runner has cleared _pending and is inside the build
    for _ in range(3):
        request_rebuild()
    fake.release.set()
    _join_runner()

    assert fake.calls == 2


def test_a_single_request_runs_exactly_one_build(monkeypatch):
    fake = _FakeWorker()
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild()
    _join_runner()

    assert fake.calls == 1


def test_a_failed_build_does_not_kill_the_runner(monkeypatch):
    fake = _FakeWorker(fail_first=1)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild()
    _join_runner()
    assert fake.calls == 1

    request_rebuild()
    _join_runner()
    assert fake.calls == 2


def test_a_failure_with_a_request_pending_still_runs_the_follow_up(monkeypatch):
    fake = _FakeWorker(fail_first=1, block=True)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild()
    assert fake.entered.wait(JOIN_TIMEOUT_S)
    request_rebuild()
    fake.release.set()
    _join_runner()

    assert fake.calls == 2


# --- the failure memo ----------------------------------------------------------------------


class _Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock(monkeypatch):
    """The module's clock function, held still until a test moves it."""
    fake = _Clock()
    monkeypatch.setattr(macro_build, "_now", fake)
    return fake


@pytest.fixture
def current_key(monkeypatch):
    """The key the runner reads in the parent; a test changes it with `current_key[0] = ...`."""
    holder = ["k1"]
    monkeypatch.setattr(macro_build, "current_inputs_key", lambda: holder[0])
    return holder


def _request_and_settle(key: str | None = None) -> bool:
    """request_rebuild(key); True when it started a runner (which is then joined)."""
    before = macro_build._runner
    request_rebuild(key)
    started = macro_build._runner is not before
    if started:
        _join_runner()
    return started


def test_a_key_that_just_failed_is_not_retried_but_another_key_and_a_keyless_request_are(monkeypatch, clock, current_key):
    fake = _FakeWorker(fail_first=1)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    assert _request_and_settle("k1") is True  # the build fails
    assert fake.calls == 1 and "k1" in macro_build._failed

    clock.now += timedelta(minutes=59)
    assert _request_and_settle("k1") is False
    assert fake.calls == 1

    current_key[0] = "k2"
    assert _request_and_settle("k2") is True
    assert fake.calls == 2

    current_key[0] = "k1"  # a manual trigger carries no key and forces a run even for a failed one
    assert _request_and_settle() is True
    assert fake.calls == 3


def test_a_failed_key_is_retried_after_an_hour(monkeypatch, clock, current_key):
    """Time is injected by monkeypatching the module's clock function (`_now`), not by editing the memo."""
    fake = _FakeWorker(fail_first=1)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    assert _request_and_settle("k1") is True
    assert _request_and_settle("k1") is False

    clock.now += macro_build.RETRY_FAILED_AFTER
    assert _request_and_settle("k1") is True
    assert fake.calls == 2


def test_a_successful_build_removes_the_key_from_the_memo(monkeypatch, clock, current_key):
    fake = _FakeWorker(fail_first=1)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    assert _request_and_settle() is True  # the runner records the attempted key, k1, and it fails
    assert set(macro_build._failed) == {"k1"}

    assert _request_and_settle() is True  # forced; this one succeeds
    assert macro_build._failed == {}
    assert _request_and_settle("k1") is True  # and nothing holds it back any more
    assert fake.calls == 3


def test_entries_older_than_the_retry_window_are_dropped_when_the_memo_is_written(monkeypatch, clock, current_key):
    fake = _FakeWorker(fail_first=2)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    assert _request_and_settle() is True  # k1 fails
    clock.now += 2 * macro_build.RETRY_FAILED_AFTER
    current_key[0] = "k2"
    assert _request_and_settle() is True  # k2 fails; writing it drops the stale k1

    assert set(macro_build._failed) == {"k2"}


def test_a_request_that_arrives_during_a_failing_build_does_not_rerun_the_failed_key(monkeypatch, clock, current_key):
    """Without this, page views during a failing build keep it failing back to back."""
    fake = _FakeWorker(fail_first=1, block=True)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild("k1")
    assert fake.entered.wait(JOIN_TIMEOUT_S)
    request_rebuild("k1")  # not failed yet, so it is accepted and marks a follow-up pending
    fake.release.set()
    _join_runner()

    assert fake.calls == 1


def test_a_request_for_new_inputs_during_a_failing_build_does_get_its_follow_up(monkeypatch, clock, current_key):
    fake = _FakeWorker(fail_first=1, block=True)
    monkeypatch.setattr(macro_build, "_run_worker", fake)

    request_rebuild("k1")
    assert fake.entered.wait(JOIN_TIMEOUT_S)
    current_key[0] = "k2"  # an upload landed during the build
    request_rebuild("k2")
    fake.release.set()
    _join_runner()

    assert fake.calls == 2


def test_an_unreadable_inputs_key_costs_the_memo_not_the_build(monkeypatch):
    def broken():
        raise RuntimeError("database unavailable")

    fake = _FakeWorker(fail_first=1)
    monkeypatch.setattr(macro_build, "_run_worker", fake)
    monkeypatch.setattr(macro_build, "current_inputs_key", broken)

    assert _request_and_settle() is True
    assert _request_and_settle("anything") is True  # nothing was memoised, and the runner is still alive
    assert fake.calls == 2 and macro_build._failed == {}


# --- the worker ----------------------------------------------------------------------------


def _job_runs() -> list:
    """(status, detail) per recorded macro_rebuild run, oldest first."""
    with session() as db:
        rows = db.execute(select(JobRun.status, JobRun.detail).where(JobRun.job_name == macro_build.JOB_NAME)
                          .order_by(JobRun.id))
        return [(row.status, row.detail) for row in rows]


def _fake_process(returncode=0, stdout="", stderr=""):
    return lambda *args, **kwargs: subprocess.CompletedProcess(args, returncode, stdout, stderr)


def test_the_worker_records_a_successful_run_with_its_result(db_mode, monkeypatch):
    monkeypatch.setattr(macro_build.subprocess, "run", _fake_process(stdout="built\n"))

    macro_build._run_worker()

    assert _job_runs() == [("success", {"result": "built"})]


def test_the_worker_records_a_failure_with_the_stderr_tail(db_mode, monkeypatch):
    stderr = "x" * 800 + "the real reason"
    monkeypatch.setattr(macro_build.subprocess, "run", _fake_process(returncode=1, stderr=stderr))

    with pytest.raises(RuntimeError):
        macro_build._run_worker()

    ((status, detail),) = _job_runs()
    assert status == "failure"
    assert detail["error"]["message"] == stderr[-500:]
    assert detail["returncode"] == 1


def test_the_worker_records_a_timeout_as_a_failure(db_mode, monkeypatch):
    def time_out(*args, **kwargs):
        raise subprocess.TimeoutExpired(args, macro_build.WORKER_TIMEOUT_S)

    monkeypatch.setattr(macro_build.subprocess, "run", time_out)

    with pytest.raises(RuntimeError):
        macro_build._run_worker()

    ((status, detail),) = _job_runs()
    assert status == "failure" and "900" in detail["error"]["message"]


def test_the_worker_runs_the_module_in_the_backend_directory(db_mode, monkeypatch):
    seen = {}

    def capture(command, **kwargs):
        seen.update(command=command, **kwargs)
        return subprocess.CompletedProcess(command, 0, "unchanged\n", "")

    monkeypatch.setattr(macro_build.subprocess, "run", capture)
    macro_build._run_worker()

    assert seen["command"] == [sys.executable, "-m", "app.macro_build"]
    assert seen["cwd"] == BACKEND and seen["timeout"] == macro_build.WORKER_TIMEOUT_S
    assert seen["capture_output"] is True and seen["text"] is True


def test_the_module_starts_in_a_fresh_process_and_reports_no_database():
    result = subprocess.run([sys.executable, "-m", "app.macro_build"], cwd=BACKEND,
                            env={**os.environ, "DATABASE_URL": ""}, capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "no database"
