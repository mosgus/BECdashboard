"""Pure volatility-reactive portfolio forecast models."""

from __future__ import annotations

import math
import logging
from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.signal import lfilter

from app.montecarlo_run import (
    MAX_HORIZON_DAYS,
    MonteCarloInputError,
    PathPoint,
    TerminalStats,
    portfolio_series,
    summarize_paths,
)


MODELS = ("ewma", "garch", "arima", "ensemble", "prophet")
EWMA_LAMBDA = 0.94
MIN_RETURNS = {"ewma": 60, "arima": 60, "garch": 250, "ensemble": 250, "prophet": 250}
MODEL_LABELS = {"ewma": "EWMA", "garch": "GARCH", "arima": "ARIMA", "ensemble": "Ensemble", "prophet": "Prophet"}
PROPHET_MAX_SAMPLES = 2000
PROPHET_WARNING = (
    "Prophet is unstable and untested here. Its bands come from extrapolating the trend of the "
    "portfolio's value, not from its volatility, and have not been checked against what happened."
)


class ForecastInputError(ValueError):
    """The requested forecast cannot be made."""


class ForecastFitError(RuntimeError):
    """A forecast model could not be fitted."""


@dataclass(frozen=True)
class GarchFit:
    omega: float
    alpha: float
    beta: float
    next_variance: float


@dataclass(frozen=True)
class Ar1Fit:
    c: float
    phi: float
    sigma: float


@dataclass(frozen=True)
class VolPoint:
    date: date
    day: int
    vol: float


@dataclass(frozen=True)
class VolForecastPoint:
    day: int
    vol: float


@dataclass(frozen=True)
class HistoryPoint:
    date: date
    day: int
    value: float


@dataclass(frozen=True)
class ForecastResult:
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
    daily_drift: float
    current_vol: float | None
    lookback_vol: float
    params: dict[str, float]
    members: list[str]
    member_medians: dict[str, float]
    paths: list[PathPoint]
    terminal: TerminalStats
    vol_forecast: list[VolForecastPoint]
    vol_history: list[VolPoint]
    history: list[HistoryPoint]
    warnings: list[str]


def ewma_variance(x: np.ndarray, lam: float = EWMA_LAMBDA) -> float:
    """Return the centered, recursively weighted daily variance."""
    s2 = float(x.var(ddof=1))
    mean = float(x.mean())
    for value in x:
        s2 = lam * s2 + (1 - lam) * float((value - mean) ** 2)
    return s2


def fit_garch(x: np.ndarray) -> GarchFit:
    """Fit a variance-targeted Gaussian GARCH(1,1) model to log returns."""
    epsilon = x - x.mean()
    variance = float(epsilon.var(ddof=1))

    def objective(params: np.ndarray) -> float:
        alpha, beta = params
        omega = (1 - alpha - beta) * variance
        sigma2 = np.empty(len(epsilon))
        sigma2[0] = variance
        sigma2[1:] = lfilter([1], [1, -beta], omega + alpha * epsilon[:-1] ** 2, zi=[beta * variance])[0]
        if not np.all(np.isfinite(sigma2)) or np.any(sigma2 <= 0):
            return float("inf")
        return float(np.sum(np.log(sigma2) + epsilon ** 2 / sigma2))

    result = minimize(
        objective, x0=np.array([0.05, 0.90]), method="SLSQP",
        bounds=[(1e-6, 0.5), (0, 0.999)], constraints={"type": "ineq", "fun": lambda p: 0.999 - p[0] - p[1]},
    )
    if not result.success or not np.all(np.isfinite(result.x)):
        raise ForecastFitError("GARCH could not be fitted")
    alpha, beta = (float(value) for value in result.x)
    omega = (1 - alpha - beta) * variance
    sigma2 = np.empty(len(epsilon))
    sigma2[0] = variance
    sigma2[1:] = lfilter([1], [1, -beta], omega + alpha * epsilon[:-1] ** 2, zi=[beta * variance])[0]
    if not np.all(np.isfinite(sigma2)) or np.any(sigma2 <= 0):
        raise ForecastFitError("GARCH could not be fitted")
    return GarchFit(omega, alpha, beta, float(omega + alpha * epsilon[-1] ** 2 + beta * sigma2[-1]))


def fit_ar1(x: np.ndarray) -> Ar1Fit:
    """Fit ARIMA(1,1,0) on log prices with drift, as AR(1) log returns."""
    before, after = x[:-1], x[1:]
    variance = float(before.var(ddof=1))
    phi = float(np.cov(before, after, ddof=1)[0, 1] / variance)
    c = float(after.mean() - phi * before.mean())
    residuals = after - c - phi * before
    sigma = float(residuals.std(ddof=2))
    if not all(math.isfinite(value) for value in (c, phi, sigma)) or abs(phi) >= 1:
        raise ForecastFitError("ARIMA could not be fitted")
    return Ar1Fit(c, phi, sigma)


