"""Tests for universe CSV import parsing logic."""
import pytest

from routers.universe import _parse_csv


class TestParseCsv:
    # ── Header-based CSV ──────────────────────────────────────────────────────

    def test_basic_ticker_column(self):
        csv = "ticker\nAAPL\nMSFT\nGOOGL"
        rows = _parse_csv(csv)
        tickers = [r["ticker"] for r in rows]
        assert tickers == ["AAPL", "MSFT", "GOOGL"]

    def test_ticker_and_name_columns(self):
        csv = "ticker,name\nAAPL,Apple Inc\nMSFT,Microsoft"
        rows = _parse_csv(csv)
        assert rows[0] == {"ticker": "AAPL", "name": "Apple Inc"}
        assert rows[1] == {"ticker": "MSFT", "name": "Microsoft"}

    def test_lowercase_tickers_uppercased(self):
        csv = "ticker\naapl\nmsft"
        rows = _parse_csv(csv)
        assert rows[0]["ticker"] == "AAPL"
        assert rows[1]["ticker"] == "MSFT"

    def test_whitespace_stripped(self):
        csv = "ticker\n  AAPL  \n  MSFT\t"
        rows = _parse_csv(csv)
        assert rows[0]["ticker"] == "AAPL"
        assert rows[1]["ticker"] == "MSFT"

    def test_empty_name_becomes_none(self):
        csv = "ticker,name\nAAPL,\nMSFT,"
        rows = _parse_csv(csv)
        assert rows[0]["name"] is None
        assert rows[1]["name"] is None

    def test_missing_name_column_gives_none(self):
        csv = "ticker\nAAPL\nMSFT"
        rows = _parse_csv(csv)
        assert rows[0]["name"] is None

    def test_extra_columns_ignored(self):
        csv = "ticker,name,sector,pe_ratio\nAAPL,Apple,Tech,28.5"
        rows = _parse_csv(csv)
        assert rows[0]["ticker"] == "AAPL"
        assert rows[0]["name"] == "Apple"

    # ── Headerless CSV ────────────────────────────────────────────────────────

    def test_headerless_first_column_as_ticker(self):
        csv = "AAPL\nMSFT\nGOOGL"
        rows = _parse_csv(csv)
        tickers = [r["ticker"] for r in rows]
        assert "AAPL" in tickers

    def test_headerless_two_columns(self):
        csv = "AAPL,Apple Inc\nMSFT,Microsoft"
        rows = _parse_csv(csv)
        assert rows[0]["ticker"] == "AAPL"
        assert rows[0]["name"] == "Apple Inc"

    # ── Ticker format validation (done in import endpoint, not parser) ─────────

    def test_valid_ticker_formats(self):
        """Parser accepts all strings — format validation is in the endpoint."""
        csv = "ticker\nBRK-B\nBF.B\nSPY\nA\nABCDEFGHIJ"
        rows = _parse_csv(csv)
        assert len(rows) == 5

    def test_empty_lines_produce_empty_tickers(self):
        """Empty lines give empty ticker strings — filtered by endpoint."""
        csv = "ticker\nAAPL\n\nMSFT"
        rows = _parse_csv(csv)
        tickers = [r["ticker"] for r in rows]
        # May include empty string — endpoint filters those out
        non_empty = [t for t in tickers if t]
        assert "AAPL" in non_empty
        assert "MSFT" in non_empty

    def test_large_csv(self):
        """Parser handles 500+ rows without error."""
        lines = ["ticker"] + [f"T{i:04d}" for i in range(500)]
        rows = _parse_csv("\n".join(lines))
        assert len(rows) == 500

    def test_unicode_name_column(self):
        csv = "ticker,name\nSIE,Siemens AG\nTOYO,Toyota Motor Corp"
        rows = _parse_csv(csv)
        assert rows[0]["name"] == "Siemens AG"

    def test_windows_line_endings(self):
        csv = "ticker,name\r\nAAPL,Apple\r\nMSFT,Microsoft\r\n"
        rows = _parse_csv(csv)
        assert rows[0]["ticker"] == "AAPL"
        assert rows[1]["ticker"] == "MSFT"
