"""Application configuration via pydantic-settings.

DATABASE_URL is the only required variable.

Identity is actor-header based (X-Actor-Name) — no JWT or class password needed.
The optional CLASS_WRITE_KEY provides basic mutation protection for public deployments:
if set, all POST/PUT/PATCH/DELETE requests must include X-Class-Key: <value>.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database — required
    database_url: str

    # Optional write-key gate — if set, mutations require X-Class-Key header.
    # Leave unset for open cohort access.
    class_write_key: str | None = None

    # CORS — comma-separated origins, "*" allows all (dev default)
    cors_origins: str = "*"

    # Data provider
    data_provider: str = "yfinance"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