def _forecast_days(horizon_days: int) -> list[int]:
    step = max(1, horizon_days // 60)
    days = list(range(0, horizon_days + 1, step))
    return days if days[-1] == horizon_days else days + [horizon_days]


def _load_prophet():
    """Import Prophet only when its opt-in forecast model is selected."""
    logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
    logging.getLogger("prophet.plot").disabled = True
    try:
        from prophet import Prophet
    except ImportError as exc:
        raise ForecastInputError("Prophet is not installed on this server.") from exc
    return Prophet


def _model_paths(model: str, x: np.ndarray, n_paths: int, horizon_days: int, seed: int) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    mean = float(x.mean())
    if float(x.var(ddof=1)) < 1e-18:
        returns = np.full((n_paths, horizon_days), mean)
        return returns, np.zeros(horizon_days), {}
    rng = np.random.default_rng(seed)
    if model == "ewma":
        s2 = ewma_variance(x)
        returns = mean + math.sqrt(s2) * rng.standard_normal((n_paths, horizon_days))
        return returns, np.full(horizon_days, math.sqrt(252 * s2)), {"lambda": EWMA_LAMBDA}
    if model == "garch":
        fit = fit_garch(x)
        values = np.empty((n_paths, horizon_days))
        s2 = np.full(n_paths, fit.next_variance)
        for day in range(horizon_days):
            error = np.sqrt(s2) * rng.standard_normal(n_paths)
            values[:, day] = mean + error
            s2 = fit.omega + fit.alpha * error ** 2 + fit.beta * s2
        variance = float((x - mean).var(ddof=1))
        persistence = fit.alpha + fit.beta
        expected = np.array([variance + persistence ** day * (fit.next_variance - variance) for day in range(horizon_days)])
        params = {"omega": fit.omega, "alpha": fit.alpha, "beta": fit.beta, "persistence": persistence}
        if persistence < 1:
            params["half_life_days"] = math.log(0.5) / math.log(persistence)
        return values, np.sqrt(252 * expected), params
    fit = fit_ar1(x)
    values = np.empty((n_paths, horizon_days))
    prior = np.full(n_paths, x[-1])
    for day in range(horizon_days):
        prior = fit.c + fit.phi * prior + fit.sigma * rng.standard_normal(n_paths)
        values[:, day] = prior
    return values, np.full(horizon_days, fit.sigma * math.sqrt(252)), {"c": fit.c, "phi": fit.phi, "sigma": fit.sigma}


def _paths_from_returns(returns: np.ndarray, initial_value: float) -> np.ndarray:
    return np.hstack([np.full((len(returns), 1), initial_value), initial_value * np.exp(np.cumsum(returns, axis=1))])


def _history(returns: pd.Series, initial_value: float) -> list[HistoryPoint]:
    cumulative_from_date = np.cumprod((1 + returns.values)[::-1])[::-1]
    future_growth = np.concatenate([cumulative_from_date[1:], [1.0]])
    values = initial_value / future_growth
    step = max(1, math.ceil(len(returns) / 250))
    indices = list(range(len(returns) - 1, -1, -step))
    if indices[-1] != 0:
        indices.append(0)
    return [HistoryPoint(date=returns.index[index], day=index - (len(returns) - 1), value=float(values[index])) for index in reversed(indices)]


def run_forecast(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], *, initial_value: float,
    horizon_days: int = 252, num_simulations: int = 1000, lookback_days: int = 1825,
    model: str = "garch", seed: int = 42,
) -> ForecastResult:
    """Simulate a constant-mix portfolio; Prophet samples each day independently, not as coherent paths."""
    if model not in MODELS:
        raise ForecastInputError('model must be one of "ewma", "garch", "arima", "ensemble" or "prophet"')
    if not 1 <= horizon_days <= MAX_HORIZON_DAYS:
        raise ForecastInputError(f"horizon_days must be between 1 and {MAX_HORIZON_DAYS}")
    if not 100 <= num_simulations <= 10000:
        raise ForecastInputError("num_simulations must be between 100 and 10000")
    if not (math.isfinite(initial_value) and initial_value > 0):
        raise ForecastInputError("initial_value must be finite and greater than zero")
    try:
        series = portfolio_series(weights, cash, closes, lookback_days=lookback_days)
    except MonteCarloInputError as exc:
        raise ForecastInputError(str(exc)) from exc
    n_returns = len(series.returns)
    if n_returns < MIN_RETURNS[model]:
        raise ForecastInputError(
            f"{MODEL_LABELS[model]} needs at least {MIN_RETURNS[model]} daily returns, but the holdings share only {n_returns}. Choose a longer lookback."
        )
    x = np.log1p(series.returns.values)
    daily_drift = float(x.mean())
    lookback_vol = float(x.std(ddof=1) * math.sqrt(252))
    warnings = list(series.warnings)
    days = _forecast_days(horizon_days)

    if model == "prophet":
        samples = min(num_simulations, PROPHET_MAX_SAMPLES)
        if samples != num_simulations:
            warnings.append(f"Prophet draws at most {PROPHET_MAX_SAMPLES:,} samples, so this forecast uses {PROPHET_MAX_SAMPLES:,}.")
        if float(x.var(ddof=1)) < 1e-18:
            array = _paths_from_returns(np.full((samples, horizon_days), daily_drift), initial_value)
            vol = np.zeros(horizon_days)
            params = {}
        else:
            Prophet = _load_prophet()
            y = np.cumsum(x)
            ds = pd.to_datetime(series.returns.index)
            try:
                fitted = Prophet(
                    growth="linear", yearly_seasonality="auto", weekly_seasonality=False, daily_seasonality=False,
                    uncertainty_samples=samples,
                ).fit(pd.DataFrame({"ds": ds, "y": y}))
                future = pd.DataFrame({"ds": pd.bdate_range(ds[-1] + pd.offsets.BDay(1), periods=horizon_days)})
                np.random.seed(seed)
                yhat = fitted.predictive_samples(future)["yhat"]
                end_gap = float(math.exp(fitted.predict(pd.DataFrame({"ds": ds[-1:]}))["yhat"].iloc[0] - y[-1]) - 1)
            except Exception as exc:
                raise ForecastInputError(
                    "Prophet could not be fitted to this lookback. Try a longer lookback or the EWMA model."
                ) from exc
            array = np.hstack([np.full((samples, 1), initial_value), initial_value * np.exp(yhat.T - y[-1])])
            vol = np.empty(0)
            params = {"end_gap": end_gap}
        paths, terminal = summarize_paths(array, initial_value, horizon_days)
        members, medians = [model], {}
        vol_forecast = []
        current_vol = 0.0 if float(x.var(ddof=1)) < 1e-18 else None
        warnings.append(PROPHET_WARNING)
    elif model != "ensemble":
        try:
            simulated, vol, params = _model_paths(model, x, num_simulations, horizon_days, seed)
        except ForecastFitError as exc:
            raise ForecastInputError(f"{MODEL_LABELS[model]} could not be fitted to this lookback. Try a longer lookback or the EWMA model.") from exc
        array = _paths_from_returns(simulated, initial_value)
        paths, terminal = summarize_paths(array, initial_value, horizon_days)
        members, medians = [model], {}
        vol_forecast = [VolForecastPoint(day=day, vol=float(vol[0 if day == 0 else day - 1])) for day in days]
        current_vol = float(vol[0])
    else:
        fitted: list[str] = []
        for member in ("ewma", "garch", "arima"):
            try:
                _model_paths(member, x, 1, horizon_days, seed)
                fitted.append(member)
            except ForecastFitError:
                pass
        failed = []
        for member in ("ewma", "garch", "arima"):
            if member not in fitted:
                failed.append(member)
        if not fitted:
            raise ForecastInputError("No forecast model could be fitted to this lookback.")
        for failed_member in failed:
            remaining = [MODEL_LABELS[item] for item in fitted]
            warnings.append(f"{MODEL_LABELS[failed_member]} could not be fitted, so the ensemble uses {' and '.join(remaining)} only.")
        base = num_simulations // len(fitted)
        counts = [base] * (len(fitted) - 1) + [num_simulations - base * (len(fitted) - 1)]
        member_arrays, member_vols, params_by_member = [], [], {}
        medians = {}
        for index, (member, count) in enumerate(zip(fitted, counts, strict=True)):
            simulated, member_vol, member_params = _model_paths(member, x, count, horizon_days, seed + ("ewma", "garch", "arima").index(member))
            member_array = _paths_from_returns(simulated, initial_value)
            member_arrays.append(member_array)
            member_vols.append(member_vol)
            medians[member] = float(np.median(member_array[:, -1]))
            params_by_member[member] = member_params
        array = np.vstack(member_arrays)
        vol = np.sqrt(np.mean(np.square(member_vols), axis=0))
        params = {f"{member}.{key}": value for member, values in params_by_member.items() for key, value in values.items()}
        paths, terminal = summarize_paths(array, initial_value, horizon_days)
        members = fitted
        vol_forecast = [VolForecastPoint(day=day, vol=float(vol[0 if day == 0 else day - 1])) for day in days]
        current_vol = float(vol[0])

    rolling = pd.Series(x, index=series.returns.index).rolling(21).std(ddof=1).dropna() * math.sqrt(252)
    return ForecastResult(
        tickers=series.tickers, weights=series.weights, cash_weight=series.cash_weight, model=model, seed=seed,
        horizon_days=horizon_days, num_simulations=samples if model == "prophet" else num_simulations, initial_value=initial_value, lookback_days=lookback_days,
        fit_start=series.fit_start, fit_end=series.fit_end, n_returns=n_returns, daily_drift=daily_drift,
        current_vol=current_vol, lookback_vol=lookback_vol, params=params, members=members,
        member_medians=medians, paths=paths, terminal=terminal, vol_forecast=vol_forecast,
        vol_history=[VolPoint(date=index, day=position - (n_returns - 1), vol=float(value)) for position, (index, value) in enumerate(rolling.items(), start=20)],
        history=_history(series.returns, initial_value), warnings=warnings,
    )
