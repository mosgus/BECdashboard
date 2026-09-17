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
    current_price: float | None
    last_close: float | None
    quote_fetched_at: datetime | None


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
    bars_prepended: int
    detail: UniverseDetail


class PriceBarOut(BaseModel):
    date: date
    close: float | None
    adj_close: float | None


class HistoryResponse(BaseModel):
    ticker: str
    bars: list[PriceBarOut]


class StripQuote(BaseModel):
    ticker: str
    name: str
    quote_type: str | None
    price: float | None
    change: float | None
    pct: float | None


class StripReturn(BaseModel):
    ticker: str
    pct: float


class StripGroup(BaseModel):
    label: str
    today: list[StripQuote]
    five_day: list[StripReturn]
    thirty_day: list[StripReturn]
    ytd: list[StripReturn]


class StripResponse(BaseModel):
    groups: list[StripGroup]
    as_of: datetime | None


class NewsArticleOut(BaseModel):
    id: str
    title: str
    summary: str | None
    publisher: str | None
    url: str | None
    thumbnail_url: str | None
    pub_date: datetime | None
    source_ticker: str | None


class NewsSummaryOut(BaseModel):
    text: str
    created_at: datetime
    model: str | None
    article_count: int | None


class NewsResponse(BaseModel):
    articles: list[NewsArticleOut]
    as_of: datetime | None
    summary: NewsSummaryOut | None


class QuoteRefreshResult(BaseModel):
    refreshed: int
    fetched_at: datetime | None


class AddTickerRequest(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def _ticker_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ticker must not be blank")
        return value
