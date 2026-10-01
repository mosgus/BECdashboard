"""Pure orchestration for the Outlook tab's CAPM optimizer."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.stats import norm

from app.optimize_run import PIN_GRACE_DAYS, lookback_error
from app.optimizer import compute_betas, compute_capm_expected_returns, compute_returns, optimize_max_sharpe_capm


class CapmInputError(ValueError):
    """The request cannot be optimized as asked. The router maps it to HTTP 422 with str(exc) as the detail."""


@dataclass(frozen=True)
class HoldingConfig:
    freeze: bool = False
    view: float = 0.0
    min_weight: float = 0.0
    max_weight: float = 1.0


@dataclass(frozen=True)
class CapmHolding:
    ticker: str
    current_weight: float
    target_weight: float
    beta: float
    capm_return: float
    view: float
    expected_return: float
    vol: float
    frozen: bool
    pinned: bool
    first_bar: date


@dataclass(frozen=True)
class CapmResult:
    tickers: list[str]
    holdings: list[CapmHolding]
    current_weights: dict[str, float]
    target_weights: dict[str, float]
    expected_return: float
    expected_vol: float
    expected_sharpe: float | None
    portfolio_beta: float
    current_metrics: dict[str, float | None]
    var_95: dict[str, float]
    rf: float
    mrp: float
    market_ticker: str
    lookback_days: int
    fit_start: date
    fit_end: date
    score_start: date
    warnings: list[str]


def run_capm(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    market: pd.Series,
    *,
    market_ticker: str,
    rf: float,
    mrp: float = 0.05,
    lookback_days: int = 1825,
    configs: dict[str, HoldingConfig] | None = None,
) -> CapmResult:
    """Optimize full-history holdings on CAPM returns and pin young holdings."""
    configs = configs or {}
    if error := lookback_error(lookback_days):
        raise CapmInputError(error)
    if not (math.isfinite(rf) and 0 <= rf < 0.2):
        raise CapmInputError("rf must be between 0 and 0.2")
    if not (math.isfinite(mrp) and 0 < mrp <= 0.2):
        raise CapmInputError("mrp must be above 0 and at most 0.2")
    if not weights or any(not math.isfinite(weight) or weight <= 0 for weight in weights.values()):
        raise CapmInputError("weights must be finite and greater than zero")
    for ticker in configs:
        if ticker not in weights:
            raise CapmInputError(f"configs names {ticker}, which is not a holding.")

    tickers = list(weights)
    for ticker in tickers:
        config = configs.get(ticker, HoldingConfig())
        if not (0 <= config.min_weight <= 1 and 0 <= config.max_weight <= 1):
            raise CapmInputError(f"{ticker}: weight limits must be between 0% and 100%.")
        if config.min_weight > config.max_weight:
            raise CapmInputError(
                f"{ticker}: min weight ({config.min_weight:.1%}) is above max weight ({config.max_weight:.1%})."
            )
        if not -0.5 <= config.view <= 1.0:
            raise CapmInputError(f"{ticker}: view must be between -50% and +100%.")
        if ticker not in closes or closes[ticker].empty:
            raise CapmInputError(f"missing closes for weighted ticker {ticker!r}")

    total_weight = sum(weights.values())
    current_weights = {ticker: float(weights[ticker] / total_weight) for ticker in tickers}
    end = min(*(closes[ticker].index[-1] for ticker in tickers), market.index[-1])
    lookback_start = end - timedelta(days=lookback_days)
    if market.index[0] > lookback_start + timedelta(days=PIN_GRACE_DAYS):
        raise CapmInputError(
            f"Market ticker {market_ticker} has prices only from {market.index[0]}, after the lookback start "
            f"({lookback_start}). Choose a shorter lookback or another market ticker."
        )

    pinned_tickers = [
        ticker for ticker in tickers
        if closes[ticker].index[0] > lookback_start + timedelta(days=PIN_GRACE_DAYS)
    ]
    fitted_tickers = [ticker for ticker in tickers if ticker not in pinned_tickers]
    if len(fitted_tickers) < 2:
        raise CapmInputError("Need at least 2 holdings with full history to optimize.")
    if all(configs.get(ticker, HoldingConfig()).freeze for ticker in fitted_tickers):
        raise CapmInputError("Nothing to optimize: every holding with full history is frozen.")

    scale = 1.0 - sum(current_weights[ticker] for ticker in pinned_tickers)
    lower = sum(
        current_weights[ticker] if configs.get(ticker, HoldingConfig()).freeze
        else configs.get(ticker, HoldingConfig()).min_weight
        for ticker in fitted_tickers
    )
    upper = sum(
        current_weights[ticker] if configs.get(ticker, HoldingConfig()).freeze
        else configs.get(ticker, HoldingConfig()).max_weight
        for ticker in fitted_tickers
    )
    if lower > scale + 1e-9:
        raise CapmInputError(
            f"Minimum and frozen weights add up to {lower:.1%}, more than the {scale:.1%} available to optimize. "
            "Lower some minimums or unfreeze a holding."
        )
    if upper < scale - 1e-9:
        raise CapmInputError(
            f"Maximum and frozen weights add up to {upper:.1%}, less than the {scale:.1%} that must be allocated. "
            "Raise some maximums or unfreeze a holding."
        )

    prices = pd.DataFrame({ticker: closes[ticker] for ticker in tickers})
    if market_ticker not in prices:
        prices[market_ticker] = market
    prices = prices.loc[(prices.index >= lookback_start) & (prices.index <= end)].sort_index().ffill()
    betas = compute_betas(prices.pct_change(), market_ticker)
    if market_ticker in tickers:
        betas[market_ticker] = 1.0
    for ticker in tickers:
        if ticker not in betas or math.isnan(betas[ticker]):
            raise CapmInputError(
                f"{ticker} has fewer than 2 days of prices overlapping {market_ticker}; its beta cannot be estimated."
            )

    views = {ticker: configs.get(ticker, HoldingConfig()).view for ticker in tickers}
    expected_returns = compute_capm_expected_returns(betas, rf=rf, mrp=mrp, views=views)

    fit_prices = pd.DataFrame({ticker: closes[ticker] for ticker in fitted_tickers})
    fit_prices = fit_prices.loc[(fit_prices.index >= lookback_start) & (fit_prices.index <= end)].sort_index().ffill()
    fit_returns = compute_returns(fit_prices)
    if len(fit_returns) <= len(fitted_tickers):
        raise CapmInputError(
            f"The lookback has {len(fit_returns)} daily returns for {len(fitted_tickers)} holdings. "
            "Choose a longer lookback so there are more daily returns than holdings."
        )
    fit_start, fit_end = fit_returns.index[0], fit_returns.index[-1]
    warnings = [
        f"{ticker} has prices only from {closes[ticker].index[0]}; it is held at its current weight "
        f"({current_weights[ticker]:.1%}) and not optimized. Its min/max limits and freeze setting do not apply."
        for ticker in pinned_tickers
    ]
    if len(fit_returns) < 60:
        warnings.append("Fewer than 60 trading days of history — optimization results may be unreliable.")
    bounds = {}
    for ticker in fitted_tickers:
        config = configs.get(ticker, HoldingConfig())
        if config.freeze:
            bounds[ticker] = (current_weights[ticker] / scale, current_weights[ticker] / scale)
        else:
            bounds[ticker] = (config.min_weight / scale, min(1.0, config.max_weight / scale))
    try:
        fitted_weights = optimize_max_sharpe_capm(fit_returns, expected_returns, rf=rf, asset_bounds=bounds)
    except RuntimeError as exc:
        raise CapmInputError(str(exc)) from exc

    target_weights = {
        ticker: float(fitted_weights[ticker] * scale) if ticker in fitted_weights else current_weights[ticker]
        for ticker in tickers
    }
    score_prices = pd.DataFrame({ticker: closes[ticker] for ticker in tickers})
    score_prices = score_prices.loc[(score_prices.index >= lookback_start) & (score_prices.index <= end)].sort_index().ffill()
    score_returns = compute_returns(score_prices)
    score_start = score_returns.index[0]
    if score_start > fit_start:
        warnings.append(
            f"Volatility, Sharpe and VaR use prices from {score_start} onward, the first date every holding has prices."
        )
    covariance = score_returns.cov().values * 252
    weight_array = np.array([target_weights[ticker] for ticker in tickers])
    return_array = np.array([expected_returns[ticker] for ticker in tickers])
    beta_array = np.array([betas[ticker] for ticker in tickers])
    expected_return = float(weight_array @ return_array)
    expected_vol = float(math.sqrt(max(weight_array @ covariance @ weight_array, 0.0)))
    expected_sharpe = (expected_return - rf) / expected_vol if expected_vol > 1e-12 else None
    portfolio_beta = float(weight_array @ beta_array)
    current_array = np.array([current_weights[ticker] for ticker in tickers])
    current_return = float(current_array @ return_array)
    current_vol = float(math.sqrt(max(current_array @ covariance @ current_array, 0.0)))
    current_metrics = {
        "expected_return": current_return,
        "expected_vol": current_vol,
        "expected_sharpe": (current_return - rf) / current_vol if current_vol > 1e-12 else None,
        "portfolio_beta": float(current_array @ beta_array),
    }
    vols = np.sqrt(np.diag(covariance))
    z = float(norm.ppf(0.05))
    var_95 = {
        key: float(expected_return / periods + z * expected_vol / math.sqrt(periods))
        for key, periods in (("daily", 252), ("weekly", 52), ("monthly", 12), ("quarterly", 4), ("annual", 1))
    }
    holdings = [
        CapmHolding(
            ticker=ticker,
            current_weight=current_weights[ticker],
            target_weight=target_weights[ticker],
            beta=betas[ticker],
            capm_return=float(rf + betas[ticker] * mrp),
            view=views[ticker],
            expected_return=expected_returns[ticker],
            vol=float(vols[index]),
            frozen=configs.get(ticker, HoldingConfig()).freeze,
            pinned=ticker in pinned_tickers,
            first_bar=closes[ticker].index[0],
        )
        for index, ticker in enumerate(tickers)
    ]
    return CapmResult(
        tickers=tickers,
        holdings=holdings,
        current_weights=current_weights,
        target_weights=target_weights,
        expected_return=expected_return,
        expected_vol=expected_vol,
        expected_sharpe=expected_sharpe,
        portfolio_beta=portfolio_beta,
        current_metrics=current_metrics,
        var_95=var_95,
        rf=rf,
        mrp=mrp,
        market_ticker=market_ticker,
        lookback_days=lookback_days,
        fit_start=fit_start,
        fit_end=fit_end,
        score_start=score_start,
        warnings=warnings,
    )
