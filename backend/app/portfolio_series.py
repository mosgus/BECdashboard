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

    import numpy as np

    values = prices[list(weights)].to_numpy(dtype=float)
    units_vector = np.array([units[ticker] for ticker in weights], dtype=float)
    holding_values = np.empty(values.shape, dtype=float)
    total_values = np.empty(len(dates), dtype=float)
    rebalance_dates: list[date] = []
    if rebalance == "none":
        rebalance_indices = []
    else:
        period_keys = [_period_key(current_date, rebalance) for current_date in dates]
        rebalance_indices = [
            index
            for index in range(1, len(dates))
            if period_keys[index] != period_keys[index - 1]
        ]
        rebalance_dates = [dates[index] for index in rebalance_indices]

    segment_starts = [0, *rebalance_indices]
    segment_ends = [*rebalance_indices, len(dates)]
    for segment_start, segment_end in zip(segment_starts, segment_ends):
        if segment_start > 0:
            value = 0.0
            for column in range(len(weights)):
                value += units_vector[column] * float(values[segment_start, column])
            units_vector = np.array(
                [
                    normalised[ticker] * value / values[segment_start, column]
                    for column, ticker in enumerate(weights)
                ],
                dtype=float,
            )
        segment_values = values[segment_start:segment_end] * units_vector
        holding_values[segment_start:segment_end] = segment_values
        segment_totals = segment_values[:, 0].copy()
        for column in range(1, len(weights)):
            segment_totals += segment_values[:, column]
        total_values[segment_start:segment_end] = segment_totals

    return BacktestSeries(
        dates=dates,
        total=total_values.tolist(),
        by_holding={
            ticker: holding_values[:, column].tolist()
            for column, ticker in enumerate(weights)
        },
        start=start,
        rebalance_dates=rebalance_dates,
    )
