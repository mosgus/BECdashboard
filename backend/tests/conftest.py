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

import pytest


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
