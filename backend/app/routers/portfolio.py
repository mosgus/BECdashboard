"""Portfolio value-series endpoint over stored adjusted closing prices."""

import math
from datetime import date
from dataclasses import asdict

import pandas as pd
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import is_enabled, session
from app.capm_run import CapmInputError, HoldingConfig, run_capm
from app.risk_run import RiskInputError, run_risk
from app.attribution_run import AttributionInputError, run_attribution
from app.ff3 import load_factors
from app.stress_run import StressInputError, run_stress
from app.performance_run import PerformanceInputError, run_performance
from app.indicators import CLOSE_ONLY_INDICATORS, indicator_series
from app.models import PriceBar
from app.montecarlo_run import MonteCarloInputError, run_monte_carlo
from app.forecast_run import ForecastInputError, run_forecast
from app.calibration_run import CalibrationInputError, run_calibration
from app.optimize_run import OptimizeInputError, run_optimize
from app.portfolio_series import build_portfolio_series
from app.rates import fetch_risk_free_rate_with_source
from app.schemas import (
    CalibrationRequest, CalibrationResponse, CapmRequest, CapmResponse, ForecastRequest, ForecastResponse, MonteCarloRequest, MonteCarloResponse,
    OptimizeRequest, OptimizeResponse, PortfolioSeriesResponse, RiskRequest, RiskResponse, StressRequest, StressResponse, PerformanceRequest, PerformanceResponse,
    AttributionRequest, AttributionResponse,
)
from app.signals import compute_all_signals

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

_DATABASE_NOT_CONFIGURED = "Database not configured"


def _require_database() -> None:
    if not is_enabled():
        raise HTTPException(status_code=503, detail=_DATABASE_NOT_CONFIGURED)


def _load_stored_closes(tickers: list[str], *, required: bool = True) -> dict[str, pd.Series]:
    """Load adjusted closes using the same query and missing-history behavior as /series."""
    with session() as db:
        rows = db.execute(
            select(PriceBar.ticker, PriceBar.date, PriceBar.adj_close)
            .where(PriceBar.ticker.in_(tickers), PriceBar.adj_close.is_not(None))
            .order_by(PriceBar.ticker, PriceBar.date)
        ).all()
    bars: dict[str, list[tuple]] = {}
    for ticker, bar_date, adj_close in rows:
        bars.setdefault(ticker, []).append((bar_date, adj_close))
    if required:
        for ticker in tickers:
            if ticker not in bars:
                raise HTTPException(status_code=404, detail=f"No stored price history for {ticker}")
    return {
        ticker: pd.Series([price for _, price in ticker_bars], index=[bar_date for bar_date, _ in ticker_bars])
        for ticker, ticker_bars in bars.items()
    }


def _normalise_request(tickers: list[str], weights: list[float]) -> tuple[list[str], list[float]]:
    requested = [ticker.strip().upper() for ticker in tickers if ticker.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="At least one ticker is required")
    if len(requested) > 100:
        raise HTTPException(status_code=400, detail="At most 100 tickers may be requested")
    seen = set()
    for ticker in requested:
        if ticker in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate ticker: {ticker}")
        seen.add(ticker)
    if len(weights) != len(requested):
        raise HTTPException(status_code=400, detail="weights must be one number per ticker")
    if any(weight <= 0 or not math.isfinite(weight) for weight in weights):
        raise HTTPException(status_code=400, detail="Every weight must be positive")
    return requested, weights


def _safe_metrics(metrics: dict) -> dict:
    """Convert NaN/Infinity metric values to JSON null."""
    return {
        group: None if values is None else {
            name: None if isinstance(value, float) and not math.isfinite(value) else value
            for name, value in values.items()
        }
        for group, values in metrics.items()
    }


@router.get("/series", response_model=PortfolioSeriesResponse)
def get_portfolio_series(
    tickers: str = "", weights: str = "", cash: str = "0", include: str = ""
) -> dict:
    _require_database()
    requested = [ticker.strip().upper() for ticker in tickers.split(",") if ticker.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="At least one ticker is required")
    if len(requested) > 100:
        raise HTTPException(status_code=400, detail="At most 100 tickers may be requested")
    seen = set()
    for ticker in requested:
        if ticker in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate ticker: {ticker}")
        seen.add(ticker)

    try:
        requested_weights = [float(weight.strip()) for weight in weights.split(",")]
    except ValueError:
        requested_weights = []
    if len(requested_weights) != len(requested):
        raise HTTPException(status_code=400, detail="weights must be one number per ticker")
    if any(weight <= 0 or not math.isfinite(weight) for weight in requested_weights):
        raise HTTPException(status_code=400, detail="Every weight must be positive")
    try:
        cash_value = float(cash)
    except ValueError:
        cash_value = float("nan")
    if cash_value < 0 or not math.isfinite(cash_value):
        raise HTTPException(status_code=400, detail="cash must be zero or positive")

    include_set = {key.strip() for key in include.split(",") if key.strip()}
    for key in include_set:
        if key not in CLOSE_ONLY_INDICATORS:
            raise HTTPException(
                status_code=400,
                detail=(f"{key} is not available for a portfolio: it needs a single "
                        "security's high, low or volume"),
            )

    closes = _load_stored_closes(requested)
    allocation = dict(zip(requested, requested_weights, strict=True))
    portfolio = build_portfolio_series(allocation, cash_value, closes)
    total_series = pd.Series(portfolio.total, index=pd.to_datetime(portfolio.dates))
    return {
        "dates": portfolio.dates,
        "value": portfolio.total,
        "cash_value": portfolio.cash_value,
        "holdings": [
            {
                "ticker": ticker,
                "weight": allocation[ticker],
                "first_bar": portfolio.first_bar[ticker],
                "last_close": portfolio.last_close[ticker],
            }
            for ticker in requested
        ],
        "series": indicator_series(include_set, total_series),
        "signals": compute_all_signals(total_series),
    }


