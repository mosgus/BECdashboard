"""Shared test fixtures for Blue Eagle API integration tests.

Uses an in-memory SQLite database with compile-time type overrides
for PostgreSQL-specific column types (UUID, JSONB).  This gives full
test isolation without requiring a separate PostgreSQL instance or
special permissions.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ── SQLite ↔ PostgreSQL type compatibility shims ────────────────────────────
# These must be registered BEFORE any model import triggers DDL compilation.


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    return "TEXT"


@compiles(UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):
    return "VARCHAR(36)"


# Now safe to import application code that touches models / engine.
from db.base import Base, get_db  # noqa: E402
from main import app  # noqa: E402


# ── In-memory SQLite engine ─────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite://"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    """Enable foreign-key enforcement (off by default in SQLite)."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def setup_db():
    """Create all tables before each test, drop after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    """FastAPI TestClient with overridden DB dependency."""
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def seeded_client(client):
    """Client with pre-seeded universe tickers.

    Seeds five tickers commonly used by the test suite.
    """
    for ticker in ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]:
        resp = client.post(
            "/api/universe", json={"ticker": ticker, "name": f"{ticker} Inc"}
        )
        # Confirm each seed succeeds (200 for new, 409 would mean duplicate)
        assert resp.status_code == 200, f"Seeding {ticker} failed: {resp.text}"
    return client
