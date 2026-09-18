import os
from pathlib import Path

import pytest

from app.config import Settings, check_for_env_conflicts


def _write_env(tmp_path: Path, **kv: str) -> Path:
    path = tmp_path / ".env"
    path.write_text("\n".join(f"{key}={value}" for key, value in kv.items()))
    return path


# --- check_for_env_conflicts ------------------------------------------------------------------


def test_raises_when_ambient_and_dotenv_disagree(tmp_path, monkeypatch):
    env_path = _write_env(tmp_path, DATABASE_URL="postgresql://shelluser:pw1@host/db")
    monkeypatch.setenv("DATABASE_URL", "postgresql://envuser:pw2@host/db")

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        check_for_env_conflicts(os.environ, env_path)


def test_no_raise_when_key_absent_from_dotenv():
    """The Render case: no .env file at all. dotenv_values returns {} for a missing path, so
    every key is "absent from .env" and none can conflict."""
    check_for_env_conflicts({"DATABASE_URL": "postgresql://user@host/db"}, Path("/nonexistent/.env"))


def test_no_raise_when_ambient_is_empty_opt_out(tmp_path):
    """DATABASE_URL="" is a deliberate opt-out, never a conflict, even though .env has a real
    value."""
    env_path = _write_env(tmp_path, DATABASE_URL="postgresql://user@host/db")

    check_for_env_conflicts({"DATABASE_URL": ""}, env_path)


def test_no_raise_when_ambient_and_dotenv_are_identical(tmp_path):
    env_path = _write_env(tmp_path, DATABASE_URL="postgresql://user@host/db")

    check_for_env_conflicts({"DATABASE_URL": "postgresql://user@host/db"}, env_path)


def test_conflict_message_does_not_contain_the_password(tmp_path):
    env_path = _write_env(tmp_path, DATABASE_URL="postgresql://user:supersecretpw@host/db")
    ambient = {"DATABASE_URL": "postgresql://user:othersecretpw@otherhost/db"}

    with pytest.raises(RuntimeError) as exc_info:
        check_for_env_conflicts(ambient, env_path)

    message = str(exc_info.value)
    assert "supersecretpw" not in message
    assert "othersecretpw" not in message
    assert "user=user" in message


def test_conflict_message_does_not_contain_the_gemini_key(tmp_path):
    env_path = _write_env(tmp_path, GEMINI_KEY="AIzaSyFileKeyValueHere1234")
    ambient = {"GEMINI_KEY": "AIzaSyShellKeyValueHere5678"}

    with pytest.raises(RuntimeError) as exc_info:
        check_for_env_conflicts(ambient, env_path)

    message = str(exc_info.value)
    assert "AIzaSyFileKeyValueHere1234" not in message
    assert "AIzaSyShellKeyValueHere5678" not in message
    assert "chars" in message


# --- Settings: CORS_ORIGINS empty means unset --------------------------------------------------


def test_cors_origins_empty_ambient_falls_back_to_the_default(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "")
    assert Settings().cors_origins == ["http://localhost:5173"]


def test_database_url_or_none_is_unchanged(monkeypatch):
    """DATABASE_URL="" must still mean "no database" — the opposite of the CORS_ORIGINS fix
    above. Every ad-hoc command in this project relies on this convention to stay off
    production; generalising the empty-means-unset fix to this line would invert that guard."""
    monkeypatch.setenv("DATABASE_URL", "")
    assert Settings().database_url is None
