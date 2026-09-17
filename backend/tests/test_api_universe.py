from datetime import datetime, timezone

from fastapi.testclient import TestClient

import pytest

from app.cache import clear, store, store_fundamentals
from app.db import get_engine, session
from app.main import app
from app.models import Base, UniverseTicker
from tests.test_universe import _fundamentals, _history


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture(autouse=True)
def quotes_market_closed_by_default(monkeypatch):
    """GET /universe now calls refresh_quotes_if_stale via list_all(), which would otherwise
    decide whether to hit the real network based on the real wall-clock's actual market-hours
    state. Same rationale and fix as test_universe.py's fixture of the same name."""
    monkeypatch.setattr("app.quotes.is_market_open", lambda now_et: False)


@pytest.fixture(autouse=True)
def no_auto_refresh_background_task(monkeypatch):
    """GET /universe/strip now schedules run_auto_refresh_if_due via BackgroundTasks —
    TestClient runs background tasks synchronously after the response body is built, which
    would otherwise make every /strip test in this file exercise a real ticker sweep against
    (unpatched) app.universe.refresh. Neutered here; the sweep's own behavior is
    tests/test_autorefresh.py's job."""
    monkeypatch.setattr("app.routers.universe.run_auto_refresh_if_due", lambda *a, **k: None)


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
        "bars_prepended": 0,
    }
    monkeypatch.setattr(
        "app.universe.refresh_ticker",
        lambda ticker, force=False, history_start=None: fake_summary,
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


# --- GET /universe/strip: route ordering, shape, 503 ---------------------------------------


def test_get_strip_resolves_to_strip_handler_not_the_ticker_catchall(db_mode, client):
    """The route-ordering trap: /{ticker} is declared later in the router but must not swallow
    /strip. If it did, this would come back as a UniverseDetail-shaped 404 for ticker "STRIP",
    not the StripResponse shape asserted below."""
    response = client.get("/universe/strip")
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"groups", "as_of"}


def test_get_strip_returns_expected_shape_for_a_universe_member(db_mode, client, monkeypatch):
    monkeypatch.setattr("app.strip.is_market_open", lambda now_et: False)
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/strip")
    assert response.status_code == 200
    body = response.json()
    assert len(body["groups"]) == 1
    group = body["groups"][0]
    assert group["label"] == "Equities"
    today = group["today"][0]
    assert today["ticker"] == "AAPL"
    assert today["name"] == "AAPL Inc."
    assert today["quote_type"] == "EQUITY"


def test_get_strip_degraded_mode_returns_503(client):
    assert client.get("/universe/strip").status_code == 503


def test_get_strip_schedules_auto_refresh_background_task(db_mode, client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.routers.universe.run_auto_refresh_if_due",
        lambda now_utc, now_et: calls.append((now_utc, now_et)),
    )

    response = client.get("/universe/strip")
    assert response.status_code == 200
    assert len(calls) == 1


# --- POST /universe/quotes/refresh: route ordering, shape, 503 -----------------------------


def test_post_quotes_refresh_resolves_to_quotes_handler_not_the_ticker_catchall(db_mode, client, monkeypatch):
    """The route-ordering trap: /{ticker}/refresh is declared later in the router but must not
    swallow /quotes/refresh. If it did, this would come back as a 404 for ticker "quotes", not
    the QuoteRefreshResult shape asserted below."""
    monkeypatch.setattr("app.routers.universe.fetch_quotes", lambda tickers: {})

    response = client.post("/universe/quotes/refresh")
    assert response.status_code == 200
    assert set(response.json().keys()) == {"refreshed", "fetched_at"}


def test_post_quotes_refresh_reports_the_refreshed_count(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    fixed_as_of = datetime(2026, 9, 16, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "app.routers.universe.fetch_quotes",
        lambda tickers: {"AAPL": (150.0, fixed_as_of)},
    )

    response = client.post("/universe/quotes/refresh")
    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] == 1
    assert body["fetched_at"] is not None


def test_post_quotes_refresh_no_quotes_returned_yields_null_fetched_at(db_mode, client, monkeypatch):
    monkeypatch.setattr("app.routers.universe.fetch_quotes", lambda tickers: {})

    response = client.post("/universe/quotes/refresh")
    assert response.status_code == 200
    body = response.json()
    assert body["refreshed"] == 0
    assert body["fetched_at"] is None


def test_post_quotes_refresh_degraded_mode_returns_503(client):
    assert client.post("/universe/quotes/refresh").status_code == 503


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


# --- 8-9. GET /universe/{ticker}/history.csv: 200, headers, header row, line count --------


