"""Tests for the DEBUG_PROBE endpoint."""

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.config import Settings
from app.routers import universe


@pytest.fixture
def app_without_probe(monkeypatch):
    """Create app without DEBUG_PROBE set.

    monkeypatch, not a bare `del os.environ[...]`: a fixture that mutates the process environment
    and never restores it makes every later test in the session order-dependent."""
    monkeypatch.delenv("DEBUG_PROBE", raising=False)

    app = FastAPI(title="Blue Eagle API")
    app.include_router(universe.router)
    return app


@pytest.fixture
def app_with_probe(monkeypatch):
    """Create app with DEBUG_PROBE=1."""
    monkeypatch.setenv("DEBUG_PROBE", "1")

    app = FastAPI(title="Blue Eagle API")
    app.include_router(universe.router)

    # Conditionally include debug router
    if os.getenv("DEBUG_PROBE") == "1":
        from app.routers import debug
        app.include_router(debug.router)

    return app


def test_debug_probe_404_when_debug_probe_unset(app_without_probe):
    """With DEBUG_PROBE unset, GET /debug/news/AAPL returns 404."""
    client = TestClient(app_without_probe)
    response = client.get("/debug/news/AAPL")
    assert response.status_code == 404


def test_debug_probe_200_with_news_data(app_with_probe, monkeypatch):
    """With DEBUG_PROBE=1, patching .news to return fake items yields 200 with news_count=2."""
    client = TestClient(app_with_probe)

    class FakeTicker:
        def __init__(self, ticker):
            self.ticker = ticker

        @property
        def news(self):
            return [
                {
                    "id": "1",
                    "content": {
                        "title": "Test Article 1",
                        "summary": "Summary 1",
                        "description": "Description 1",
                        "pubDate": "2026-09-15",
                        "provider": {"displayName": "Reuters"},
                        "canonicalUrl": "https://example.com/1",
                        "thumbnail": None,
                    },
                },
                {
                    "id": "2",
                    "content": {
                        "title": "Test Article 2",
                        "summary": "Summary 2",
                        "description": "Description 2",
                        "pubDate": "2026-09-14",
                        "provider": {"displayName": "Bloomberg"},
                        "canonicalUrl": "https://example.com/2",
                        "thumbnail": None,
                    },
                },
            ]

        @property
        def info(self):
            return {"quoteType": "EQUITY", "exchange": "NASDAQ"}

    monkeypatch.setattr("app.routers.debug.yf.Ticker", FakeTicker)

    response = client.get("/debug/news/AAPL")
    assert response.status_code == 200
    data = response.json()
    assert data["news_count"] == 2
    assert data["first_title"] == "Test Article 1"
    assert data["first_provider"] == "Reuters"
    assert data["error"] is None
    assert data["info_works"] is True


def test_debug_probe_200_with_error_when_news_raises(app_with_probe, monkeypatch):
    """With DEBUG_PROBE=1, when .news raises, response is 200 with error populated."""
    client = TestClient(app_with_probe)

    class FakeTicker:
        def __init__(self, ticker):
            self.ticker = ticker

        @property
        def news(self):
            raise RuntimeError("Connection timeout")

        @property
        def info(self):
            return {"quoteType": "EQUITY"}

    monkeypatch.setattr("app.routers.debug.yf.Ticker", FakeTicker)

    response = client.get("/debug/news/AAPL")
    assert response.status_code == 200
    data = response.json()
    assert data["news_count"] == 0
    assert "RuntimeError" in data["error"]
    assert "Connection timeout" in data["error"]


def test_debug_probe_redacts_crumb_values(app_with_probe, monkeypatch):
    """Records containing 'crumb = ' are absent from the returned log."""
    client = TestClient(app_with_probe)

    import logging

    # Create a fake ticker and patch logging to inject a crumb record
    class FakeTicker:
        def __init__(self, ticker):
            self.ticker = ticker

        @property
        def news(self):
            logger = logging.getLogger("yfinance")
            logger.debug("crumb = 'secret_crumb_abc123'")
            logger.debug("normal log message")
            return [
                {
                    "id": "1",
                    "content": {
                        "title": "Test",
                        "provider": {"displayName": "Test"},
                    },
                }
            ]

        @property
        def info(self):
            return {"quoteType": "EQUITY"}

    monkeypatch.setattr("app.routers.debug.yf.Ticker", FakeTicker)

    response = client.get("/debug/news/TEST")
    assert response.status_code == 200
    data = response.json()

    # Check that no record contains 'crumb = '
    for record in data["log"]:
        assert "crumb = '" not in record