@router.post("/optimize", response_model=OptimizeResponse)
def optimize_portfolio(body: OptimizeRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    closes = _load_stored_closes(tickers)
    benchmark = closes.get("SPY")
    if benchmark is None:
        benchmark = _load_stored_closes(["SPY"], required=False).get("SPY")
    rf, rf_source = fetch_risk_free_rate_with_source()
    try:
        result = run_optimize(
            dict(zip(tickers, weights, strict=True)), closes, benchmark,
            mode=body.mode, lookback_days=body.lookback_days, max_weight=body.max_weight,
            min_weight=body.min_weight, vol_target=body.vol_target, allow_short=body.allow_short,
            max_short=body.max_short, rebalance=body.rebalance,
            rf=rf,
        )
    except OptimizeInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "tickers": result.tickers,
        "current_weights": result.current_weights,
        "target_weights": result.target_weights,
        "implied_trades": result.implied_trades,
        "pinned": result.pinned,
        "fit_start": result.fit_start,
        "fit_end": result.fit_end,
        "score_start": result.score_start,
        "score_limited_by": result.score_limited_by,
        "curves": result.curves,
        "metrics": _safe_metrics(result.metrics),
        "feasible": result.feasible,
        "mode": result.mode,
        "rebalance": result.rebalance,
        "lookback_days": result.lookback_days,
        "rf": result.rf,
        "rf_source": rf_source,
        "warnings": result.warnings,
        "frontier": None if result.frontier is None else {
            "points": [{"vol": vol, "ret": ret} for vol, ret in result.frontier.points],
            "cloud": [{"vol": vol, "ret": ret} for vol, ret in result.frontier.cloud],
            "current": {"vol": result.frontier.current[0], "ret": result.frontier.current[1]},
            "optimized": {"vol": result.frontier.optimized[0], "ret": result.frontier.optimized[1]},
            "min_variance": {"vol": result.frontier.min_variance[0], "ret": result.frontier.min_variance[1]},
            "max_sharpe": None if result.frontier.max_sharpe is None else {"vol": result.frontier.max_sharpe[0], "ret": result.frontier.max_sharpe[1]},
            "tickers": result.frontier.tickers,
            "excluded": result.frontier.excluded,
        },
    }


@router.post("/capm", response_model=CapmResponse)
def capm_portfolio(body: CapmRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    market_ticker = body.market_ticker.strip().upper()
    closes = _load_stored_closes(tickers)
    market = closes.get(market_ticker)
    if market is None:
        market = _load_stored_closes([market_ticker], required=False).get(market_ticker)
    if market is None:
        raise HTTPException(
            status_code=422,
            detail=f"No stored price history for market ticker {market_ticker}. Add it to the Universe first.",
        )
    if body.rf is None:
        rf, rf_source = fetch_risk_free_rate_with_source()
    else:
        rf, rf_source = body.rf, "manual"
    configs = {
        key.strip().upper(): HoldingConfig(**value.model_dump())
        for key, value in body.configs.items()
    }
    try:
        result = run_capm(
            dict(zip(tickers, weights, strict=True)), closes, market,
            market_ticker=market_ticker, rf=rf, mrp=body.mrp,
            lookback_days=body.lookback_days, configs=configs,
        )
    except CapmInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "tickers": result.tickers,
        "holdings": [asdict(holding) for holding in result.holdings],
        "current_weights": result.current_weights,
        "target_weights": result.target_weights,
        "metrics": {
            "expected_return": result.expected_return,
            "expected_vol": result.expected_vol,
            "expected_sharpe": result.expected_sharpe,
            "portfolio_beta": result.portfolio_beta,
        },
        "current_metrics": result.current_metrics,
        "var_95": result.var_95,
        "rf": result.rf,
        "rf_source": rf_source,
        "mrp": result.mrp,
        "market_ticker": result.market_ticker,
        "lookback_days": result.lookback_days,
        "fit_start": result.fit_start,
        "fit_end": result.fit_end,
        "score_start": result.score_start,
        "warnings": result.warnings,
    }


