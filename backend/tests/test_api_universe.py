import socket
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

import pytest

from app.cache import clear, store, store_fundamentals
from app.db import get_engine, session
from app.main import app
from app.models import Base, PriceBar, UniverseTicker
from tests.test_universe import _fundamentals, _history

# Captured at collection time, before any test has run and therefore before conftest.py's
# block_network fixture has had a chance to monkeypatch anything — the one legitimate way to
# get a handle on the real, unpatched method to compare against later.
_REAL_SOCKET_CONNECT = socket.socket.connect


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
def no_strip_background_tasks(monkeypatch):
    """GET /universe/strip schedules auto-refresh, news refresh, and quote refresh via
    BackgroundTasks — TestClient runs background tasks
    synchronously after the response body is built, which would otherwise make every /strip
    test in this file exercise a real ticker sweep against (unpatched) app.universe.refresh
    *and* a real news refresh across all of MARKET_NEWS_TICKERS. Neutered here, for every test
    in the file via autouse, the same way isolate_from_ambient_database in conftest.py handles
    the database side — the sweep's own behavior is tests/test_autorefresh.py's job, and the
    news refresh's is tests/test_news.py's. A test that wants to assert on either call (e.g.
    test_get_strip_schedules_auto_refresh_background_task below) re-patches that one name
    locally with a spy; monkeypatch layers the two so the local one wins for that test."""
    monkeypatch.setattr("app.routers.universe.run_auto_refresh_if_due", lambda *a, **k: None)
    monkeypatch.setattr("app.routers.universe.run_news_refresh_if_due", lambda *a, **k: None)
    monkeypatch.setattr("app.routers.universe.refresh_quotes_if_stale", lambda *a, **k: None)


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

    def fake_refresh_ticker(ticker, force=False, history_start=None):
        return {
            "ticker": ticker,
            "action": "none",
            "last_session": None,
            "bars_before": 0,
            "bars_after": 0,
            "drift_detected": False,
        }

    # add() now checks symbol_has_history before ever reaching fetch_history/fetch_fundamentals,
    # and (contract 0042) calls refresh_ticker before writing the membership row.
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: has_history)
    monkeypatch.setattr("app.universe.fetch_fundamentals", fake_fetch_fundamentals)
    monkeypatch.setattr("app.universe.fetch_history", fake_fetch_history)
    monkeypatch.setattr("app.universe.refresh_ticker", fake_refresh_ticker)


def _add_return_bars(ticker: str, values: list[tuple[float, float]]) -> date:
    start = date(datetime.now(ZoneInfo("America/New_York")).year, 1, 2)
    with session() as db:
        for i, (close, adj_close) in enumerate(values):
            db.add(
                PriceBar(
                    ticker=ticker,
                    date=start + timedelta(days=i),
                    close=close,
                    adj_close=adj_close,
                )
            )
    return start + timedelta(days=len(values) - 1)


def _add_return_bars_from(ticker: str, start: date, values: list[tuple[float, float]]) -> date:
    with session() as db:
        for i, (close, adj_close) in enumerate(values):
            db.add(
                PriceBar(
                    ticker=ticker,
                    date=start + timedelta(days=i),
                    close=close,
                    adj_close=adj_close,
                )
            )
    return start + timedelta(days=len(values) - 1)


def _add_return_bars_on_dates(ticker: str, values: list[tuple[date, float, float]]) -> None:
    with session() as db:
        for bar_date, close, adj_close in values:
            db.add(PriceBar(ticker=ticker, date=bar_date, close=close, adj_close=adj_close))


def _add_signal_bars(
    ticker: str,
    bars: list[tuple[date, float, float, float, float]],
) -> None:
    """Store (date, high, low, close, adj_close) bars for endpoint signal tests."""
    with session() as db:
        for bar_date, high, low, close, adj_close in bars:
            db.add(
                PriceBar(
                    ticker=ticker,
                    date=bar_date,
                    high=high,
                    low=low,
                    close=close,
                    adj_close=adj_close,
                )
            )


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


def test_post_universe_history_unavailable_502(db_mode, client, monkeypatch):
    """502, not 404: symbol_has_history already confirmed the symbol is real, so an empty
    history fetch is an upstream failure, not a missing resource. Also confirms the two
    existing error mappings are unaffected by adding this third one."""
    monkeypatch.setattr("app.universe.symbol_has_history", lambda ticker: True)
    monkeypatch.setattr("app.universe.fetch_history", lambda ticker, start=None, end=None: _history([]))

    response = client.post("/universe", json={"ticker": "GHOST"})
    assert response.status_code == 502
    assert "GHOST" in response.json()["detail"]


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


