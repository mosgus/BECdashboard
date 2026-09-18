"""Shared test fixtures.

The autouse fixture below exists because of a real incident on 2026-09-13: after `backend/.env`
was created with a live Render `DATABASE_URL`, `pytest` began issuing real `INSERT INTO price_bars`
statements against the production database. `tests/test_cache.py` calls `store()` and pins no
`DATABASE_URL` of its own, so it inherited the ambient one.

It surfaced as a failure only by luck — contract 0001's fixtures are non-OHLCV frames with an
integer index, so Postgres rejected the insert with "cannot cast type smallint to date". Had those
frames been OHLCV-shaped, the writes would have **succeeded**, silently seeding the live table with
test data. Every earlier test run passed because no `DATABASE_URL` existed anywhere.

So: no test touches a real database unless it explicitly asks for one. Tests that need persistence
opt in through their own fixture pointing at a `tmp_path` SQLite file.
"""

import socket

import pytest
from curl_cffi import requests as curl_requests


@pytest.fixture(autouse=True)
def isolate_from_ambient_database(monkeypatch):
    """Remove DATABASE_URL for every test, before the test body runs.

    Opt-in fixtures (e.g. `db_mode`) re-set it to a throwaway SQLite file afterwards, so they are
    unaffected — monkeypatch applies their value on top of this removal and unwinds both at teardown.

    Do not weaken this to "only when the URL looks like production." The failure mode being
    prevented is a test writing to whatever database the developer happens to have configured, and
    that is exactly the case where it would look legitimate.
    """
    monkeypatch.delenv("DATABASE_URL", raising=False)


def _network_blocked_message(address) -> str:
    return (
        f"Test attempted a network connection to {address!r}. Patch the call, or mark "
        "the test @pytest.mark.allow_network."
    )


def _blocked_method(name):
    """socket.socket.connect/connect_ex are unbound instance methods — patched onto the
    class, so the first positional argument received back is the instance, not the address."""

    def _raise(self, address, *args, **kwargs):
        raise RuntimeError(_network_blocked_message(address))

    _raise.__name__ = name
    return _raise


def _blocked_create_connection(address, *args, **kwargs):
    """socket.create_connection is a plain module-level function — no instance argument."""
    raise RuntimeError(_network_blocked_message(address))


def _blocked_curl_request(self, method, url, *args, **kwargs):
    """curl_cffi reaches libcurl through C bindings and never touches socket.socket, so the
    three patches above do not see it at all. yfinance uses it for the endpoints that need no
    crumb — measured 2026-09-18: with only the socket patches installed,
    `yf.Ticker("AAPL").news` still returned 10 live articles inside a test. This is the patch
    that actually stops yfinance."""
    raise RuntimeError(_network_blocked_message(f"{method} {url}"))


@pytest.fixture(autouse=True)
def block_network(request, monkeypatch):
    """No test reaches the network unless it explicitly opts in.

    Same incident shape as isolate_from_ambient_database above, just for sockets instead of
    the database: measured 2026-09-18, three test_api_universe.py cases and seven
    test_news.py cases were making real yfinance calls that nobody intended and that passed
    anyway, because refresh_news_if_stale's per-ticker `except Exception: continue` swallows
    the outcome either way. 22.7s of the suite's runtime was live network I/O whose results
    were thrown away.

    Raises RuntimeError, not OSError — OSError is what a genuine connection failure looks
    like, and several code paths in this app catch broad exceptions and continue; an
    accidental network call must be loud, not silently absorbed the same way.

    Nothing legitimate in this suite needs a socket: SQLite fixtures use files, and
    TestClient talks to the ASGI app in-process. allow_network exists for a future
    integration test, not for making an existing unit test pass — if one starts failing
    under this block, patch what it calls instead of marking it."""
    if request.node.get_closest_marker("allow_network") is not None:
        return

    monkeypatch.setattr(socket.socket, "connect", _blocked_method("connect"))
    monkeypatch.setattr(socket.socket, "connect_ex", _blocked_method("connect_ex"))
    monkeypatch.setattr(socket, "create_connection", _blocked_create_connection)
    monkeypatch.setattr(curl_requests.Session, "request", _blocked_curl_request)
