import os
from pathlib import Path

from dotenv import load_dotenv

# Explicit path, not a bare load_dotenv(): the no-argument form searches upward from the current
# working directory, so it silently finds nothing whenever the process starts anywhere other than
# backend/ — and a silently-missing DATABASE_URL degrades to the in-process cache with no error.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings:
    def __init__(self):
        cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
        self.cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]
        self.database_url: str | None = os.getenv("DATABASE_URL") or None