# --- DELETE /universe/{ticker}: 200 with counts, 404 for unknown, 503 degraded -------------


def test_delete_ticker_returns_200_with_counts(db_mode, client, monkeypatch):
    _patch_fetches(monkeypatch)
    client.post("/universe", json={"ticker": "AAPL"})

    response = client.delete("/universe/AAPL")
    assert response.status_code == 200
    body = response.json()
    assert body["ticker"] == "AAPL"
    assert body["bars_deleted"] == 2
    assert body["fundamentals_deleted"] == 1
    assert body["quotes_deleted"] == 0

    assert client.get("/universe/AAPL").status_code == 404


def test_delete_ticker_404_for_unknown(db_mode, client):
    response = client.delete("/universe/NOPE")
    assert response.status_code == 404


def test_delete_ticker_degraded_mode_returns_503(client):
    assert client.delete("/universe/AAPL").status_code == 503


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
    monkeypatch.setattr(
        "app.universe.refresh_ticker",
        lambda ticker, force=False, history_start=None: {
            "ticker": ticker,
            "action": "none",
            "last_session": None,
            "bars_before": 0,
            "bars_after": 0,
            "drift_detected": False,
        },
    )

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
    assert set(body.keys()) == {"groups", "as_of", "quotes_stale"}


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


def test_get_strip_schedules_three_background_tasks(db_mode, client, monkeypatch):
    auto_refresh_calls = []
    news_refresh_calls = []
    quote_refresh_calls = []
    monkeypatch.setattr(
        "app.routers.universe.run_auto_refresh_if_due",
        lambda now_utc, now_et: auto_refresh_calls.append((now_utc, now_et)),
    )
    monkeypatch.setattr("app.routers.universe.run_news_refresh_if_due", lambda now_utc, now_et: news_refresh_calls.append((now_utc, now_et)))
    monkeypatch.setattr("app.routers.universe.refresh_quotes_if_stale", lambda tickers: quote_refresh_calls.append(tickers))

    response = client.get("/universe/strip")
    assert response.status_code == 200
    assert len(auto_refresh_calls) == 1
    assert len(news_refresh_calls) == 1
    assert quote_refresh_calls == [[]]


# --- GET /universe/returns: stored per-ticker return windows -------------------------------


def test_get_returns_resolves_to_returns_handler_not_the_ticker_catchall(db_mode, client):
    response = client.get("/universe/returns")
    assert response.status_code == 200
    assert set(response.json().keys()) == {"returns", "as_of"}


def test_get_returns_keeps_missing_tickers_and_request_order(db_mode, client):
    as_of = _add_return_bars("AAA", [(100.0 + i, 100.0 + i) for i in range(7)])

    response = client.get("/universe/returns?tickers=ORPHAN,AAA,MISSING")
    assert response.status_code == 200
    body = response.json()
    assert [entry["ticker"] for entry in body["returns"]] == ["ORPHAN", "AAA", "MISSING"]
    assert body["returns"][0] == {"ticker": "ORPHAN", "five_day": None, "thirty_day": None, "ytd": None, "since": None}
    assert body["returns"][2] == {"ticker": "MISSING", "five_day": None, "thirty_day": None, "ytd": None, "since": None}
    assert body["as_of"] == as_of.isoformat()


@pytest.mark.parametrize("path", ["/universe/returns", "/universe/returns?tickers="])
def test_get_returns_empty_request_returns_no_tickers(db_mode, client, path):
    response = client.get(path)
    assert response.status_code == 200
    assert response.json() == {"returns": [], "as_of": None}


def test_get_returns_rejects_more_than_one_hundred_tickers(db_mode, client):
    tickers = ",".join(f"T{i}" for i in range(101))
    response = client.get(f"/universe/returns?tickers={tickers}")
    assert response.status_code == 400


def test_get_returns_uses_stored_adj_close_without_network(db_mode, client):
    _add_return_bars("ADJ", [(200.0 + i, 100.0 + i) for i in range(31)])

    response = client.get("/universe/returns?tickers=ADJ")
    assert response.status_code == 200
    returned = response.json()["returns"][0]
    assert returned["five_day"] == pytest.approx(4.0)
    assert returned["five_day"] != pytest.approx((230.0 - 225.0) / 225.0 * 100)
    assert returned["thirty_day"] == pytest.approx(30.0)
    assert returned["ytd"] == pytest.approx(30.0)


