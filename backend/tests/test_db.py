"""Tests for app.db URL handling and app.config environment loading.

The `postgresql://` case below is a regression test, not a hypothetical: Render issues
`postgresql://`, `normalize_database_url` originally rewrote only `postgres://`, and SQLAlchemy
resolves a bare `postgresql://` to psycopg**2** — which this project does not install. That
shipped and cost two diagnosis cycles against a live database because nothing covered it.
"""

import importlib

import pytest

from app.db import normalize_database_url

PSYCOPG3 = "postgresql+psycopg://"
CREDS = "user:pw@host:5432/db"


@pytest.mark.parametrize(
    "given, expected",
    [
        # Render's short scheme.
        (f"postgres://{CREDS}", f"{PSYCOPG3}{CREDS}"),
        # Render's actual scheme as of 2026-09-13. The regression case.
        (f"postgresql://{CREDS}", f"{PSYCOPG3}{CREDS}"),
        # Already names psycopg v3 — must pass through untouched, not double-rewrite.
        (f"{PSYCOPG3}{CREDS}", f"{PSYCOPG3}{CREDS}"),
        # Explicitly asks for psycopg2. Honour it; do not silently swap the driver.
        (f"postgresql+psycopg2://{CREDS}", f"postgresql+psycopg2://{CREDS}"),
        # Non-postgres backends are untouched — this is how the test suite runs.
        ("sqlite:///relative.db", "sqlite:///relative.db"),
        ("sqlite:////tmp/absolute.db", "sqlite:////tmp/absolute.db"),
    ],
)
def test_normalize_database_url(given, expected):
    assert normalize_database_url(given) == expected


def test_normalize_is_idempotent():
    """Normalizing twice must equal normalizing once — a second pass must not corrupt the URL."""
    once = normalize_database_url(f"postgresql://{CREDS}")
    assert normalize_database_url(once) == once


def test_normalize_preserves_query_parameters():
    """Render external connections may need ?sslmode=require; the rewrite must not drop it."""
    result = normalize_database_url(f"postgresql://{CREDS}?sslmode=require")
    assert result == f"{PSYCOPG3}{CREDS}?sslmode=require"


def test_normalize_preserves_password_characters():
    """Passwords contain URL-significant characters. The rewrite is a scheme swap, nothing more."""
    tail = "u:a%2Fb-c_d.e@host:5432/db"
    assert normalize_database_url(f"postgresql://{tail}") == f"{PSYCOPG3}{tail}"


# --- app.config environment handling ------------------------------------------------


def test_settings_reads_database_url_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"postgresql://{CREDS}")
    from app.config import Settings

    assert Settings().database_url == f"postgresql://{CREDS}"


def test_settings_database_url_is_none_when_unset(monkeypatch):
    """Unset must be None, not "" — degraded mode keys off `is None`."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app.config import Settings

    assert Settings().database_url is None


def test_settings_empty_database_url_is_none(monkeypatch):
    """An exported-but-blank DATABASE_URL must degrade, not produce an unusable engine URL."""
    monkeypatch.setenv("DATABASE_URL", "")
    from app.config import Settings

    assert Settings().database_url is None


def test_config_import_does_not_depend_on_working_directory(tmp_path, monkeypatch):
    """`load_dotenv()` with no argument searches upward from the *current working directory*, so it
    finds nothing when the process starts anywhere but `backend/`. The call names an absolute path
    derived from `__file__` instead; importing from an unrelated directory must still work."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    import app.config

    importlib.reload(app.config)
    assert app.config.Settings().cors_origins == ["http://localhost:5173"]
