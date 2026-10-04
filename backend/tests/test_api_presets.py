from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db import get_engine, session
from app.main import app
from app.models import Base, Preset


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_presets.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _payload(**overrides) -> dict:
    payload = {
        "name": "  Income sleeve  ",
        "description": "  Dividend holdings  ",
        "csv": "ticker,shares\nAAPL,1",
    }
    payload.update(overrides)
    return payload


def test_get_presets_returns_an_empty_list_for_an_empty_table(db_mode, client):
    response = client.get("/presets")

    assert response.status_code == 200
    assert response.json() == {"presets": []}


def test_post_then_get_preset(db_mode, client):
    created = client.post("/presets", json=_payload())

    assert created.status_code == 201
    body = created.json()
    assert len(body["id"]) == 32
    assert int(body["id"], 16) >= 0
    assert body["name"] == "Income sleeve"
    assert body["csv"].endswith("\n")

    listed = client.get("/presets")
    assert listed.status_code == 200
    assert listed.json() == {"presets": [body]}


def test_get_presets_orders_by_created_at_then_id(db_mode, client):
    created_at = datetime(2026, 9, 1, tzinfo=timezone.utc)
    with session() as db:
        db.add_all(
            [
                Preset(id="later", name="Later", description="", csv="ticker,shares\n", created_at=created_at + timedelta(days=1), updated_at=created_at),
                Preset(id="b-same-time", name="B", description="", csv="ticker,shares\n", created_at=created_at, updated_at=created_at),
                Preset(id="a-same-time", name="A", description="", csv="ticker,shares\n", created_at=created_at, updated_at=created_at),
            ]
        )

    response = client.get("/presets")

    assert response.status_code == 200
    assert [preset["id"] for preset in response.json()["presets"]] == ["a-same-time", "b-same-time", "later"]


def test_put_replaces_preset_fields_and_keeps_created_at(db_mode, client):
    created = client.post("/presets", json=_payload()).json()
    response = client.put(
        f"/presets/{created['id']}",
        json=_payload(name="  Revised  ", description="  New description  ", csv="ticker,shares\nMSFT,2"),
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Revised"
    assert updated["description"] == "New description"
    assert updated["csv"] == "ticker,shares\nMSFT,2\n"
    assert updated["created_at"] == created["created_at"]
    assert updated["updated_at"] >= created["updated_at"]


def test_put_unknown_preset_returns_404(db_mode, client):
    response = client.put("/presets/missing", json=_payload())

    assert response.status_code == 404
    assert "missing" in response.json()["detail"]


def test_delete_removes_preset(db_mode, client):
    preset_id = client.post("/presets", json=_payload()).json()["id"]

    deleted = client.delete(f"/presets/{preset_id}")

    assert deleted.status_code == 204
    assert deleted.content == b""
    assert client.get("/presets").json() == {"presets": []}


def test_delete_unknown_preset_returns_404(db_mode, client):
    response = client.delete("/presets/missing")

    assert response.status_code == 404
    assert "missing" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        _payload(name="   "),
        _payload(name="x" * 81),
        _payload(csv="symbol,weight\nAAPL,100\n"),
        _payload(csv="ticker,shares\n" + "x" * (20_001 - len("ticker,shares\n"))),
    ],
)
def test_create_preset_rejects_invalid_payloads(db_mode, client, payload):
    assert client.post("/presets", json=payload).status_code == 422


def test_create_preset_accepts_a_whitespace_tolerant_header(db_mode, client):
    response = client.post("/presets", json=_payload(csv=" Ticker , shares\nAAPL,1\nCASH,0"))

    assert response.status_code == 201
    assert response.json()["csv"] == "Ticker , shares\nAAPL,1\nCASH,0\n"


def test_get_presets_returns_503_without_a_database(client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    response = client.get("/presets")

    assert response.status_code == 503
    assert response.json()["detail"] == "Database not configured"
