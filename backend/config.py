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

    # ── Sprint 5: Email delivery (SMTP) ──────────────────────────────────────
    # All optional — system degrades gracefully when unset.
    smtp_host: str | None = None          # e.g. smtp.gmail.com
    smtp_port: int = 587                  # 587 = STARTTLS (default)
    smtp_user: str | None = None          # SMTP login username
    smtp_pass: str | None = None          # SMTP login password / app password
    email_from: str | None = None         # Sender address (defaults to smtp_user)
    alert_recipients: str | None = None   # Comma-separated recipient emails

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
