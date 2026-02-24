"""Application configuration via pydantic-settings.

All required vars are validated on import — the app will not start
if CLASS_PASSWORD, JWT_SECRET, or DATABASE_URL are missing.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Auth
    class_password: str
    jwt_secret: str
    jwt_expiry_hours: int = 8

    # Database
    database_url: str

    # CORS — comma-separated origins, "*" allows all (dev default)
    cors_origins: str = "*"

    # Data provider
    data_provider: str = "yfinance"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
