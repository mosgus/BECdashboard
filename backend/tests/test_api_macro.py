from datetime import datetime, timezone
import logging

import pytest
from sqlalchemy.exc import OperationalError
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.macro_build import current_inputs_key
from app.macro_inputs import SLOTS
from app.main import app
from app.models import Base, MacroSnapshot, MacroUpload
from app.routers import macro


@pytest.fixture
def client():
    macro._snapshot.cache_clear()
    yield TestClient(app)
    macro._snapshot.cache_clear()


def test_scorecard_serves_the_stored_snapshot(client):
    response = client.get("/macro/scorecard")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    groups = response.json()["groups"]
    assert [g["key"] for g in groups] == ["DM", "EM"]
    for group in groups:
        assert group["equity"]["rows"], group["key"]
        assert group["econ"]["rows"], group["key"]
        assert group["quadrant"], group["key"]
        assert group["charts"]["metrics"], group["key"]


def test_scorecard_returns_503_when_the_snapshot_is_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(macro, "SNAPSHOT_PATH", tmp_path / "missing.json")

    response = client.get("/macro/scorecard")

    assert response.status_code == 503
    assert response.json()["detail"] == "Macro scorecard snapshot not found"


def test_scorecard_returns_etag_and_cache_control(client):
    response = client.get("/macro/scorecard")

    assert response.status_code == 200
    assert "etag" in response.headers
    assert response.headers["etag"].startswith('"')
    assert response.headers["etag"].endswith('"')
    assert len(response.headers["etag"]) == 34  # 32 hex chars + 2 quotes
    import re
    assert re.match(r'^"[0-9a-f]{32}"$', response.headers["etag"])
    assert response.headers["cache-control"] == "no-cache"


def test_scorecard_returns_304_when_etag_matches(client):
    resp1 = client.get("/macro/scorecard")
    etag = resp1.headers["etag"]

    resp2 = client.get("/macro/scorecard", headers={"If-None-Match": etag})

    assert resp2.status_code == 304
    assert resp2.content == b""
    assert resp2.headers["etag"] == etag
    assert resp2.headers["cache-control"] == "no-cache"


def test_scorecard_returns_304_with_weak_etag(client):
    resp1 = client.get("/macro/scorecard")
    etag = resp1.headers["etag"]
    weak_etag = "W/" + etag

    resp2 = client.get("/macro/scorecard", headers={"If-None-Match": weak_etag})

    assert resp2.status_code == 304


def test_scorecard_returns_304_with_comma_separated_etags(client):
    resp1 = client.get("/macro/scorecard")
    etag = resp1.headers["etag"]

    resp2 = client.get("/macro/scorecard", headers={"If-None-Match": f'"0000", {etag}'})

    assert resp2.status_code == 304


def test_scorecard_returns_200_with_mismatched_etag(client):
    resp1 = client.get("/macro/scorecard")

    resp2 = client.get("/macro/scorecard", headers={"If-None-Match": '"0000"'})

    assert resp2.status_code == 200
    groups = resp2.json()["groups"]
    assert len(groups) > 0


def test_scorecard_etag_changes_when_content_changes(client, tmp_path, monkeypatch):
    # Write initial content
    tmp_file = tmp_path / "snapshot.json"
    tmp_file.write_text('{"groups":[1]}')
    monkeypatch.setattr(macro, "SNAPSHOT_PATH", tmp_file)

    resp1 = client.get("/macro/scorecard")
    etag1 = resp1.headers["etag"]

    # Change content and clear cache
    tmp_file.write_text('{"groups":[2]}')
    macro._snapshot.cache_clear()

    resp2 = client.get("/macro/scorecard")
    etag2 = resp2.headers["etag"]

    assert etag1 != etag2


# --- stored snapshots (contract 0204) --------------------------------------------------------
# The tests above run without a database and so cover the hard_data fallback. These use a SQLite file.

STORED_BODY = '{"groups":["stored — ünïcode"]}'.encode("utf-8")
WHEN = datetime(2026, 11, 25, 17, 0, tzinfo=timezone.utc)


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test_api_macro.db")
    Base.metadata.create_all(get_engine())
    macro._stored.cache_clear()
    yield
    macro._stored.cache_clear()


class _RebuildSpy(list):
    """One 1 per request_rebuild call; `keys` holds the key each was given."""

    def __init__(self):
        super().__init__()
        self.keys = []


@pytest.fixture
def rebuild_requests(monkeypatch):
    calls = _RebuildSpy()

    def spy(key=None):
        calls.append(1)
        calls.keys.append(key)

    monkeypatch.setattr(macro, "request_rebuild", spy)
    return calls


