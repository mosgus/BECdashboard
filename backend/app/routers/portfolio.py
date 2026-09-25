"""Portfolio value-series endpoint over stored adjusted closing prices."""

import math

import pandas as pd
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.db import is_enabled, session
from app.indicators import CLOSE_ONLY_INDICATORS, indicator_series
from app.models import PriceBar
from app.optimize_run import OptimizeInputError, run_optimize
from app.optimizer import compute_tilt
from app.portfolio_series import build_portfolio_series
from app.rates import fetch_risk_free_rate
from app.schemas import OptimizeRequest, OptimizeResponse, PortfolioSeriesResponse, TiltRequest
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
    conviction_views = (
        {ticker.strip().upper(): value for ticker, value in body.conviction_views.items()}
        if body.conviction_views else None
    )
    try:
        result = run_optimize(
            dict(zip(tickers, weights, strict=True)), closes, benchmark,
            mode=body.mode, lookback_days=body.lookback_days, max_weight=body.max_weight,
            min_weight=body.min_weight, vol_target=body.vol_target, allow_short=body.allow_short,
            max_short=body.max_short,
            conviction_views=conviction_views, kappa=body.kappa, rebalance=body.rebalance,
            rf=fetch_risk_free_rate(),
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
        "capm_expected_returns": result.capm_expected_returns,
        "feasible": result.feasible,
        "mode": result.mode,
        "rebalance": result.rebalance,
        "lookback_days": result.lookback_days,
        "views_applied": result.views_applied,
        "delta_mu": result.delta_mu,
        "rf": result.rf,
        "warnings": result.warnings,
    }


@router.post("/tilt")
def tilt_portfolio(body: TiltRequest) -> dict:
    tickers, weights = _normalise_request(body.tickers, body.weights)
    conviction = {ticker.strip().upper(): value for ticker, value in body.conviction.items()}
    allocation = dict(zip(tickers, weights, strict=True))
    if body.baseline == "equal":
        base_weights = {ticker: 1.0 / len(tickers) for ticker in tickers}
    elif body.baseline == "current":
        total = sum(weights)
        base_weights = {ticker: weight / total for ticker, weight in allocation.items()}
    elif body.baseline == "optimizer":
        mode = body.optimizer_mode or "min_variance"
        if mode not in {"equal_weight", "min_variance", "max_sharpe", "risk_parity"}:
            raise HTTPException(status_code=422, detail=f"Unknown optimizer mode: {mode}")
        _require_database()
        closes = _load_stored_closes(tickers)
        benchmark = closes.get("SPY")
        if benchmark is None:
            benchmark = _load_stored_closes(["SPY"], required=False).get("SPY")
        try:
            base_weights = run_optimize(
                allocation, closes, benchmark, mode=mode, lookback_days=body.lookback_days
            ).target_weights
        except OptimizeInputError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    else:
        raise HTTPException(status_code=422, detail=f"Unknown tilt baseline: {body.baseline}")
    # FLAG(custom): see compute_tilt. The "optimizer" baseline calls optimize_max_sharpe without rf (rf = 0).
    tilt_weights = compute_tilt(base_weights, conviction, lam=body.lam, u0=body.u0)
    return {
        "tilt_weights": tilt_weights,
        "base_weights": base_weights,
        "source": "tilt",
        "params": {
            "baseline": body.baseline,
            "optimizer_mode": body.optimizer_mode,
            "conviction": conviction,
            "lam": body.lam,
            "u0": body.u0,
        },
    }
