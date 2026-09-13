import os


class Settings:
    def __init__(self):
        cors_origins_str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
        self.cors_origins = [origin.strip() for origin in cors_origins_str.split(",")]
        self.database_url: str | None = os.getenv("DATABASE_URL") or None
