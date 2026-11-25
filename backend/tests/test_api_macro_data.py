import io
import zipfile
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app import macro_store
from app.db import get_engine, session
from app.macro_inputs import SLOTS, parse_slot, template_workbook
from app.main import app
from app.models import Base, JobRun, MacroSnapshot
from app.routers import macro

UTC = timezone.utc
T = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
SLOT = "cons_spx"  # a constituents workbook is tiny, so these tests do not pay for a CY parse
BY = "Gunnar Balch"


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_macro_data.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture(scope="module")
def templates():
    return {slot.id: template_workbook(slot.id) for slot in SLOTS}


@pytest.fixture
def clock(monkeypatch):
    """The router's `_now`, pinned at T; `clock[0] = ...` moves it."""
    now = [T]
    monkeypatch.setattr(macro, "_now", lambda: now[0])
    return now


@pytest.fixture
def rebuilds(monkeypatch):
    """Spy on request_rebuild so no test starts a real subprocess. Holds the keys it was called with."""
    calls: list = []
    monkeypatch.setattr(macro, "request_rebuild", lambda key=None: calls.append(key))
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _upload(client, slot_id, body, by=BY, filename="export.xlsx", headers=None):
    return client.post(f"/macro/slots/{slot_id}", params={"uploaded_by": by, "filename": filename},
                       content=body, headers=headers)


def _revert(client, slot_id, by=BY):
    return client.post(f"/macro/slots/{slot_id}/revert", params={"reverted_by": by})


def _variant(template: bytes, n: int) -> bytes:
    """A valid workbook whose bytes differ per n."""
    wb = load_workbook(BytesIO(template))
    wb.active["A3"] = f"Sample Company variant {n}"
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def _fill_all(client, templates):
    for slot in SLOTS:
        assert _upload(client, slot.id, templates[slot.id]).status_code == 201, slot.id


# --------------------------------------------------------------------------- a. status, empty


def test_data_on_an_empty_database(db_mode, clock, rebuilds, client):
    response = client.get("/macro/data")

    assert response.status_code == 200
    body = response.json()
    assert [slot["id"] for slot in body["slots"]] == [slot.id for slot in SLOTS]
    assert len(body["slots"]) == 15
    assert body["slots_filled"] == 0
    assert body["serving"] == "snapshot_file"
    assert body["snapshot_built_at"] is None
    assert body["last_build"] is None
    assert body["prices"] == {"tickers": 0, "newest_fetched_at": None}
    first = body["slots"][0]
    assert first["versions"] == []
    assert first["gate"] == {"allowed": True, "opens_window": True, "window_closes_at": None, "locked_until": None}
    assert first["can_revert"] is False
    assert first["filename"] == "CY1.xlsx"
    assert [slot["market"] for slot in body["slots"][:4]] == [None] * 4
    assert body["slots"][4]["market"] is not None
    assert rebuilds == []


# --------------------------------------------------------------------------- b, c. upload