def test_get_returns_deduplicates_preserving_first_seen_order(db_mode, client):
    _add_return_bars("MU", [(100.0 + i, 100.0 + i) for i in range(7)])
    _add_return_bars("ORCL", [(200.0 + i, 200.0 + i) for i in range(7)])

    response = client.get("/universe/returns?tickers=MU,ORCL,MU")
    assert response.status_code == 200
    assert [entry["ticker"] for entry in response.json()["returns"]] == ["MU", "ORCL"]


def test_get_returns_without_since_keeps_existing_windows_and_returns_null_since(db_mode, client):
    _add_return_bars("AAA", [(100.0 + i, 100.0 + i) for i in range(7)])
    _add_return_bars("BBB", [(200.0 + i, 200.0 + i) for i in range(7)])

    absent = client.get("/universe/returns?tickers=AAA,BBB")
    empty = client.get("/universe/returns?tickers=AAA,BBB&since=")

    assert absent.status_code == 200
    assert empty.status_code == 200
    absent_returns = absent.json()["returns"]
    empty_returns = empty.json()["returns"]
    assert [entry["since"] for entry in absent_returns] == [None, None]
    assert [{key: value for key, value in entry.items() if key != "since"} for entry in absent_returns] == [
        {key: value for key, value in entry.items() if key != "since"} for entry in empty_returns
    ]


def test_get_returns_rejects_malformed_since(db_mode, client):
    response = client.get("/universe/returns?tickers=AAA&since=2026-02-30")
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_get_returns_since_before_earliest_bar_is_null_without_affecting_other_windows(db_mode, client):
    _add_return_bars("AAA", [(100.0 + i, 100.0 + i) for i in range(31)])

    response = client.get("/universe/returns?tickers=AAA&since=2000-01-01")
    assert response.status_code == 200
    returned = response.json()["returns"][0]
    assert returned["since"] is None
    assert returned["five_day"] == pytest.approx(4.0)
    assert returned["thirty_day"] == pytest.approx(30.0)
    assert returned["ytd"] == pytest.approx(30.0)


def test_get_returns_future_since_is_null_not_an_error(db_mode, client):
    _add_return_bars("AAA", [(100.0 + i, 100.0 + i) for i in range(7)])
    future = date(datetime.now(ZoneInfo("America/New_York")).year + 1, 1, 1)

    response = client.get(f"/universe/returns?tickers=AAA&since={future.isoformat()}")
    assert response.status_code == 200
    assert response.json()["returns"][0]["since"] is None


def test_get_returns_widens_the_window_for_a_prior_year_since(db_mode, client):
    year = datetime.now(ZoneInfo("America/New_York")).year
    start = date(year - 1, 12, 30)
    _add_return_bars_from("AAA", start, [(100.0, 100.0), (105.0, 105.0), (110.0, 110.0), (120.0, 120.0)])
    _add_return_bars_from("BBB", start, [(200.0, 200.0), (210.0, 210.0), (220.0, 220.0), (240.0, 240.0)])
    _add_return_bars_from("CCC", start, [(50.0, 50.0), (55.0, 55.0), (60.0, 60.0), (75.0, 75.0)])

    response = client.get(f"/universe/returns?tickers=AAA,BBB,CCC&since={start.isoformat()}")
    assert response.status_code == 200
    assert response.json() == {
        "returns": [
            {"ticker": "AAA", "five_day": None, "thirty_day": None, "ytd": pytest.approx(9.090909090909092), "since": pytest.approx(20.0)},
            {"ticker": "BBB", "five_day": None, "thirty_day": None, "ytd": pytest.approx(9.090909090909092), "since": pytest.approx(20.0)},
            {"ticker": "CCC", "five_day": None, "thirty_day": None, "ytd": pytest.approx(25.0), "since": pytest.approx(50.0)},
        ],
        "as_of": (start + timedelta(days=3)).isoformat(),
    }


def test_get_returns_since_uses_adj_close(db_mode, client):
    start = date(datetime.now(ZoneInfo("America/New_York")).year, 1, 2)
    _add_return_bars_from("ADJ", start, [(100.0, 50.0), (150.0, 100.0)])

    response = client.get(f"/universe/returns?tickers=ADJ&since={start.isoformat()}")
    returned = response.json()["returns"][0]
    assert returned["since"] == pytest.approx(100.0)
    assert returned["since"] != pytest.approx(50.0)


