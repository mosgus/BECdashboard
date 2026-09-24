"""Pure buy-and-hold portfolio value-series calculations."""

from dataclasses import dataclass
from datetime import date

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
