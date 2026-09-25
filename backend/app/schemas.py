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
    prior_close: float | None
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


class IndicatorSeries(BaseModel):
    key: str
    label: str
    points: list[float | None]


class IndicatorsResponse(BaseModel):
    ticker: str
    dates: list[date]
    series: list[IndicatorSeries]


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
    quotes_stale: bool


class TickerReturns(BaseModel):
    ticker: str
    five_day: float | None
    thirty_day: float | None
    ytd: float | None


class ReturnsResponse(BaseModel):
    returns: list[TickerReturns]
    as_of: date | None


class SignalOut(BaseModel):
    signal: str
    label: str
    state: str | None
    last_trigger_date: date | None
    value: float | None


class PortfolioHolding(BaseModel):
    ticker: str
    weight: float
    first_bar: date
    last_close: float


class PortfolioSeriesResponse(BaseModel):
    dates: list[date]
    value: list[float]
    cash_value: float
    holdings: list[PortfolioHolding]
    series: list[IndicatorSeries]
    signals: list[SignalOut]


class OptimizeRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    mode: str = "min_variance"
    lookback_days: int = 1825
    max_weight: float = 1.0
    min_weight: float = 0.0
    vol_target: float = 0.10
    allow_short: bool = False
    conviction_views: dict[str, float] | None = None
    kappa: float = 0.05
    rebalance: str = "none"


class TiltRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    baseline: str = "current"
    optimizer_mode: str | None = None
    conviction: dict[str, float] = {}
    lam: float = 1.0
    u0: float = 20.0
    lookback_days: int = 1825


class PinnedHoldingOut(BaseModel):
    ticker: str
    first_bar: date
    weight: float
    exceeds_max: bool


class OptimizeCurvesOut(BaseModel):
    dates: list[date]
    current: list[float]
    optimized: list[float]
    benchmark: list[float] | None


class OptimizeResponse(BaseModel):
    tickers: list[str]
    current_weights: dict[str, float]
    target_weights: dict[str, float]
    implied_trades: dict[str, float]
    pinned: list[PinnedHoldingOut]
    fit_start: date
    fit_end: date
    score_start: date
    score_limited_by: str | None
    curves: OptimizeCurvesOut
    metrics: dict[str, dict[str, float | None] | None]
    capm_expected_returns: dict[str, float] | None
    feasible: bool
    mode: str
    rebalance: str
    lookback_days: int
    views_applied: bool
    delta_mu: dict[str, float]
    warnings: list[str]


class TickerSignals(BaseModel):
    ticker: str
    signals: list[SignalOut]
    atr: float | None
    atr_pct: float | None


class SignalsResponse(BaseModel):
    signals: list[TickerSignals]
    as_of: date | None


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


class DeleteResult(BaseModel):
    ticker: str
    bars_deleted: int
    fundamentals_deleted: int
    quotes_deleted: int


class AddTickerRequest(BaseModel):
    ticker: str

    @field_validator("ticker")
    @classmethod
    def _ticker_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ticker must not be blank")
        return value


class OpsDatabaseStatus(BaseModel):
    connected: bool
    revision: str | None


class OpsUniverseStatus(BaseModel):
    active_tickers: int
    total_bars: int
    newest_bar_date: date | None


class OpsNewsStatus(BaseModel):
    article_count: int
    newest_fetched_at: datetime | None


class OpsBriefingStatus(BaseModel):
    exists: bool
    model: str | None
    created_at: datetime | None


class OpsWindowsStatus(BaseModel):
    auto_refresh_last_claim: datetime | None
    news_refresh_last_claim: datetime | None
    current_window_start: datetime | None


class OpsStatus(BaseModel):
    database: OpsDatabaseStatus
    universe: OpsUniverseStatus
    news: OpsNewsStatus
    briefing: OpsBriefingStatus
    gemini_key_configured: bool
    python: str
    windows: OpsWindowsStatus


class JobRunOut(BaseModel):
    id: int
    job_name: str
    started_at: datetime
    finished_at: datetime | None
    status: str
    duration_ms: int | None
    detail: dict | None


class JobRunsResponse(BaseModel):
    job_runs: list[JobRunOut]
