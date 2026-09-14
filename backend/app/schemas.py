"""Pydantic response (and one request) models for the universe API. Plain data shapes only
— no logic. Every fundamentals field is optional: ETFs genuinely lack sector, industry,
market_cap, beta, and forward_pe (measured across SPY, QQQ, VTI), and a non-optional field
here would make an ETF unreturnable."""

from datetime import date, datetime

from pydantic import BaseModel, field_validator


class UniverseEntry(BaseModel):
    ticker: str
    short_name: str | None
    sector: str | None
    quote_type: str | None
    regular_market_price: float | None
    market_cap: int | None
    trailing_pe: float | None
    dividend_yield: float | None
    has_fundamentals: bool
    bar_count: int
    first_bar: date | None
    last_bar: date | None
    fetched_at: datetime | None
    added_at: datetime


class UniverseDetail(UniverseEntry):
    long_name: str | None
    industry: str | None
    currency: str | None
    exchange: str | None
    previous_close: float | None
    forward_pe: float | None
    fifty_two_week_high: float | None
    fifty_two_week_low: float | None
    beta: float | None
    average_volume: int | None


class RefreshResult(BaseModel):
    ticker: str
    action: str
    last_session: date | None
    bars_before: int
    bars_after: int
    drift_detected: bool
    detail: UniverseDetail


class AddTickerRequest(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def _ticker_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ticker must not be blank")
        return value