@router.post("/risk", response_model=RiskResponse)
def risk_portfolio(body: RiskRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    market_ticker = body.market_ticker.strip().upper()
    closes = _load_stored_closes(tickers)
    market = closes.get(market_ticker)
    if market is None:
        market = _load_stored_closes([market_ticker], required=False).get(market_ticker)
    if market is None:
        raise HTTPException(
            status_code=422,
            detail=f"No stored price history for market ticker {market_ticker}. Add it to the Universe first.",
        )
    try:
        result = run_risk(
            dict(zip(tickers, weights, strict=True)), body.cash, closes, market,
            market_ticker=market_ticker, lookback_days=body.lookback_days,
        )
    except RiskInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(result)


@router.post("/stress", response_model=StressResponse)
def stress_portfolio(body: StressRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    market_ticker = body.market_ticker.strip().upper()
    closes = _load_stored_closes(tickers)
    market = closes.get(market_ticker)
    if market is None:
        market = _load_stored_closes([market_ticker], required=False).get(market_ticker)
    if market is None:
        raise HTTPException(
            status_code=422,
            detail=f"No stored price history for market ticker {market_ticker}. Add it to the Universe first.",
        )
    try:
        result = run_stress(
            dict(zip(tickers, weights, strict=True)), body.cash, closes, market,
            market_ticker=market_ticker, start=body.start, end=body.end,
        )
    except StressInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(result)

@router.post("/performance", response_model=PerformanceResponse)
def performance_portfolio(body: PerformanceRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    market_ticker = body.market_ticker.strip().upper()
    closes = _load_stored_closes(tickers)
    market = closes.get(market_ticker)
    if market is None:
        market = _load_stored_closes([market_ticker], required=False).get(market_ticker)
    if market is None:
        raise HTTPException(
            status_code=422,
            detail=f"No stored price history for market ticker {market_ticker}. Add it to the Universe first.",
        )
    rf, rf_source = fetch_risk_free_rate_with_source()
    try:
        result = run_performance(
            dict(zip(tickers, weights, strict=True)),
            body.cash,
            closes,
            market,
            market_ticker=market_ticker,
            start=body.start,
            end=body.end,
            today=date.today(),
            rf=rf,
        )
    except PerformanceInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    safe = _safe_metrics({"metrics": result.metrics, "bench_metrics": result.bench_metrics})
    return {**asdict(result), **safe, "rf_source": rf_source}


@router.post("/attribution", response_model=AttributionResponse)
def attribution_portfolio(body: AttributionRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    market_ticker = body.market_ticker.strip().upper()
    closes = _load_stored_closes(tickers)
    market = closes.get(market_ticker)
    if market is None:
        market = _load_stored_closes([market_ticker], required=False).get(market_ticker)
    if market is None:
        raise HTTPException(
            status_code=422,
            detail=f"No stored price history for market ticker {market_ticker}. Add it to the Universe first.",
        )
    factors = load_factors()
    if factors.empty:
        raise HTTPException(
            status_code=503,
            detail="Fama-French factor data hasn't been downloaded yet. It loads in the background with the next data refresh; try again in a minute.",
        )
    try:
        result = run_attribution(
            dict(zip(tickers, weights, strict=True)),
            body.cash,
            closes,
            market,
            factors,
            market_ticker=market_ticker,
            start=body.start,
            end=body.end,
            today=date.today(),
        )
    except AttributionInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**asdict(result), "market_ticker": market_ticker}


@router.post("/montecarlo", response_model=MonteCarloResponse)
def montecarlo_portfolio(body: MonteCarloRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    closes = _load_stored_closes(tickers)
    try:
        result = run_monte_carlo(
            dict(zip(tickers, weights, strict=True)), body.cash, closes,
            initial_value=body.initial_value, horizon_days=body.horizon_days,
            num_simulations=body.num_simulations, lookback_days=body.lookback_days, model=body.model,
        )
    except MonteCarloInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(result)


@router.post("/forecast", response_model=ForecastResponse)
def forecast_portfolio(body: ForecastRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    closes = _load_stored_closes(tickers)
    try:
        result = run_forecast(
            dict(zip(tickers, weights, strict=True)), body.cash, closes,
            initial_value=body.initial_value, horizon_days=body.horizon_days,
            num_simulations=body.num_simulations, lookback_days=body.lookback_days, model=body.model,
        )
    except ForecastInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(result)


@router.post("/calibration", response_model=CalibrationResponse)
def calibrate_portfolio(body: CalibrationRequest) -> dict:
    _require_database()
    tickers, weights = _normalise_request(body.tickers, body.weights)
    closes = _load_stored_closes(tickers)
    try:
        result = run_calibration(
            dict(zip(tickers, weights, strict=True)), body.cash, closes,
            lookback_days=body.lookback_days, model=body.model,
        )
    except CalibrationInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return asdict(result)
