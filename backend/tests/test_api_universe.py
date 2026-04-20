"""Integration tests for universe management."""
import io

import pytest


class TestUniverseCRUD:
    def test_add_ticker(self, client):
        res = client.post(
            "/api/universe", json={"ticker": "AAPL", "name": "Apple Inc"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ticker"] == "AAPL"
        assert data["active"] is True

    def test_list_universe(self, seeded_client):
        res = seeded_client.get("/api/universe")
        assert res.status_code == 200
        data = res.json()
        assert data["total"] >= 5

    def test_search_universe(self, seeded_client):
        res = seeded_client.get("/api/universe", params={"query": "AAPL"})
        assert res.status_code == 200
        tickers = [t["ticker"] for t in res.json()["tickers"]]
        assert "AAPL" in tickers

    def test_toggle_active(self, seeded_client):
        res = seeded_client.patch("/api/universe/AAPL", json={"active": False})
        assert res.status_code == 200
        assert res.json()["active"] is False

    def test_duplicate_ticker_409(self, client):
        client.post("/api/universe", json={"ticker": "AAPL"})
        res = client.post("/api/universe", json={"ticker": "AAPL"})
        assert res.status_code == 409

    def test_invalid_ticker_format(self, client):
        res = client.post("/api/universe", json={"ticker": "!!INVALID!!"})
        assert res.status_code == 422

    def test_import_csv(self, client):
        csv_content = "ticker,name\nAAPL,Apple\nMSFT,Microsoft\nGOOGL,Alphabet"
        files = {
            "file": ("tickers.csv", io.BytesIO(csv_content.encode()), "text/csv")
        }
        res = client.post("/api/universe/import_csv", files=files)
        assert res.status_code == 200
        data = res.json()
        assert data["added"] >= 2  # at least 2 new tickers
