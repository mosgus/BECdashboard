"""Walk-forward calibration: fits use only data up to each origin, windows do not overlap,
and expected coverage ranges are 95% binomial intervals."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from scipy.stats import binom

from app.forecast_run import ForecastInputError, run_forecast
from app.montecarlo_run import MonteCarloInputError, portfolio_series, run_monte_carlo
from app.optimize_run import MAX_LOOKBACK_DAYS


CALIBRATION_MODELS = ("bootstrap", "normal", "ewma", "garch", "arima", "ensemble")
HORIZONS = (21, 63)
MAX_WINDOWS = 60
MIN_WINDOWS_FOR_VERDICT = 10
NUM_SIMULATIONS = 1000
SEED = 42


class CalibrationInputError(ValueError):
    """The requested calibration cannot be run."""


@dataclass
class CalibrationHorizon:
    horizon_days: int
    windows: int
    first_origin: date | None
    last_origin: date | None
    inside_90: float | None
    inside_50: float | None
    below_90: int
    above_90: int
    range_90: tuple[float, float] | None
    range_50: tuple[float, float] | None
    verdict_90: str
    verdict_50: str


@dataclass
class CalibrationResult:
    tickers: list[str]
    model: str
    lookback_days: int
    num_simulations: int
    horizons: list[CalibrationHorizon]
    warnings: list[str]


def _range_and_verdict(share: float | None, windows: int, target: float) -> tuple[tuple[float, float] | None, str]:
    if windows == 0:
        return None, "too_few"
    interval = (float(binom.ppf(0.025, windows, target) / windows), float(binom.ppf(0.975, windows, target) / windows))
    if windows < MIN_WINDOWS_FOR_VERDICT:
        return interval, "too_few"
    assert share is not None
    if share < interval[0]:
        return interval, "too_narrow"
    if share > interval[1]:
        return interval, "too_wide"
    return interval, "consistent"


def run_calibration(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], *, lookback_days: int, model: str
) -> CalibrationResult:
    """Measure percentile-band coverage on independent historical forecast windows."""
    if model == "prophet":
        raise CalibrationInputError("Calibration does not cover Prophet, which is untested by design.")
    if model not in CALIBRATION_MODELS:
        raise CalibrationInputError('model must be one of "bootstrap", "normal", "ewma", "garch", "arima" or "ensemble"')
    try:
        full_result = portfolio_series(weights, cash, closes, lookback_days=MAX_LOOKBACK_DAYS)
    except MonteCarloInputError as exc:
        raise CalibrationInputError(str(exc)) from exc
    full = full_result.returns
    horizons = []
    for horizon_days in HORIZONS:
        origins: list[date] = []
        below_90 = above_90 = hits_50 = 0
        i = len(full) - 1 - horizon_days
        while i >= 0 and len(origins) < MAX_WINDOWS:
            origin = full.index[i]
            truncated = {ticker: series[series.index <= origin] for ticker, series in closes.items()}
            try:
                if model in ("bootstrap", "normal"):
                    result = run_monte_carlo(
                        weights, cash, truncated, initial_value=1.0, horizon_days=horizon_days,
                        num_simulations=NUM_SIMULATIONS, lookback_days=lookback_days, model=model, seed=SEED,
                    )
                else:
                    result = run_forecast(
                        weights, cash, truncated, initial_value=1.0, horizon_days=horizon_days,
                        num_simulations=NUM_SIMULATIONS, lookback_days=lookback_days, model=model, seed=SEED,
                    )
            except (MonteCarloInputError, ForecastInputError) as exc:
                if "at least" in str(exc):
                    break
                raise CalibrationInputError(str(exc)) from exc
            growth = float(np.prod(1 + full.values[i + 1 : i + 1 + horizon_days]))
            band = result.paths[-1]
            assert band.day == horizon_days
            below_90 += growth < band.p5
            above_90 += growth > band.p95
            hits_50 += band.p25 <= growth <= band.p75
            origins.append(origin)
            i -= horizon_days
        windows = len(origins)
        inside_90 = None if windows == 0 else (windows - below_90 - above_90) / windows
        inside_50 = None if windows == 0 else hits_50 / windows
        range_90, verdict_90 = _range_and_verdict(inside_90, windows, 0.9)
        range_50, verdict_50 = _range_and_verdict(inside_50, windows, 0.5)
        horizons.append(CalibrationHorizon(
            horizon_days=horizon_days, windows=windows,
            first_origin=None if not origins else min(origins), last_origin=None if not origins else max(origins),
            inside_90=inside_90, inside_50=inside_50, below_90=below_90, above_90=above_90,
            range_90=range_90, range_50=range_50, verdict_90=verdict_90, verdict_50=verdict_50,
        ))
    return CalibrationResult(
        tickers=full_result.tickers, model=model, lookback_days=lookback_days,
        num_simulations=NUM_SIMULATIONS, horizons=horizons, warnings=[],
    )
