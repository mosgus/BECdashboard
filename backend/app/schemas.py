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
    max_short: float = 0.30
    rebalance: str = "none"


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


class FrontierPointOut(BaseModel):
    vol: float
    ret: float


class FrontierOut(BaseModel):
    points: list[FrontierPointOut]
    cloud: list[FrontierPointOut]
    current: FrontierPointOut
    optimized: FrontierPointOut
    min_variance: FrontierPointOut
    max_sharpe: FrontierPointOut | None
    tickers: list[str]
    excluded: list[str]


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
    feasible: bool
    mode: str
    rebalance: str
    lookback_days: int
    rf: float
    rf_source: str
    warnings: list[str]
    frontier: FrontierOut | None


class CapmHoldingConfigIn(BaseModel):
    freeze: bool = False
    view: float = 0.0
    min_weight: float = 0.0
    max_weight: float = 1.0


class CapmRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    lookback_days: int = 1825
    rf: float | None = None
    mrp: float = 0.05
    market_ticker: str = "SPY"
    configs: dict[str, CapmHoldingConfigIn] = {}


class CapmHoldingOut(BaseModel):
    ticker: str
    current_weight: float
    target_weight: float
    beta: float
    capm_return: float
    view: float
    expected_return: float
    vol: float
    frozen: bool
    pinned: bool
    first_bar: date


class CapmMetricsOut(BaseModel):
    expected_return: float
    expected_vol: float
    expected_sharpe: float | None
    portfolio_beta: float


class CapmVarOut(BaseModel):
    daily: float
    weekly: float
    monthly: float
    quarterly: float
    annual: float


class CapmResponse(BaseModel):
    tickers: list[str]
    holdings: list[CapmHoldingOut]
    current_weights: dict[str, float]
    target_weights: dict[str, float]
    metrics: CapmMetricsOut
    current_metrics: CapmMetricsOut
    var_95: CapmVarOut
    rf: float
    rf_source: str
    mrp: float
    market_ticker: str
    lookback_days: int
    fit_start: date
    fit_end: date
    score_start: date
    warnings: list[str]


class MonteCarloRequest(BaseModel):
    tickers: list[str]
    weights: list[float]
    cash: float = 0.0
    initial_value: float
    horizon_days: int = 252
    num_simulations: int = 1000
    lookback_days: int = 1825
    model: str = "bootstrap"


class MonteCarloPathPointOut(BaseModel):
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


class MonteCarloTerminalOut(BaseModel):
    mean: float
    median: float
    p5: float
    p25: float
    p75: float
    p95: float
    prob_loss: float
    mean_return: float
    median_return: float


class MonteCarloResponse(BaseModel):
    tickers: list[str]
    weights: dict[str, float]
    cash_weight: float
    model: str
    seed: int
    horizon_days: int
    num_simulations: int
    initial_value: float
    lookback_days: int
    fit_start: date
    fit_end: date
    n_returns: int
    daily_mean: float
    daily_vol: float
    paths: list[MonteCarloPathPointOut]
    terminal: MonteCarloTerminalOut
    warnings: list[str]


class ForecastRequest(MonteCarloRequest):
    model: str = "garch"


class ForecastVolPointOut(BaseModel):
    date: date
    vol: float


class ForecastVolForecastPointOut(BaseModel):
    day: int
    vol: float


class ForecastHistoryPointOut(BaseModel):
    date: date
    value: float


class ForecastResponse(BaseModel):
    tickers: list[str]
    weights: dict[str, float]
    cash_weight: float
    model: str
    seed: int
    horizon_days: int
    num_simulations: int
    initial_value: float
    lookback_days: int
    fit_start: date
    fit_end: date
    n_returns: int
    daily_drift: float
    current_vol: float
    lookback_vol: float
    params: dict[str, float]
    members: list[str]
    member_medians: dict[str, float]
    paths: list[MonteCarloPathPointOut]
    terminal: MonteCarloTerminalOut
    vol_forecast: list[ForecastVolForecastPointOut]
    vol_history: list[ForecastVolPointOut]
    history: list[ForecastHistoryPointOut]
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
    sweep_active: bool


class ForceRefreshStarted(BaseModel):
    started: bool
    started_at: datetime


class SweepStatus(BaseModel):
    active: bool


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