def test_get_returns_since_saturday_uses_the_following_monday(db_mode, client):
    _add_return_bars_on_dates("AAA", [
        (date(2026, 1, 2), 100.0, 100.0),
        (date(2026, 1, 5), 105.0, 105.0),
        (date(2026, 1, 6), 120.0, 120.0),
    ])

    response = client.get("/universe/returns?tickers=AAA&since=2026-01-03")
    assert response.status_code == 200
    assert response.json()["returns"][0]["since"] == pytest.approx((120.0 - 105.0) / 105.0 * 100)


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


# --- GET /universe/signals: stored adjusted data, batch shape, and route ordering ----------


def test_get_signals_resolves_as_its_own_route(db_mode, client):
    response = client.get("/universe/signals")

    assert response.status_code == 200
    assert response.json() == {"signals": [], "as_of": None}


def test_get_signals_keeps_no_bar_ticker_and_limits_requested_tickers(db_mode, client):
    response = client.get("/universe/signals?tickers=none, NONE ,")

    assert response.status_code == 200
    assert response.json() == {
        "signals": [{"ticker": "NONE", "signals": [], "atr_pct": None}],
        "as_of": None,
    }

    too_many = ",".join(f"TICKER{number}" for number in range(101))
    assert client.get(f"/universe/signals?tickers={too_many}").status_code == 400


def test_get_signals_uses_adjusted_close_and_adjusted_high_low(db_mode, client):
    start = date.today() - timedelta(days=100)
    split_bars = []
    for index in range(80):
        raw_close = 400.0 if index < 60 else 100.0
        split_bars.append(
            (
                start + timedelta(days=index),
                raw_close * 1.02,
                raw_close * 0.98,
                raw_close,
                100.0,
            )
        )
    _add_signal_bars("SPLIT", split_bars)

    adjusted_atr_bars = [
        (start + timedelta(days=index), 104.0, 96.0, 100.0, 50.0)
        for index in range(20)
    ]
    _add_signal_bars("ATRADJ", adjusted_atr_bars)

    response = client.get("/universe/signals?tickers=SPLIT,ATRADJ,NOBARS")

    assert response.status_code == 200
    body = response.json()
    by_ticker = {entry["ticker"]: entry for entry in body["signals"]}
    assert by_ticker["SPLIT"]["signals"][0]["state"] != "BEARISH"
    assert by_ticker["ATRADJ"]["atr_pct"] == pytest.approx(8.0)
    assert by_ticker["NOBARS"] == {"ticker": "NOBARS", "signals": [], "atr_pct": None}
    assert body["as_of"] == (start + timedelta(days=79)).isoformat()


def test_get_signals_atr_pct_normalizes_for_price_level(db_mode, client):
    start = date.today() - timedelta(days=40)
    _add_signal_bars(
        "LOW",
        [(start + timedelta(days=index), 101.0, 99.0, 100.0, 100.0) for index in range(20)],
    )
    _add_signal_bars(
        "HIGH",
        [(start + timedelta(days=index), 202.0, 198.0, 200.0, 200.0) for index in range(20)],
    )

    response = client.get("/universe/signals?tickers=LOW,HIGH")

    assert response.status_code == 200
    values = [entry["atr_pct"] for entry in response.json()["signals"]]
    assert values == pytest.approx([2.0, 2.0])


# --- conftest.py's block_network fixture (contract 0043) ------------------------------------
#
# These live here rather than in conftest.py because pytest only collects test functions from
# files matching python_files = test_*.py — conftest.py is loaded for its fixtures but never
# collected as a test module itself. This file is the only test module contract 0043 is
# allowed to touch, so it is where the fixture's own behavior gets proven.


def test_block_network_raises_runtime_error_naming_the_address():
    with pytest.raises(RuntimeError, match=r"\('example\.com', 80\)"):
        socket.create_connection(("example.com", 80))


@pytest.mark.allow_network
def test_allow_network_marker_leaves_the_real_socket_connect_installed():
    """Does not make a real connection — that would put network I/O back into the suite to
    prove network I/O was removed. Asserting identity against the reference captured at
    collection time (before block_network could have patched anything) is enough to prove the
    marker made the fixture skip patching for this test."""
    assert socket.socket.connect is _REAL_SOCKET_CONNECT
