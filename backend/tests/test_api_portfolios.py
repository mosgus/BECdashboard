"""Integration tests for portfolio CRUD + positions."""
import pytest


class TestPortfolioCRUD:
    def test_create_portfolio(self, seeded_client):
        res = seeded_client.post("/api/portfolios", json={"name": "Test Portfolio"})
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Test Portfolio"
        assert "id" in data

    def test_list_portfolios(self, seeded_client):
        seeded_client.post("/api/portfolios", json={"name": "P1"})
        seeded_client.post("/api/portfolios", json={"name": "P2"})
        res = seeded_client.get("/api/portfolios")
        assert res.status_code == 200
        assert len(res.json()["portfolios"]) == 2

    def test_get_portfolio_detail(self, seeded_client):
        create = seeded_client.post("/api/portfolios", json={"name": "Detail Test"})
        pid = create.json()["id"]
        res = seeded_client.get(f"/api/portfolios/{pid}")
        assert res.status_code == 200
        assert res.json()["name"] == "Detail Test"
        assert "positions" in res.json()

    def test_rename_portfolio(self, seeded_client):
        create = seeded_client.post("/api/portfolios", json={"name": "Old Name"})
        pid = create.json()["id"]
        res = seeded_client.put(f"/api/portfolios/{pid}", json={"name": "New Name"})
        assert res.status_code == 200
        assert res.json()["name"] == "New Name"

    def test_delete_portfolio(self, seeded_client):
        create = seeded_client.post("/api/portfolios", json={"name": "Delete Me"})
        pid = create.json()["id"]
        res = seeded_client.delete(f"/api/portfolios/{pid}")
        assert res.status_code == 204
        # Verify it's gone
        res2 = seeded_client.get(f"/api/portfolios/{pid}")
        assert res2.status_code == 404

    def test_portfolio_not_found(self, seeded_client):
        res = seeded_client.get(
            "/api/portfolios/00000000-0000-0000-0000-000000000000"
        )
        assert res.status_code == 404


class TestPositions:
    def _create_portfolio(self, client):
        res = client.post("/api/portfolios", json={"name": "Pos Test"})
        return res.json()["id"]

    def test_add_position(self, seeded_client):
        pid = self._create_portfolio(seeded_client)
        res = seeded_client.post(
            f"/api/portfolios/{pid}/positions",
            json={
                "ticker": "AAPL",
                "shares": 100,
                "cost_basis": 150.0,
                "position_type": "stock",
            },
        )
        assert res.status_code == 201
        assert res.json()["ticker"] == "AAPL"

    def test_update_position(self, seeded_client):
        pid = self._create_portfolio(seeded_client)
        seeded_client.post(
            f"/api/portfolios/{pid}/positions",
            json={"ticker": "AAPL", "shares": 100, "position_type": "stock"},
        )
        res = seeded_client.put(
            f"/api/portfolios/{pid}/positions/AAPL",
            json={"ticker": "AAPL", "shares": 200},
        )
        assert res.status_code == 200

    def test_delete_position(self, seeded_client):
        pid = self._create_portfolio(seeded_client)
        seeded_client.post(
            f"/api/portfolios/{pid}/positions",
            json={"ticker": "MSFT", "shares": 50, "position_type": "stock"},
        )
        res = seeded_client.delete(f"/api/portfolios/{pid}/positions/MSFT")
        assert res.status_code == 204

    def test_position_backfills_missing_universe_ticker(self, seeded_client):
        """Adding a position with a ticker not in the universe auto-creates
        the universe entry (enriched via yfinance) so the ticker is available
        for future lookups."""
        pid = self._create_portfolio(seeded_client)
        # Pre-condition: ticker is not in the seeded universe
        assert seeded_client.get("/api/universe/ZZZZZ").status_code == 404

        res = seeded_client.post(
            f"/api/portfolios/{pid}/positions",
            json={"ticker": "ZZZZZ", "shares": 10, "position_type": "stock"},
        )
        assert res.status_code == 201
        assert res.json()["ticker"] == "ZZZZZ"

        # Post-condition: ticker now exists in the universe (active)
        u = seeded_client.get("/api/universe/ZZZZZ")
        assert u.status_code == 200
        assert u.json()["active"] is True

    def test_position_rejects_invalid_ticker_format(self, seeded_client):
        pid = self._create_portfolio(seeded_client)
        res = seeded_client.post(
            f"/api/portfolios/{pid}/positions",
            json={"ticker": "TOO-LONG-TICKER", "shares": 10, "position_type": "stock"},
        )
        assert res.status_code == 422
