import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import macro


@pytest.fixture
def client():
    macro._snapshot_bytes.cache_clear()
    yield TestClient(app)
    macro._snapshot_bytes.cache_clear()


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
