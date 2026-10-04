"""Pure orchestration for the Risk & Perf tab's risk breakdown."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.optimize_run import PIN_GRACE_DAYS, lookback_error
from app.optimizer import compute_betas, compute_returns


class RiskInputError(ValueError):
    """The requested risk calculation cannot be made. The router maps this to HTTP 422."""


@dataclass(frozen=True)
class RiskHolding:
    ticker: str
    weight: float
    invested_weight: float
    vol: float
    beta: float
    risk_share: float | None


@dataclass(frozen=True)
class RiskResult:
    tickers: list[str]
    holdings: list[RiskHolding]
    market_ticker: str
    lookback_days: int
    start: date
    end: date
    n_returns: int
    cash_weight: float
    portfolio_vol: float
    portfolio_beta: float
    hhi: float
    effective_holdings: float
    top5_weight: float
    warnings: list[str]


def run_risk(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
    *, market_ticker: str, lookback_days: int = 365,
) -> RiskResult:
    """Measure present portfolio risk from the common price-history window."""
    if error := lookback_error(lookback_days):
        raise RiskInputError(error)
    if not weights or any(not math.isfinite(weight) or weight <= 0 for weight in weights.values()):
        raise RiskInputError("weights must be finite and greater than zero")
    if not (math.isfinite(cash) and cash >= 0):
        raise RiskInputError("cash must be finite and zero or more")

    tickers = list(weights)
    for ticker in tickers:
        if ticker not in closes or closes[ticker].empty:
            raise RiskInputError(f"missing closes for weighted ticker {ticker!r}")
    if market.empty:
        raise RiskInputError(f"Market ticker {market_ticker} has no prices.")

    end = min([*(closes[ticker].index[-1] for ticker in tickers), market.index[-1]])
    lookback_start = end - timedelta(days=lookback_days)
    market_first = market.index[0]
    if market_first > lookback_start + timedelta(days=PIN_GRACE_DAYS):
        raise RiskInputError(
            f"Market ticker {market_ticker} has prices only from {market_first}, after the lookback start "
            f"({lookback_start}). Choose a shorter lookback or another market ticker."
        )

    price_columns = {ticker: closes[ticker] for ticker in tickers}
    if market_ticker not in price_columns:
        price_columns[market_ticker] = market
    prices = pd.DataFrame(price_columns)
    prices = prices.loc[(prices.index >= lookback_start) & (prices.index <= end)].sort_index().ffill()
    returns = compute_returns(prices)
    n_returns = len(returns)
    if n_returns < 2:
        raise RiskInputError("Not enough overlapping prices to measure risk. Choose a longer lookback.")

    start = returns.index[0]
    warnings: list[str] = []
    if n_returns < 60:
        warnings.append("Fewer than 60 trading days of history — risk figures may be unreliable.")
    late = [ticker for ticker in tickers if closes[ticker].index[0] > lookback_start + timedelta(days=PIN_GRACE_DAYS)]
    if late:
        starts = ", ".join(f"{ticker} ({closes[ticker].index[0]})" for ticker in late)
        warnings.append(
            f"Risk figures use prices from {start} onward, the first date every holding has prices. Later starts: {starts}."
        )

    total = sum(weights.values()) + cash
    portfolio_weights = np.array([weights[ticker] / total for ticker in tickers], dtype=float)
    invested_total = sum(weights.values())
    invested_weights = np.array([weights[ticker] / invested_total for ticker in tickers], dtype=float)
    covariance = returns[tickers].cov().values * 252
    variance = float(portfolio_weights @ covariance @ portfolio_weights)
    portfolio_vol = float(math.sqrt(max(variance, 0.0)))
    marginal = covariance @ portfolio_weights
    risk_shares = [None] * len(tickers) if portfolio_vol <= 1e-12 else [
        float(portfolio_weights[index] * marginal[index] / variance) for index in range(len(tickers))
    ]

    betas = compute_betas(returns, market_ticker)
    if market_ticker in weights:
        betas[market_ticker] = 1.0
    for ticker in tickers:
        beta = betas.get(ticker, float("nan"))
        if not math.isfinite(beta):
            raise RiskInputError(f"Beta for {ticker} cannot be estimated from the available prices.")
    beta_array = np.array([betas[ticker] for ticker in tickers], dtype=float)
    portfolio_beta = float(portfolio_weights @ beta_array)
    vols = np.sqrt(np.maximum(np.diag(covariance), 0.0))
    hhi = float(invested_weights @ invested_weights)

    return RiskResult(
        tickers=tickers,
        holdings=[
            RiskHolding(
                ticker=ticker,
                weight=float(portfolio_weights[index]),
                invested_weight=float(invested_weights[index]),
                vol=float(vols[index]),
                beta=float(beta_array[index]),
                risk_share=risk_shares[index],
            )
            for index, ticker in enumerate(tickers)
        ],
        market_ticker=market_ticker,
        lookback_days=lookback_days,
        start=start,
        end=end,
        n_returns=n_returns,
        cash_weight=float(cash / total),
        portfolio_vol=portfolio_vol,
        portfolio_beta=portfolio_beta,
        hhi=hhi,
        effective_holdings=float(1 / hhi),
        top5_weight=float(np.sort(invested_weights)[-5:].sum()),
        warnings=warnings,
    )
