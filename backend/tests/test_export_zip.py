import zipfile
from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from app.cache import clear, store
from app.db import get_engine, session
from app.export import build_universe_zip, history_to_csv
from app.main import app
from app.models import Base, UniverseTicker
from tests.test_export import _frame


@pytest.fixture(autouse=True)
def reset_ttl_cache():
    clear()
    yield
    clear()


@pytest.fixture
def db_mode(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/test_export_zip.db"
    monkeypatch.setenv("DATABASE_URL", url)
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield engine


@pytest.fixture
def client():
    return TestClient(app)


def _add_active_ticker(ticker: str, active: bool = True) -> None:
    with session() as db:
        db.add(UniverseTicker(ticker=ticker.upper(), active=active))


# --- 1-6. build_universe_zip — pure ---------------------------------------------------------


def test_build_zip_two_tickers_produces_expected_names():
    archive = build_universe_zip({"AAPL": _frame(["2016-01-04"]), "MSFT": _frame(["2016-01-04"])})
    with zipfile.ZipFile(BytesIO(archive)) as zf:
        assert zf.namelist() == ["AAPL.csv", "MSFT.csv"]


def test_build_zip_member_contents_match_history_to_csv_byte_for_byte():
    df = _frame(["2016-01-04", "2016-01-05"], closes=[101.0, 102.0])
    archive = build_universe_zip({"AAPL": df})
    with zipfile.ZipFile(BytesIO(archive)) as zf:
        assert zf.read("AAPL.csv") == history_to_csv(df).encode("utf-8")


def test_build_zip_sorted_regardless_of_insertion_order():
    histories = {"MSFT": _frame(["2016-01-04"]), "AAPL": _frame(["2016-01-04"]), "QQQ": _frame(["2016-01-04"])}
    archive = build_universe_zip(histories)
    with zipfile.ZipFile(BytesIO(archive)) as zf:
        assert zf.namelist() == ["AAPL.csv", "MSFT.csv", "QQQ.csv"]


def test_build_zip_deterministic_across_calls():
    histories = {"AAPL": _frame(["2016-01-04"]), "MSFT": _frame(["2016-01-05"])}
    first = build_universe_zip(histories)
    second = build_universe_zip(histories)
    assert first == second


def test_build_zip_empty_dict_returns_valid_empty_zip():
    archive = build_universe_zip({})
    with zipfile.ZipFile(BytesIO(archive)) as zf:
        assert zf.namelist() == []
        zf.testzip()  # raises on corruption; None means the (empty) archive is valid


def test_build_zip_lowercase_key_becomes_uppercase_filename():
    archive = build_universe_zip({"aapl": _frame(["2016-01-04"])})
    with zipfile.ZipFile(BytesIO(archive)) as zf:
        assert zf.namelist() == ["AAPL.csv"]


# --- 7-13. GET /universe/export.zip ----------------------------------------------------------


def test_download_universe_zip_200_with_headers(db_mode, client):
    _add_active_ticker("AAPL")
    store("AAPL", _frame(["2016-01-04", "2016-01-05"]))

    response = client.get("/universe/export.zip")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    assert 'filename="universe.zip"' in response.headers["content-disposition"]


def test_download_universe_zip_body_contains_one_entry_per_ticker_with_history(db_mode, client):
    _add_active_ticker("AAPL")
    _add_active_ticker("MSFT")
    store("AAPL", _frame(["2016-01-04", "2016-01-05"]))
    store("MSFT", _frame(["2016-01-04", "2016-01-05"]))

    response = client.get("/universe/export.zip")

    with zipfile.ZipFile(BytesIO(response.content)) as zf:
        assert zf.namelist() == ["AAPL.csv", "MSFT.csv"]


def test_download_universe_zip_omits_ticker_with_no_stored_bars(db_mode, client):
    _add_active_ticker("AAPL")
    _add_active_ticker("ORPHAN")  # membership row, no price_bars at all
    store("AAPL", _frame(["2016-01-04", "2016-01-05"]))

    response = client.get("/universe/export.zip")

    assert response.status_code == 200
    with zipfile.ZipFile(BytesIO(response.content)) as zf:
        assert zf.namelist() == ["AAPL.csv"]


def test_download_universe_zip_404_when_nothing_has_history(db_mode, client):
    _add_active_ticker("ORPHAN")  # membership row, no price_bars

    response = client.get("/universe/export.zip")
    assert response.status_code == 404


def test_download_universe_zip_route_ordering_guard(db_mode, client):
    """The whole reason this contract has a testing section: /export.zip must reach the zip
    handler, not get_ticker via /{ticker}. A 404 with a JSON detail here means the route
    declared later in the file silently swallowed this one."""
    _add_active_ticker("AAPL")
    store("AAPL", _frame(["2016-01-04"]))

    response = client.get("/universe/export.zip")

    assert response.headers["content-type"] == "application/zip"


def test_download_universe_zip_never_calls_yfinance(db_mode, client, monkeypatch):
    _add_active_ticker("AAPL")
    store("AAPL", _frame(["2016-01-04", "2016-01-05"]))

    def _raise(*_args, **_kwargs):
        raise AssertionError("must not fetch from yfinance for a zip export")

    monkeypatch.setattr("app.market_data._download_history", _raise)
    monkeypatch.setattr("app.market_data._download_info", _raise)

    response = client.get("/universe/export.zip")
    assert response.status_code == 200


def test_download_universe_zip_degraded_mode_returns_503(client):
    assert client.get("/universe/export.zip").status_code == 503
