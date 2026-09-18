import os
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values, load_dotenv

# Explicit path, not a bare load_dotenv(): the no-argument form searches upward from the current
# working directory, so it silently finds nothing whenever the process starts anywhere other than
# backend/ — and a silently-missing DATABASE_URL degrades to the in-process cache with no error.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# Keys checked for an ambient/.env conflict (contract 0041). A stale exported DATABASE_URL and a
# stale exported CORS_ORIGINS each produced an unrelated-looking symptom locally, ~2 evenings
# apart — a rotated-password read on the first, "API offline" against 200 OK server logs on the
# second — because load_dotenv never overrides an already-set variable and neither symptom named
# the actual cause.
_GUARDED = ("DATABASE_URL", "CORS_ORIGINS", "GEMINI_KEY", "GEMINI_MODEL")

# Values that must never be printed verbatim in the conflict message below.
_SECRET_KEYS = ("GEMINI_KEY",)


def _describe(key: str, value: str) -> str:
    """A value fit to print in an error message. DATABASE_URL shows only the parsed username
    and host, never the password; a secret key shows only its length."""
    if key == "DATABASE_URL":
        parsed = urlparse(value)
        return f"user={parsed.username} host={parsed.hostname}"
    if key in _SECRET_KEYS:
        return f"<{len(value)} chars>"
    return value


def check_for_env_conflicts(env: Mapping[str, str], dotenv_path: Path) -> None:
    """Raises when a shell-exported value for one of _GUARDED disagrees with backend/.env,
    instead of silently losing to `load_dotenv` and surfacing later as an unrelated symptom.

    Only a genuine conflict raises:
    - An **empty** ambient value is a deliberate opt-out (`DATABASE_URL=""` means "no
      database"), never a conflict.
    - A key **absent from `.env`** is not a conflict either — that is how Render runs, with no
      `.env` file at all. `dotenv_values` reads the file without mutating the environment and
      returns `{}` when it is missing, so a missing file can never trigger this.
    - Identical values are, by definition, not a conflict.
    """
    file_values = dotenv_values(dotenv_path)
    for key in _GUARDED:
        ambient = env.get(key)
        from_file = file_values.get(key)
        if not ambient or not from_file or ambient == from_file:
            continue
        raise RuntimeError(
            f"Environment variable {key} is set in your shell and differs from backend/.env.\n"
            f"  shell : {_describe(key, ambient)}\n"
            f"  .env  : {_describe(key, from_file)}\n"
            f"load_dotenv will not override an exported variable — `unset {key}` or fix .env."
        )


check_for_env_conflicts(os.environ, _ENV_PATH)
load_dotenv(_ENV_PATH)


class Settings:
    def __init__(self):
        # Empty means unset, for this one variable only (contract 0041): an exported-but-empty
        # CORS_ORIGINS previously survived as os.getenv's default never applying, landing as
        # cors_origins == [""] — a list matching no origin at all, with no error anywhere. Do
        # NOT generalise this `or` to DATABASE_URL below: DATABASE_URL="" meaning "no database"
        # is the safety convention every ad-hoc command in this project relies on to stay off
        # production, and this line inverting to a live connection would break that.
        cors_origins_str = os.getenv("CORS_ORIGINS") or "http://localhost:5173"
        self.cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]
        self.database_url: str | None = os.getenv("DATABASE_URL") or None
        self.gemini_key: str | None = os.getenv("GEMINI_KEY") or None
        self.gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")