def test_download_history_csv_200_with_headers_and_body(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/AAPL/history.csv")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert 'filename="AAPL.csv"' in response.headers["content-disposition"]

    lines = response.text.splitlines()
    assert lines[0] == "Date,Open,High,Low,Close,Adj Close,Volume"
    assert len(lines) == 3  # header + the two bars _patch_fetches stores


# --- 10-11. 404s: unknown ticker, and a member with no stored bars -------------------------


def test_download_history_csv_404_when_not_in_universe(db_mode, client):
    response = client.get("/universe/NOPE/history.csv")
    assert response.status_code == 404


def test_download_history_csv_404_when_no_stored_bars(db_mode, client):
    """A membership row can exist with no price_bars rows at all — same edge case
    test_universe.py's ORPHAN fixture covers for list_all()."""
    with session() as db:
        db.add(UniverseTicker(ticker="ORPHAN", active=True))

    response = client.get("/universe/ORPHAN/history.csv")
    assert response.status_code == 404


# --- 12. lowercase path resolves the same ticker; filename is uppercased -------------------


def test_download_history_csv_lowercase_path_resolves_and_filename_is_uppercased(
    db_mode, client, monkeypatch
):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/aapl/history.csv")

    assert response.status_code == 200
    assert 'filename="AAPL.csv"' in response.headers["content-disposition"]


# --- 13. no call to _download_history — a download never fetches --------------------------


def test_download_history_csv_never_calls_download_history(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    def _raise(*_args, **_kwargs):
        raise AssertionError("_download_history must not be called by a CSV download")

    monkeypatch.setattr("app.market_data._download_history", _raise)

    response = client.get("/universe/AAPL/history.csv")
    assert response.status_code == 200


# --- 14. degraded mode returns 503 ----------------------------------------------------------


def test_download_history_csv_degraded_mode_returns_503(client):
    assert client.get("/universe/AAPL/history.csv").status_code == 503


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


# --- 22. GET /universe/{ticker}/history: JSON endpoint for charting -------------------------


def test_get_history_json_200_with_ticker_and_bars(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/AAPL/history")
    assert response.status_code == 200
    data = response.json()
    assert data["ticker"] == "AAPL"
    assert len(data["bars"]) == 2  # _patch_fetches stores 2 bars


def test_get_history_json_bars_ordered_oldest_first(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/AAPL/history")
    data = response.json()
    bars = data["bars"]
    assert bars[0]["date"] < bars[-1]["date"]


def test_get_history_json_bar_fields_exact(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/AAPL/history")
    data = response.json()
    bar = data["bars"][0]
    assert set(bar.keys()) == {"date", "close", "adj_close"}


def test_get_history_json_date_format_yyyy_mm_dd(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/AAPL/history")
    data = response.json()
    bar = data["bars"][0]
    assert bar["date"] == "2016-01-04"


def test_get_history_json_null_close_is_json_null_not_nan(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch, has_history=True)
    client.post("/universe", json={"ticker": "AAPL"})

    # Inject a bar with a null close directly into the database, bypassing cache.store()'s
    # null-close guard (contract 0024: a bar with no close is never stored going forward).
    # This simulates a bar already in place before that guard existed — the real production
    # scenario the guard is named after — which the guard does not retroactively clean up.
    from datetime import date as date_

    from app.cache import clear
    from app.models import PriceBar

    with session() as db:
        db.merge(
            PriceBar(
                ticker="AAPL",
                date=date_(2016, 1, 4),
                open=100.0,
                high=101.0,
                low=99.0,
                close=None,
                adj_close=None,
                volume=1_000_000,
            )
        )
    clear()

    response = client.get("/universe/AAPL/history")
    assert response.status_code == 200
    assert "NaN" not in response.text
    assert "null" in response.text
    data = response.json()
    assert data["bars"][0]["close"] is None


def test_get_history_json_lowercase_path_resolves_uppercased_ticker(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.get("/universe/aapl/history")
    assert response.status_code == 200
    assert response.json()["ticker"] == "AAPL"


def test_get_history_json_404_ticker_not_in_universe(db_mode, client):
    response = client.get("/universe/NOPE/history")
    assert response.status_code == 404
    assert "NOPE" in response.json()["detail"]


def test_get_history_json_404_no_stored_bars(db_mode, client):
    with session() as db:
        db.add(UniverseTicker(ticker="ORPHAN", active=True))

    response = client.get("/universe/ORPHAN/history")
    assert response.status_code == 404


def test_get_history_json_503_degraded_mode(client):
    response = client.get("/universe/AAPL/history")
    assert response.status_code == 503


def test_get_history_json_never_fetches_from_yfinance(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    def _raise(*_args, **_kwargs):
        raise AssertionError("Must not fetch from yfinance")

    monkeypatch.setattr("app.market_data._download_history", _raise)
    monkeypatch.setattr("app.market_data._download_info", _raise)

    response = client.get("/universe/AAPL/history")
    assert response.status_code == 200
