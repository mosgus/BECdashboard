"""Pure orchestration for portfolio optimization and scored comparison curves."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

import pandas as pd

from app.optimizer import (
    compute_betas,
    compute_capm_expected_returns,
    compute_forward_looking_metrics,
    compute_metrics,
    compute_returns,
    optimize_equal_weight,
    optimize_max_diversification,
    optimize_max_sharpe,
    optimize_max_sharpe_capm,
    optimize_max_sortino,
    optimize_min_cvar,
    optimize_min_variance,
    optimize_risk_parity,
    optimize_target_volatility,
)
from app.portfolio_series import Rebalance, backtest_series


Mode = Literal[
    "equal_weight", "min_variance", "max_sharpe", "max_sharpe_capm", "risk_parity",
    "max_sortino", "min_cvar", "max_diversification", "target_volatility",
]
LOOKBACK_DAYS = (365, 730, 1095, 1825)
PIN_GRACE_DAYS = 7
BENCHMARK = "SPY"
_MODES = set(Mode.__args__)
_REBALANCES = {"none", "monthly", "quarterly", "annual"}


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
    capm_expected_returns: dict[str, float] | None
    feasible: bool
    mode: str
    rebalance: str
    lookback_days: int
    views_applied: bool
    delta_mu: dict[str, float]
    warnings: list[str]


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
    conviction_views: dict[str, float] | None = None,
    kappa: float = 0.05,
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
    if lookback_days not in LOOKBACK_DAYS:
        raise OptimizeInputError(f"lookback_days must be one of {LOOKBACK_DAYS}")
    if rebalance not in _REBALANCES:
        raise OptimizeInputError(f"unknown rebalance schedule: {rebalance!r}")
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
    fit_start, fit_end = returns.index[0], returns.index[-1]
    warnings = ["In-sample: the optimized weights were chosen using the same prices they are scored on."]
    if len(returns) < 60:
        warnings.append("Fewer than 60 trading days of history — optimization results may be unreliable.")

    max_fit = min(1.0, max_weight / fitted_scale)
    global_min = 0.0 if allow_short else min_weight / fitted_scale
    min_w = -max_fit if allow_short else global_min
    if allow_short:
        warnings.append(
            "Short positions enabled. Equal Weight, Risk Parity, and Max Diversification remain long-only."
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

    views_applied = bool(conviction_views) and mode in {"max_sharpe", "max_sharpe_capm", "max_sortino"}
    delta_mu = (
        {ticker: float(kappa * conviction_views.get(ticker, 0.0) / 100.0) for ticker in fitted_tickers}
        if views_applied and conviction_views else {}
    )
    capm_expected_returns: dict[str, float] | None = None
    feasible = True
    try:
        if mode == "equal_weight":
            fitted_weights = optimize_equal_weight(returns)
        elif mode == "min_variance":
            fitted_weights = optimize_min_variance(returns, max_weight=max_fit, min_weight=min_w)
        elif mode == "max_sharpe":
            bumped = returns.copy()
            for ticker, delta in delta_mu.items():
                bumped[ticker] = bumped[ticker] + delta / 252.0
            fitted_weights = optimize_max_sharpe(bumped, max_weight=max_fit, min_weight=min_w)
        elif mode == "max_sharpe_capm":
            if benchmark is None:
                raise OptimizeInputError("SPY benchmark is required for CAPM optimization.")
            capm_prices = fit_prices.join(benchmark.rename(BENCHMARK), how="outer")
            capm_prices = capm_prices.loc[
                (capm_prices.index >= lookback_start) & (capm_prices.index <= end)
            ].ffill()
            betas = compute_betas(compute_returns(capm_prices), BENCHMARK)
            capm_views = {ticker: view / 100.0 for ticker, view in (conviction_views or {}).items()}
            capm_expected_returns = compute_capm_expected_returns(betas, rf=rf, mrp=0.05, views=capm_views)
            capm_expected_returns = {
                ticker: float(value + delta_mu.get(ticker, 0.0))
                for ticker, value in capm_expected_returns.items()
            }
            fitted_weights = optimize_max_sharpe_capm(
                returns, capm_expected_returns, rf=rf, max_weight=max_fit, min_weight=min_w
            )
        elif mode == "risk_parity":
            fitted_weights = optimize_risk_parity(returns, max_weight=max_fit)
        elif mode == "max_sortino":
            bumped = returns.copy()
            for ticker, delta in delta_mu.items():
                bumped[ticker] = bumped[ticker] + delta / 252.0
            fitted_weights = optimize_max_sortino(bumped, max_weight=max_fit, min_weight=min_w)
        elif mode == "min_cvar":
            fitted_weights = optimize_min_cvar(returns, max_weight=max_fit, min_weight=min_w)
        elif mode == "max_diversification":
            fitted_weights = optimize_max_diversification(returns, max_weight=max_fit)
        else:
            fitted_weights = optimize_target_volatility(
                returns, vol_target=vol_target, max_weight=max_fit, min_weight=min_w
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
    forward_looking = (
        compute_forward_looking_metrics(fitted_weights, capm_expected_returns or {}, returns, rf=rf)
        if mode == "max_sharpe_capm" else None
    )
    metrics = {
        "current": compute_metrics(current_returns, benchmark_returns),
        "optimized": compute_metrics(optimized_returns, benchmark_returns),
        "forward_looking": forward_looking,
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
        capm_expected_returns=capm_expected_returns,
        feasible=feasible,
        mode=mode,
        rebalance=rebalance,
        lookback_days=lookback_days,
        views_applied=views_applied,
        delta_mu=delta_mu,
        warnings=warnings,
    )
