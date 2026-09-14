from fastapi.testclient import TestClient

import pytest

from app.cache import clear, store, store_fundamentals
from app.db import get_engine
from app.main import app
from app.models import Base
from tests.test_universe import _fundamentals, _history


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_api_universe.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _patch_fetches(monkeypatch, fundamentals_overrides=None, has_history=True):
    def fake_fetch_fundamentals(ticker):
        data = _fundamentals(ticker, **(fundamentals_overrides or {}))
        store_fundamentals(ticker, data)
        return data

    def fake_fetch_history(ticker, start=None, end=None):
        df = _history(["2016-01-04", "2016-01-05"])
        store(ticker, df)
        return df

    # add() now checks symbol_has_history before ever reaching fetch_history/fetch_fundamentals.
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: has_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", fake_fetch_history)


# --- 14. GET /universe returns 200 and a JSON list -----------------------------------------


def test_get_universe_returns_200_and_list(db_mode, client):
    response = client.get("/universe")
    assert response.status_code == 200
    assert response.json() == []


# --- 15. POST /universe: 201, duplicate 409, unknown symbol 404 ---------------------------


def test_post_universe_201_then_duplicate_409(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)

    first = client.post("/universe", json={"ticker": "AAPL"})
    assert first.status_code == 201
    assert first.json()["ticker"] == "AAPL"

    duplicate = client.post("/universe", json={"ticker": "AAPL"})
    assert duplicate.status_code == 409
    assert "AAPL" in duplicate.json()["detail"]


def test_post_universe_unknown_symbol_404(db_mode, client, monkeypatch):
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: False)

    response = client.post("/universe", json={"ticker": "NOTREAL"})
    assert response.status_code == 404
    assert "NOTREAL" in response.json()["detail"]


def test_post_universe_blank_ticker_422(db_mode, client):
    response = client.post("/universe", json={"ticker": "   "})
    assert response.status_code == 422


# --- 16. GET /universe/{ticker} returns 404 for an unknown ticker -------------------------


def test_get_ticker_404_for_unknown(db_mode, client):
    response = client.get("/universe/NOPE")
    assert response.status_code == 404
    assert "NOPE" in response.json()["detail"]


def test_get_ticker_200_after_add(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/aapl")
    assert response.status_code == 200
    assert response.json()["ticker"] == "AAPL"


# --- 17. POST /universe/{ticker}/refresh returns 200 with the action ----------------------


def test_post_refresh_200_with_action(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    fake_summary = {
        "ticker": "AAPL",
        "action": "none",
        "last_session": None,
        "bars_before": 2,
        "bars_after": 2,
        "drift_detected": False,
    }
    monkeypatch.setattr(
        "app.universe.refresh_ticker", lambda ticker, force=False: fake_summary
    )

    response = client.post("/universe/AAPL/refresh")
    assert response.status_code == 200
    assert response.json()["action"] == "none"


def test_post_refresh_404_when_not_in_universe(db_mode, client):
    response = client.post("/universe/NOPE/refresh")
    assert response.status_code == 404


# --- 18. GET /universe includes market_cap, trailing_pe, dividend_yield in response -------


def test_get_universe_includes_three_new_fields(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "MSFT"})

    response = client.get("/universe")
    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 1

    entry = entries[0]
    assert "market_cap" in entry
    assert "trailing_pe" in entry
    assert "dividend_yield" in entry
    assert entry["market_cap"] == 1_000_000_000
    assert entry["trailing_pe"] == 20.0
    assert entry["dividend_yield"] == 0.33


# --- 11. GET /universe includes has_fundamentals on every row -----------------------------


def test_get_universe_includes_has_fundamentals(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "MSFT"})

    response = client.get("/universe")
    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 1
    assert entries[0]["has_fundamentals"] is True


def test_post_universe_succeeds_when_fundamentals_unavailable(db_mode, client, monkeypatch):
    """The production bug, reproduced end-to-end through the API: Yahoo's fundamentals
    endpoint failing (crumb/401) must not turn into a 404 for a real symbol."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: True)
    monkeypatch.setattr("app.universe.fetch_fundamentals", lambda ticker: None)

    def fake_fetch_history(ticker, start=None, end=None):
        df = _history(["2016-01-04", "2016-01-05"])
        store(ticker, df)
        return df

    monkeypatch.setattr("app.universe.fetch_history", fake_fetch_history)

    response = client.post("/universe", json={"ticker": "SPY"})
    assert response.status_code == 201
    body = response.json()
    assert body["ticker"] == "SPY"
    assert body["bar_count"] == 2
    assert body["has_fundamentals"] is False
    assert body["short_name"] is None


# --- 20. degraded mode: every universe endpoint 503, /health still 200 --------------------


def test_degraded_mode_returns_503_for_every_universe_endpoint(client):
    assert client.get("/health").status_code == 200

    assert client.get("/universe").status_code == 503
    assert client.post("/universe", json={"ticker": "AAPL"}).status_code == 503
    assert client.get("/universe/AAPL").status_code == 503
    assert client.post("/universe/AAPL/refresh").status_code == 503

    assert client.get("/health").status_code == 200


def test_degraded_mode_error_body(client):
    response = client.get("/universe")
    assert response.json() == {"detail": "Database not configured"}


# --- 21. no error body contains a connection string ---------------------------------------


def test_error_bodies_never_contain_a_connection_string(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    responses = [
        client.post("/universe", json={"ticker": "AAPL"}),  # 409
        client.get("/universe/NOPE"),  # 404
        client.post("/universe/NOPE/refresh"),  # 404
    ]

    db_url = str(db_mode.url)
    for response in responses:
        body = response.text
        assert db_url not in body
        assert "sqlite://" not in body
        assert "postgresql://" not in body
        assert "postgres://" not in body
