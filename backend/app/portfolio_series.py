"""Pure buy-and-hold portfolio value-series calculations."""

from dataclasses import dataclass
from datetime import date
from typing import Literal

import pandas as pd


@dataclass(frozen=True)
class PortfolioSeries:
    dates: list[date]
    total: list[float]
    by_holding: dict[str, list[float]]
    cash_value: float
    first_bar: dict[str, date]
    last_close: dict[str, float]


def align_closes(closes: dict[str, pd.Series]) -> pd.DataFrame:
    """Align closing prices on their date union, flat-filling absent early history."""
    prices = pd.DataFrame(closes).sort_index()
    return prices.ffill().bfill()


def units_from_weights(
    weights: dict[str, float],
    cash_weight: float,
    anchor_prices: dict[str, float],
    anchor_value: float = 100.0,
) -> tuple[dict[str, float], float]:
    total = sum(weights.values()) + cash_weight
    units = {
        ticker: weight / total * anchor_value / anchor_prices[ticker]
        for ticker, weight in weights.items()
    }
    return units, cash_weight / total * anchor_value


def value_series(
    units: dict[str, float], cash_value: float, prices: pd.DataFrame
) -> tuple[pd.Series, pd.DataFrame]:
    by_holding = prices[list(units)].multiply(pd.Series(units), axis="columns")
    return by_holding.sum(axis=1) + cash_value, by_holding


def build_portfolio_series(
    weights: dict[str, float], cash_weight: float, closes: dict[str, pd.Series]
) -> PortfolioSeries:
    first_bar = {ticker: series.index[0] for ticker, series in closes.items()}
    prices = align_closes(closes)
    last_close = {ticker: float(prices.iloc[-1][ticker]) for ticker in weights}
    units, cash_value = units_from_weights(weights, cash_weight, last_close)
    total, by_holding = value_series(units, cash_value, prices)
    return PortfolioSeries(
        dates=list(prices.index),
        total=[float(value) for value in total],
        by_holding={ticker: [float(value) for value in by_holding[ticker]] for ticker in weights},
        cash_value=float(cash_value),
        first_bar=first_bar,
        last_close=last_close,
    )


Rebalance = Literal["none", "monthly", "quarterly", "annual"]

_REBALANCE_SCHEDULES = ("none", "monthly", "quarterly", "annual")


@dataclass(frozen=True)
class BacktestSeries:
    dates: list[date]
    total: list[float]
    by_holding: dict[str, list[float]]
    start: date
    rebalance_dates: list[date]


def _period_key(d: date, rebalance: Rebalance):
    if rebalance == "monthly":
        return (d.year, d.month)
    if rebalance == "quarterly":
        return (d.year, (d.month - 1) // 3)
    return d.year


def backtest_series(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    rebalance: Rebalance = "none",
    anchor_value: float = 100.0,
) -> BacktestSeries:
    if not weights:
        raise ValueError("weights is empty")
    weight_sum = sum(weights.values())
    if weight_sum <= 0:
        raise ValueError("weights must sum to a positive number")
    if rebalance not in _REBALANCE_SCHEDULES:
        raise ValueError(f"unknown rebalance schedule: {rebalance!r}")
    for ticker in weights:
        if ticker not in closes or closes[ticker].empty:
            raise ValueError(f"missing closes for weighted ticker {ticker!r}")

    normalised = {ticker: weight / weight_sum for ticker, weight in weights.items()}

    start = max(closes[ticker].index[0] for ticker in weights)
    prices = pd.DataFrame({ticker: closes[ticker] for ticker in weights}).sort_index()
    prices = prices.loc[prices.index >= start].ffill()

    dates = list(prices.index)
    prices_at_start = {ticker: float(prices.iloc[0][ticker]) for ticker in weights}
    units, _ = units_from_weights(normalised, 0.0, prices_at_start, anchor_value)

    total: list[float] = []
    by_holding: dict[str, list[float]] = {ticker: [] for ticker in weights}
    rebalance_dates: list[date] = []
    previous_key = _period_key(dates[0], rebalance) if rebalance != "none" else None

    for index, current_date in enumerate(dates):
        row = prices.iloc[index]
        if index > 0 and rebalance != "none":
            key = _period_key(current_date, rebalance)
            if key != previous_key:
                rebalance_dates.append(current_date)
                value = sum(units[ticker] * float(row[ticker]) for ticker in weights)
                units = {
                    ticker: normalised[ticker] * value / float(row[ticker]) for ticker in weights
                }
            previous_key = key
        row_values = {ticker: units[ticker] * float(row[ticker]) for ticker in weights}
        for ticker in weights:
            by_holding[ticker].append(row_values[ticker])
        total.append(sum(row_values.values()))

    return BacktestSeries(
        dates=dates,
        total=total,
        by_holding=by_holding,
        start=start,
        rebalance_dates=rebalance_dates,
    )
