"""Pure orchestration for the Risk tab's historical stress test."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from app.optimize_run import PIN_GRACE_DAYS
from app.universe import HISTORY_START


MIN_COVERAGE = 0.8


class StressInputError(ValueError):
    """The requested historical replay cannot be made. The router maps it to HTTP 422."""


@dataclass(frozen=True)
class StressHolding:
    ticker: str
    weight: float
    covered: bool
    asset_return: float | None
    contribution: float | None


@dataclass(frozen=True)
class StressPoint:
    date: date
    value: float
    market: float | None


@dataclass(frozen=True)
class StressResult:
    tickers: list[str]
    holdings: list[StressHolding]
    market_ticker: str
    start: date
    end: date
    n_days: int
    cash_weight: float
    coverage: float
    portfolio_return: float
    max_drawdown: float
    worst_day: float
    worst_day_date: date
    market_return: float | None
    path: list[StressPoint]
    warnings: list[str]


def run_stress(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
    *, market_ticker: str, start: date, end: date,
) -> StressResult:
    """Replay a fixed historical window with today's weights held constant."""
    if not weights or any(not math.isfinite(weight) or weight <= 0 for weight in weights.values()):
        raise StressInputError("weights must be finite and greater than zero")
    if not (math.isfinite(cash) and cash >= 0):
        raise StressInputError("cash must be finite and zero or more")
    tickers = list(weights)
    for ticker in tickers:
        if ticker not in closes or closes[ticker].empty:
            raise StressInputError(f"missing closes for weighted ticker {ticker!r}")
    if start >= end:
        raise StressInputError("start must be before end")

    windowed = [series.loc[(series.index >= start) & (series.index <= end)] for series in [*(closes[t] for t in tickers), market]]
    dates = sorted(set().union(*(set(series.index) for series in windowed)))
    if len(dates) < 2:
        suffix = f" Stored prices start at {HISTORY_START}, so earlier periods can't be replayed." if start < HISTORY_START else ""
        raise StressInputError(f"Fewer than 2 trading days of prices between {start} and {end}.{suffix}")
    d0, d_end = dates[0], dates[-1]
    coverage_end = d_end - timedelta(days=PIN_GRACE_DAYS)
    covered = {ticker: closes[ticker].index[0] <= d0 and closes[ticker].index[-1] >= coverage_end for ticker in tickers}
    invested_total = sum(weights.values())
    coverage = sum(weights[ticker] for ticker in tickers if covered[ticker]) / invested_total
    missing = [ticker for ticker in tickers if not covered[ticker]]
    if coverage < MIN_COVERAGE:
        raise StressInputError(
            f"Only {coverage * 100:.1f}% of the invested money has prices for this window (missing: {', '.join(missing)}). At least 80% is needed."
        )

    total = invested_total + cash
    portfolio_weights = {ticker: weights[ticker] / total for ticker in tickers}
    warnings: list[str] = []
    if coverage < 1:
        warnings.append(
            f"{', '.join(missing)} ({100 * (1 - coverage):.1f}% of the invested money) have no prices for the whole window and are counted as flat (0%). The real result could differ."
        )
    relatives: dict[str, pd.Series] = {}
    for ticker in tickers:
        if covered[ticker]:
            prices = closes[ticker].sort_index().reindex(dates, method="ffill")
            relatives[ticker] = prices / prices.iloc[0]
    value = pd.Series(cash / total + sum(portfolio_weights[ticker] for ticker in missing), index=dates, dtype=float)
    for ticker, relative in relatives.items():
        value += portfolio_weights[ticker] * relative

    market_covered = not market.empty and market.index[0] <= d0 and market.index[-1] >= coverage_end
    market_relative = None
    if market_covered:
        market_prices = market.sort_index().reindex(dates, method="ffill")
        market_relative = market_prices / market_prices.iloc[0]
        market_return: float | None = float(market_relative.iloc[-1] - 1)
    else:
        market_return = None
        warnings.append(f"{market_ticker} has no prices for the whole window, so there is no market comparison.")

    daily = value.pct_change().dropna()
    worst_day_date = daily.idxmin()
    return StressResult(
        tickers=tickers,
        holdings=[
            StressHolding(
                ticker=ticker,
                weight=float(portfolio_weights[ticker]),
                covered=covered[ticker],
                asset_return=None if ticker not in relatives else float(relatives[ticker].iloc[-1] - 1),
                contribution=None if ticker not in relatives else float(portfolio_weights[ticker] * (relatives[ticker].iloc[-1] - 1)),
            ) for ticker in tickers
        ],
        market_ticker=market_ticker,
        start=d0,
        end=d_end,
        n_days=len(dates) - 1,
        cash_weight=float(cash / total),
        coverage=float(coverage),
        portfolio_return=float(value.iloc[-1] - 1),
        max_drawdown=float((value / value.cummax() - 1).min()),
        worst_day=float(daily.min()),
        worst_day_date=worst_day_date,
        market_return=market_return,
        path=[StressPoint(date=day, value=float(value.loc[day]), market=None if market_relative is None else float(market_relative.loc[day])) for day in dates],
        warnings=warnings,
    )
