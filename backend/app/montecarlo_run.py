"""Pure Monte Carlo simulation for the Outlook tab."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.optimize_run import PIN_GRACE_DAYS, lookback_error


MODELS = ("bootstrap", "normal")
MAX_HORIZON_DAYS = 756
MIN_RETURNS = 60


class MonteCarloInputError(ValueError):
    """The request cannot be simulated as asked. The router maps it to HTTP 422 with str(exc) as the detail."""


@dataclass(frozen=True)
class PathPoint:
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


@dataclass(frozen=True)
class TerminalStats:
    mean: float
    median: float
    p5: float
    p25: float
    p75: float
    p95: float
    prob_loss: float
    mean_return: float
    median_return: float


@dataclass(frozen=True)
class MonteCarloResult:
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
    paths: list[PathPoint]
    terminal: TerminalStats
    warnings: list[str]


def run_monte_carlo(
    weights: dict[str, float],
    cash: float,
    closes: dict[str, pd.Series],
    *,
    initial_value: float,
    horizon_days: int = 252,
    num_simulations: int = 1000,
    lookback_days: int = 1825,
    model: str = "bootstrap",
    seed: int = 42,
) -> MonteCarloResult:
    """Simulate constant-weight portfolio value paths from stored daily returns."""
    if error := lookback_error(lookback_days):
        raise MonteCarloInputError(error)
    if model not in MODELS:
        raise MonteCarloInputError('model must be "bootstrap" or "normal"')
    if not 1 <= horizon_days <= MAX_HORIZON_DAYS:
        raise MonteCarloInputError(f"horizon_days must be between 1 and {MAX_HORIZON_DAYS}")
    if not 100 <= num_simulations <= 10000:
        raise MonteCarloInputError("num_simulations must be between 100 and 10000")
    if not (math.isfinite(initial_value) and initial_value > 0):
        raise MonteCarloInputError("initial_value must be finite and greater than zero")
    if not weights or any(not math.isfinite(weight) or weight <= 0 for weight in weights.values()):
        raise MonteCarloInputError("weights must be finite and greater than zero")
    if not (math.isfinite(cash) and cash >= 0):
        raise MonteCarloInputError("cash must be finite and zero or more")
    for ticker in weights:
        if ticker not in closes or closes[ticker].empty:
            raise MonteCarloInputError(f"missing closes for weighted ticker {ticker!r}")

    tickers = list(weights)
    total = sum(weights.values()) + cash
    portfolio_weights = {ticker: float(weights[ticker] / total) for ticker in tickers}
    cash_weight = float(cash / total)
    end = min(closes[ticker].index[-1] for ticker in tickers)
    lookback_start = end - timedelta(days=lookback_days)
    prices = pd.DataFrame({ticker: closes[ticker] for ticker in tickers})
    prices = prices.loc[(prices.index >= lookback_start) & (prices.index <= end)].sort_index().ffill()
    returns = prices.pct_change().dropna()
    n_returns = len(returns)
    if n_returns < MIN_RETURNS:
        raise MonteCarloInputError(
            f"Need at least {MIN_RETURNS} daily returns to simulate, but the holdings share only {n_returns}."
        )

    fit_start, fit_end = returns.index[0], returns.index[-1]
    latest_ticker = max(tickers, key=lambda ticker: closes[ticker].index[0])
    first_bar = closes[latest_ticker].index[0]
    warnings = []
    if first_bar > lookback_start + timedelta(days=PIN_GRACE_DAYS):
        warnings.append(
            f"The simulation uses returns from {fit_start} onward: {latest_ticker} has prices only from {first_bar}."
        )

    w = np.array([portfolio_weights[ticker] for ticker in tickers])
    port = returns.values @ w
    daily_mean = float(port.mean())
    daily_vol = float(port.std(ddof=1))
    rng = np.random.default_rng(seed)
    if model == "bootstrap":
        draws = rng.choice(port, size=(num_simulations, horizon_days), replace=True)
    else:
        draws = daily_mean + daily_vol * rng.standard_normal((num_simulations, horizon_days))
    values = initial_value * np.cumprod(np.maximum(1 + draws, 0.0), axis=1)
    paths_array = np.hstack([np.full((num_simulations, 1), initial_value), values])

    step = max(1, horizon_days // 60)
    days = list(range(0, horizon_days + 1, step))
    if days[-1] != horizon_days:
        days.append(horizon_days)
    paths = []
    for day in days:
        p5, p25, p50, p75, p95 = np.percentile(paths_array[:, day], [5, 25, 50, 75, 95])
        paths.append(PathPoint(day=int(day), p5=float(p5), p25=float(p25), p50=float(p50), p75=float(p75), p95=float(p95)))

    terminal_values = paths_array[:, -1]
    p5, p25, p75, p95 = np.percentile(terminal_values, [5, 25, 75, 95])
    mean = float(terminal_values.mean())
    median = float(np.median(terminal_values))
    terminal = TerminalStats(
        mean=mean,
        median=median,
        p5=float(p5),
        p25=float(p25),
        p75=float(p75),
        p95=float(p95),
        prob_loss=float(np.mean(terminal_values < initial_value)),
        mean_return=float(mean / initial_value - 1),
        median_return=float(median / initial_value - 1),
    )
    return MonteCarloResult(
        tickers=tickers,
        weights=portfolio_weights,
        cash_weight=cash_weight,
        model=model,
        seed=seed,
        horizon_days=horizon_days,
        num_simulations=num_simulations,
        initial_value=initial_value,
        lookback_days=lookback_days,
        fit_start=fit_start,
        fit_end=fit_end,
        n_returns=n_returns,
        daily_mean=daily_mean,
        daily_vol=daily_vol,
        paths=paths,
        terminal=terminal,
        warnings=warnings,
    )
