"""Pure orchestration for portfolio optimization and scored comparison curves."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

import pandas as pd
import numpy as np

from app.optimizer import (
    compute_metrics,
    compute_returns,
    efficient_frontier,
    random_portfolios,
    optimize_equal_weight,
    optimize_max_diversification,
    optimize_max_sharpe,
    optimize_max_sortino,
    optimize_min_cvar,
    optimize_min_variance,
    optimize_risk_parity,
    optimize_target_volatility,
)
from app.portfolio_series import Rebalance, backtest_series


Mode = Literal[
    "equal_weight", "min_variance", "max_sharpe", "risk_parity",
    "max_sortino", "min_cvar", "max_diversification", "target_volatility",
]
MIN_LOOKBACK_DAYS = 28
MAX_LOOKBACK_DAYS = 3650
PIN_GRACE_DAYS = 7
_MODES = set(Mode.__args__)
_REBALANCES = {"none", "monthly", "quarterly", "annual"}


def lookback_error(lookback_days: int) -> str | None:
    if not MIN_LOOKBACK_DAYS <= lookback_days <= MAX_LOOKBACK_DAYS:
        return f"lookback_days must be between {MIN_LOOKBACK_DAYS} and {MAX_LOOKBACK_DAYS}"
    return None


class OptimizeInputError(ValueError):
    """The request cannot be optimized as asked. 0106 maps it to HTTP 422 with str(exc) as the detail."""


@dataclass(frozen=True)
class PinnedHolding:
    ticker: str
    first_bar: date
    weight: float
    exceeds_max: bool


@dataclass(frozen=True)
class OptimizeCurves:
    dates: list[date]
    current: list[float]
    optimized: list[float]
    benchmark: list[float] | None


@dataclass(frozen=True)
class FrontierResult:
    points: list[tuple[float, float]]
    cloud: list[tuple[float, float]]
    current: tuple[float, float]
    optimized: tuple[float, float]
    min_variance: tuple[float, float]
    max_sharpe: tuple[float, float] | None
    tickers: list[str]
    excluded: list[str]


@dataclass(frozen=True)
class OptimizeResult:
    tickers: list[str]
    current_weights: dict[str, float]
    target_weights: dict[str, float]
    implied_trades: dict[str, float]
    pinned: list[PinnedHolding]
    fit_start: date
    fit_end: date
    score_start: date
    score_limited_by: str | None
    curves: OptimizeCurves
    metrics: dict
    feasible: bool
    mode: str
    rebalance: str
    lookback_days: int
    rf: float
    warnings: list[str]
    frontier: FrontierResult | None


def run_optimize(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    benchmark: pd.Series | None,
    *,
    mode: Mode = "min_variance",
    lookback_days: int = 1825,
    max_weight: float = 1.0,
    min_weight: float = 0.0,
    vol_target: float = 0.10,
    allow_short: bool = False,
    max_short: float = 0.30,
    rebalance: Rebalance = "none",
    rf: float = 0.0427,
) -> OptimizeResult:
    """Optimize full-history holdings, pin young ones, then score both allocations."""
    if not weights:
        raise OptimizeInputError("weights is empty")
    if any(not math.isfinite(weight) or weight <= 0 for weight in weights.values()):
        raise OptimizeInputError("weights must be finite and greater than zero")
    if mode not in _MODES:
        raise OptimizeInputError(f"unknown optimization mode: {mode!r}")
    if error := lookback_error(lookback_days):
        raise OptimizeInputError(error)
    if rebalance not in _REBALANCES:
        raise OptimizeInputError(f"unknown rebalance schedule: {rebalance!r}")
    if not math.isfinite(max_short) or not 0.0 <= max_short <= 1.0:
        raise OptimizeInputError("max_short must be between 0 and 1")
    for ticker in weights:
        if ticker not in closes or closes[ticker].empty:
            raise OptimizeInputError(f"missing closes for weighted ticker {ticker!r}")

    tickers = list(weights)
    total_weight = sum(weights.values())
    current_weights = {ticker: float(weights[ticker] / total_weight) for ticker in tickers}
    end = min(closes[ticker].index[-1] for ticker in tickers)
    lookback_start = end - timedelta(days=lookback_days)

    pinned_tickers = [
        ticker for ticker in tickers
        if closes[ticker].index[0] > lookback_start + timedelta(days=PIN_GRACE_DAYS)
    ]
    fitted_tickers = [ticker for ticker in tickers if ticker not in pinned_tickers]
    if len(fitted_tickers) < 2:
        raise OptimizeInputError("Need at least 2 holdings with full history to optimize.")

    pinned_weight = sum(current_weights[ticker] for ticker in pinned_tickers)
    fitted_scale = 1.0 - pinned_weight
    pinned = [
        PinnedHolding(
            ticker=ticker,
            first_bar=closes[ticker].index[0],
            weight=float(current_weights[ticker]),
            exceeds_max=bool(current_weights[ticker] > max_weight + 1e-9),
        )
        for ticker in pinned_tickers
    ]

    fit_prices = pd.DataFrame({ticker: closes[ticker] for ticker in fitted_tickers}).sort_index()
    fit_prices = fit_prices.loc[(fit_prices.index >= lookback_start) & (fit_prices.index <= end)].ffill()
    returns = compute_returns(fit_prices)
    if len(returns) <= len(fitted_tickers):
        raise OptimizeInputError(
            f"The lookback has {len(returns)} daily returns for {len(fitted_tickers)} holdings. "
            "Choose a longer lookback so there are more daily returns than holdings."
        )
    fit_start, fit_end = returns.index[0], returns.index[-1]
    warnings = ["In-sample: the optimized weights were chosen using the same prices they are scored on."]
    if len(returns) < 60:
        warnings.append("Fewer than 60 trading days of history — optimization results may be unreliable.")

    max_fit = min(1.0, max_weight / fitted_scale)
    global_min = 0.0 if allow_short else min_weight / fitted_scale
    min_w = -max_fit if allow_short else global_min
    sleeve_short = min(1.0, max_short / fitted_scale) if allow_short else None
    if allow_short:
        warnings.append(
            f"Short positions enabled (total short capped at {max_short:.0%}). Equal Weight, Risk Parity, and Max Diversification remain long-only."
        )

    pin_suffix = f" (after pinning {pinned_weight:.1%} in short-history holdings)" if pinned_tickers else ""
    n_fitted = len(fitted_tickers)
    if global_min > 0 and global_min * n_fitted > 1.0 + 1e-6:
        raise OptimizeInputError(
            f"min_weight ({min_weight:.1%}) × N ({n_fitted}) = {min_weight * n_fitted:.2f} > {fitted_scale:.2f} "
            f"— infeasible. Reduce min weight or the number of positions.{pin_suffix}"
        )
    if max_fit < 1.0 / n_fitted - 1e-6:
        raise OptimizeInputError(
            f"max_weight ({max_weight:.1%}) < {'(1 − pinned)/N' if pinned_tickers else '1/N'} ({fitted_scale / n_fitted:.1%}) "
            f"— infeasible. Increase max weight.{pin_suffix}"
        )

    feasible = True
    try:
        if mode == "equal_weight":
            fitted_weights = optimize_equal_weight(returns)
        elif mode == "min_variance":
            fitted_weights = optimize_min_variance(returns, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
        elif mode == "max_sharpe":
            fitted_weights = optimize_max_sharpe(returns, rf=rf, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
        elif mode == "risk_parity":
            fitted_weights = optimize_risk_parity(returns, max_weight=max_fit, min_weight=global_min)
        elif mode == "max_sortino":
            fitted_weights = optimize_max_sortino(returns, rf=rf, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
        elif mode == "min_cvar":
            fitted_weights = optimize_min_cvar(returns, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
        elif mode == "max_diversification":
            fitted_weights = optimize_max_diversification(returns, max_weight=max_fit, min_weight=global_min)
        else:
            floor_weights = optimize_min_variance(returns, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short)
            w_floor = np.array([floor_weights[t] for t in returns.columns])
            floor_vol = float(np.sqrt(w_floor @ (returns.cov().values * 252) @ w_floor))
            if vol_target < floor_vol - 1e-6:
                raise OptimizeInputError(
                    f"Vol target ({vol_target:.1%}) is below the lowest volatility the optimized holdings can reach "
                    f"({floor_vol:.1%}) within the current weight limits. Raise the target or loosen the limits."
                )
            fitted_weights = optimize_target_volatility(
                returns, vol_target=vol_target, max_weight=max_fit, min_weight=min_w, max_short=sleeve_short
            )
    except RuntimeError as exc:
        warnings.append(f"Optimizer did not converge: {exc}")
        fitted_total = sum(current_weights[ticker] for ticker in fitted_tickers)
        fitted_weights = {ticker: current_weights[ticker] / fitted_total for ticker in fitted_tickers}
        feasible = False

    target_weights = {
        ticker: float(fitted_weights[ticker] * fitted_scale) if ticker in fitted_weights else float(current_weights[ticker])
        for ticker in tickers
    }
    implied_trades = {ticker: float(target_weights[ticker] - current_weights[ticker]) for ticker in tickers}

    frontier: FrontierResult | None = None
    try:
        points = efficient_frontier(
            returns,
            min_weight=min_w,
            max_weight=max_fit,
            max_short=sleeve_short,
        )
        if not points:
            raise ValueError("efficient frontier has no feasible points")
        cloud = [] if allow_short else random_portfolios(returns, min_weight=min_w, max_weight=max_fit)
        mu = returns.mean().values * 252
        cov = returns.cov().values * 252

        def point(weights_array: np.ndarray) -> tuple[float, float]:
            return (
                float(np.sqrt(weights_array @ cov @ weights_array)),
                float(weights_array @ mu),
            )

        current_fit = np.array([current_weights[ticker] for ticker in returns.columns])
        current_fit /= current_fit.sum()
        optimized_fit = np.array([fitted_weights[ticker] for ticker in returns.columns])
        if mode == "max_sharpe":
            max_sharpe = point(optimized_fit)
        else:
            try:
                sharpe_weights = optimize_max_sharpe(
                    returns,
                    rf=rf,
                    max_weight=max_fit,
                    min_weight=min_w,
                    max_short=sleeve_short,
                )
                max_sharpe = point(np.array([sharpe_weights[ticker] for ticker in returns.columns]))
            except RuntimeError:
                max_sharpe = None
        frontier = FrontierResult(
            points=points,
            cloud=cloud,
            current=point(current_fit),
            optimized=point(optimized_fit),
            min_variance=points[0],
            max_sharpe=max_sharpe,
            tickers=list(returns.columns),
            excluded=pinned_tickers,
        )
    except (RuntimeError, ValueError):
        warnings.append("The efficient frontier could not be computed for this run.")

    scored_closes = {
        ticker: closes[ticker].loc[(closes[ticker].index >= lookback_start) & (closes[ticker].index <= end)]
        for ticker in tickers
    }
    current_curve = backtest_series(current_weights, scored_closes, rebalance)
    optimized_curve = backtest_series(target_weights, scored_closes, rebalance)
    score_limited_by = None
    if current_curve.start > fit_start:
        score_limited_by = next(
            (ticker for ticker in tickers if scored_closes[ticker].index[0] == current_curve.start), None
        )

    benchmark_curve: list[float] | None = None
    benchmark_returns: pd.Series | None = None
    if benchmark is None:
        warnings.append("SPY is not stored; benchmark comparison is unavailable.")
    else:
        aligned_benchmark = benchmark.sort_index().reindex(current_curve.dates, method="ffill")
        if aligned_benchmark.isna().any():
            warnings.append("SPY has no bar at or before the scored curve start; benchmark comparison is unavailable.")
        else:
            benchmark_values = aligned_benchmark / aligned_benchmark.iloc[0] * 100.0
            benchmark_curve = [float(value) for value in benchmark_values]
            benchmark_returns = benchmark_values.pct_change().dropna()

    current_returns = pd.Series(current_curve.total).pct_change().dropna()
    optimized_returns = pd.Series(optimized_curve.total).pct_change().dropna()
    metrics = {
        "current": compute_metrics(current_returns, benchmark_returns, rf=rf),
        "optimized": compute_metrics(optimized_returns, benchmark_returns, rf=rf),
    }
    return OptimizeResult(
        tickers=tickers,
        current_weights=current_weights,
        target_weights=target_weights,
        implied_trades=implied_trades,
        pinned=pinned,
        fit_start=fit_start,
        fit_end=fit_end,
        score_start=current_curve.start,
        score_limited_by=score_limited_by,
        curves=OptimizeCurves(
            dates=list(current_curve.dates),
            current=[float(value) for value in current_curve.total],
            optimized=[float(value) for value in optimized_curve.total],
            benchmark=benchmark_curve,
        ),
        metrics=metrics,
        feasible=feasible,
        mode=mode,
        rebalance=rebalance,
        lookback_days=lookback_days,
        rf=rf,
        warnings=warnings,
        frontier=frontier,
    )