def test_upload_returns_the_slot_and_does_not_rebuild_while_incomplete(db_mode, clock, rebuilds, client, templates):
    response = _upload(client, SLOT, templates[SLOT], filename="SPXCONS.xlsx")

    assert response.status_code == 201
    slot = response.json()
    assert slot["id"] == SLOT
    assert len(slot["versions"]) == 1
    version = slot["versions"][0]
    assert version["live"] is True
    assert version["uploaded_by"] == BY
    assert version["filename"] == "SPXCONS.xlsx"
    assert version["size_bytes"] == len(templates[SLOT])
    assert slot["gate"]["allowed"] is True
    assert slot["gate"]["window_closes_at"] == (T + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    assert slot["can_revert"] is False

    status = client.get("/macro/data").json()
    assert status["slots_filled"] == 1
    assert rebuilds == []  # 14 slots are still empty


def test_the_15th_upload_asks_for_exactly_one_rebuild(db_mode, clock, rebuilds, client, templates):
    for index, slot in enumerate(SLOTS, start=1):
        assert _upload(client, slot.id, templates[slot.id]).status_code == 201
        assert len(rebuilds) == (0 if index < 15 else 1), index

    assert rebuilds[0] is not None
    assert client.get("/macro/data").json()["slots_filled"] == 15


# --------------------------------------------------------------------------- d. upload errors


def test_a_non_workbook_is_422_with_the_parser_message(db_mode, clock, rebuilds, client):
    response = _upload(client, SLOT, b"hello")

    assert response.status_code == 422
    assert ".xlsx" in response.json()["detail"]
    assert rebuilds == []


def test_a_blank_signature_is_400(db_mode, clock, rebuilds, client, templates):
    # Written into the URL by hand: `params=` would percent-encode the % of "%20" a second time.
    response = client.post(f"/macro/slots/{SLOT}?uploaded_by=%20%20&filename=x.xlsx", content=templates[SLOT])

    assert response.status_code == 400
    assert rebuilds == []


def test_an_unknown_slot_is_404(db_mode, clock, rebuilds, client, templates):
    assert _upload(client, "nope", templates[SLOT]).status_code == 404
    assert _revert(client, "nope").status_code == 404


def test_an_oversized_content_length_is_413_before_the_body_is_read(db_mode, clock, rebuilds, client, templates):
    # A small valid body with an overstated header: only the header check can refuse it, because the
    # store would accept the body.
    overstated = {"Content-Length": str(macro_store.MAX_UPLOAD_BYTES + 1)}

    response = _upload(client, SLOT, templates[SLOT], headers=overstated)

    assert response.status_code == 413
    assert client.get("/macro/data").json()["slots_filled"] == 0
    assert rebuilds == []


def test_a_chunked_oversized_body_is_413_after_reading(db_mode, clock, rebuilds, client, templates, monkeypatch):
    monkeypatch.setattr(macro_store, "MAX_UPLOAD_BYTES", 10)

    def chunks():
        yield templates[SLOT][:100]
        yield templates[SLOT][100:]

    response = _upload(client, SLOT, chunks())  # a generator body sends no Content-Length

    assert response.status_code == 413
    assert rebuilds == []


def test_a_locked_slot_is_429_with_the_unlock_time(db_mode, clock, rebuilds, client, templates):
    assert _upload(client, SLOT, templates[SLOT]).status_code == 201
    clock[0] = T + timedelta(hours=1)

    response = _upload(client, SLOT, templates[SLOT])

    assert response.status_code == 429
    detail = response.json()["detail"]
    assert detail["unlocks_at"] == (T + timedelta(hours=24)).isoformat()
    assert SLOT in detail["message"]
    assert rebuilds == []


def test_missing_query_parameters_are_422(db_mode, clock, rebuilds, client, templates):
    assert client.post(f"/macro/slots/{SLOT}?filename=x.xlsx", content=templates[SLOT]).status_code == 422
    assert client.post(f"/macro/slots/{SLOT}?uploaded_by={BY}", content=templates[SLOT]).status_code == 422
    assert client.post(f"/macro/slots/{SLOT}/revert").status_code == 422


# --------------------------------------------------------------------------- e. revert


def test_revert_makes_the_older_version_live(db_mode, clock, rebuilds, client, templates):
    first = _upload(client, SLOT, templates[SLOT], filename="first.xlsx").json()["versions"][0]
    clock[0] = T + timedelta(minutes=10)
    assert _upload(client, SLOT, _variant(templates[SLOT], 2), filename="second.xlsx").status_code == 201
    clock[0] = T + timedelta(minutes=20)

    response = _revert(client, SLOT, by="Someone Else")

    assert response.status_code == 200
    slot = response.json()
    assert [(v["filename"], v["live"]) for v in slot["versions"]] == [("second.xlsx", False), ("first.xlsx", True)]
    assert slot["versions"][0]["reverted_by"] == "Someone Else"
    assert slot["versions"][1]["id"] == first["id"]
    assert slot["can_revert"] is False


def test_revert_with_one_version_is_409(db_mode, clock, rebuilds, client, templates):
    assert _upload(client, SLOT, templates[SLOT]).status_code == 201

    response = _revert(client, SLOT)

    assert response.status_code == 409
    assert SLOT in response.json()["detail"]


def test_revert_with_a_blank_signature_is_400(db_mode, clock, rebuilds, client):
    assert client.post(f"/macro/slots/{SLOT}/revert?reverted_by=%20").status_code == 400


def test_a_revert_with_every_slot_filled_asks_for_a_rebuild(db_mode, clock, rebuilds, client, templates):
    _fill_all(client, templates)
    clock[0] = T + timedelta(minutes=10)
    assert _upload(client, SLOT, _variant(templates[SLOT], 2)).status_code == 201
    rebuilds.clear()

    assert _revert(client, SLOT).status_code == 200

    assert len(rebuilds) == 1
    assert rebuilds[0] is not None


def test_a_revert_while_incomplete_does_not_rebuild(db_mode, clock, rebuilds, client, templates):
    assert _upload(client, SLOT, templates[SLOT]).status_code == 201
    clock[0] = T + timedelta(minutes=10)
    assert _upload(client, SLOT, _variant(templates[SLOT], 2)).status_code == 201

    assert _revert(client, SLOT).status_code == 200
    assert rebuilds == []


# --------------------------------------------------------------------------- f. no database


def test_data_upload_and_revert_are_503_without_a_database(clock, rebuilds, client, templates):
    assert client.get("/macro/data").status_code == 503
    assert _upload(client, SLOT, templates[SLOT]).status_code == 503
    assert _revert(client, SLOT).status_code == 503
    assert rebuilds == []


def test_templates_need_no_database(client, templates):
    response = client.get("/macro/templates/cy1")

    assert response.status_code == 200


# --------------------------------------------------------------------------- g. templates


def test_a_template_is_an_accepted_sample_attachment(client):
    response = client.get("/macro/templates/cy1")

    assert response.status_code == 200
    assert response.headers["content-type"] == macro.XLSX_MEDIA_TYPE
    assert "CY1_sample.xlsx" in response.headers["content-disposition"]
    assert "attachment" in response.headers["content-disposition"]
    assert parse_slot("cy1", response.content).slot_id == "cy1"


def test_the_zip_holds_all_15_templates(client):
    response = client.get("/macro/templates.zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "macro_sample_data.zip" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        expected = {slot.filename.replace(".xlsx", "_sample.xlsx"): slot for slot in SLOTS}
        assert len(names) == 15
        assert set(names) == set(expected)
        for name, slot in expected.items():
            assert parse_slot(slot.id, archive.read(name)).slot_id == slot.id


def test_an_unknown_template_is_404(client):
    assert client.get("/macro/templates/nope").status_code == 404


# --------------------------------------------------------------------------- h. last build


def test_last_build_reports_the_newest_failure_with_its_last_line(db_mode, clock, rebuilds, client):
    message = "Traceback ...\nValueError: Out of range float values are not JSON compliant\n"
    with session() as db:
        db.add(JobRun(job_name="macro_rebuild", started_at=T - timedelta(hours=2), finished_at=T - timedelta(hours=2),
                      status="success", detail={"result": "built"}))
        db.add(JobRun(job_name="macro_rebuild", started_at=T, finished_at=T + timedelta(seconds=5), status="failure",
                      detail={"error": {"type": "RuntimeError", "message": message}}))
        db.add(JobRun(job_name="universe_refresh", started_at=T + timedelta(hours=1), status="success", detail={}))

    build = client.get("/macro/data").json()["last_build"]

    assert build["status"] == "failure"
    assert build["error"] == "ValueError: Out of range float values are not JSON compliant"
    assert build["result"] is None
    assert build["finished_at"] is not None


def test_last_build_carries_the_result_of_a_good_run(db_mode, clock, rebuilds, client):
    with session() as db:
        db.add(JobRun(job_name="macro_rebuild", started_at=T, finished_at=T, status="success",
                      detail={"result": "built"}))

    build = client.get("/macro/data").json()["last_build"]

    assert (build["status"], build["result"], build["error"]) == ("success", "built", None)


def test_serving_is_uploads_once_a_snapshot_is_stored(db_mode, clock, rebuilds, client):
    with session() as db:
        db.add(MacroSnapshot(built_at=T, inputs_key="k", body=b"{}"))

    body = client.get("/macro/data").json()

    assert body["serving"] == "uploads"
    assert datetime.fromisoformat(body["snapshot_built_at"]) == T