def _store_snapshot(key: str, body: bytes = STORED_BODY) -> int:
    with session() as db:
        row = MacroSnapshot(built_at=WHEN, inputs_key=key, body=body)
        db.add(row)
        db.flush()
        return row.id


def _fill_every_slot() -> None:
    """A live upload for each of the 15 slots, written straight to the table (the key only needs ids)."""
    with session() as db:
        for slot in SLOTS:
            db.add(MacroUpload(slot_id=slot.id, filename=slot.filename, content=b"x", size_bytes=1,
                               data_through=None, uploaded_by="Test", uploaded_at=WHEN, opens_window=False))


def test_scorecard_serves_the_newest_stored_snapshot_with_its_own_etag(client, db_mode, rebuild_requests):
    _store_snapshot("old", b'{"groups":["old"]}')
    _store_snapshot("new")
    hard_data_etag = macro._snapshot()[1]

    response = client.get("/macro/scorecard")

    assert response.status_code == 200
    assert response.content == STORED_BODY
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "no-cache"
    etag = response.headers["etag"]
    assert etag != hard_data_etag
    assert client.get("/macro/scorecard", headers={"If-None-Match": etag}).status_code == 304
    assert client.get("/macro/scorecard", headers={"If-None-Match": "W/" + etag}).status_code == 304
    assert client.get("/macro/scorecard", headers={"If-None-Match": hard_data_etag}).status_code == 200
    assert rebuild_requests == []  # not every slot is filled, so there is nothing to rebuild


def test_scorecard_picks_up_a_newer_snapshot_without_a_restart(client, db_mode, rebuild_requests):
    _store_snapshot("one", b'{"groups":["one"]}')
    assert client.get("/macro/scorecard").content == b'{"groups":["one"]}'

    _store_snapshot("two", b'{"groups":["two"]}')

    assert client.get("/macro/scorecard").content == b'{"groups":["two"]}'


def test_every_slot_filled_and_no_snapshot_requests_one_rebuild_and_serves_the_file(client, db_mode, rebuild_requests):
    _fill_every_slot()

    response = client.get("/macro/scorecard")

    assert rebuild_requests == [1]
    assert response.status_code == 200
    assert response.content == macro._snapshot()[0]


def test_a_stale_snapshot_is_served_while_a_rebuild_is_requested(client, db_mode, rebuild_requests):
    _fill_every_slot()
    _store_snapshot("built from older inputs")

    response = client.get("/macro/scorecard")

    assert response.content == STORED_BODY
    assert rebuild_requests == [1]


def test_a_current_snapshot_requests_no_rebuild(client, db_mode, rebuild_requests):
    _fill_every_slot()
    _store_snapshot(current_inputs_key())

    response = client.get("/macro/scorecard")

    assert response.content == STORED_BODY
    assert rebuild_requests == []


def test_an_empty_database_still_serves_the_file_and_requests_nothing(client, db_mode, rebuild_requests):
    response = client.get("/macro/scorecard")

    assert response.content == macro._snapshot()[0]
    assert rebuild_requests == []


def test_the_rebuild_request_carries_the_key_the_router_computed(client, db_mode, rebuild_requests):
    _fill_every_slot()
    _store_snapshot("built from older inputs")

    client.get("/macro/scorecard")

    assert rebuild_requests.keys == [current_inputs_key()]
    assert rebuild_requests.keys[0] is not None


def test_scorecard_falls_back_to_file_when_snapshot_table_is_missing(client, db_mode):
    MacroSnapshot.__table__.drop(get_engine())
    expected_body, expected_etag = macro._snapshot()

    response = client.get("/macro/scorecard")

    assert response.status_code == 200
    assert response.content == expected_body
    assert response.headers["etag"] == expected_etag


def test_scorecard_keeps_500_for_other_database_errors(client, db_mode, monkeypatch):
    def fail_to_read_meta():
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(macro, "latest_snapshot_meta", fail_to_read_meta)
    client = TestClient(app, raise_server_exceptions=False)

    response = client.get("/macro/scorecard")

    assert response.status_code == 500


def test_scorecard_logs_missing_snapshot_table_warning_once(client, db_mode, monkeypatch, caplog):
    MacroSnapshot.__table__.drop(get_engine())
    monkeypatch.setattr(macro, "_missing_snapshot_table_warning_logged", False)
    caplog.set_level(logging.WARNING, logger=macro.__name__)

    first = client.get("/macro/scorecard")
    second = client.get("/macro/scorecard")

    warnings = [record for record in caplog.records if "macro_snapshots" in record.getMessage()]
    assert first.status_code == 200
    assert second.status_code == 200
    assert len(warnings) == 1
    assert "alembic upgrade head" in warnings[0].getMessage()
