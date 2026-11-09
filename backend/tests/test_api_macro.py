import pytest
from fastapi.testclient import TestClient

from app.main import app
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
