"""Pure performance orchestration over the shared stress-test path."""

from dataclasses import dataclass
from datetime import date, timedelta

import pandas as pd

from app.optimizer import compute_metrics
from app.stress_run import StressInputError, StressPoint, run_stress


MIN_DAYS = 20
SHORT_WINDOW_DAYS = 126
DEFAULT_WINDOW_DAYS = 365


class PerformanceInputError(ValueError):
    """The requested performance analysis cannot be made."""


@dataclass(frozen=True)
class PerformanceResult:
    market_ticker: str
    start: date
    end: date
    n_days: int
    cash_weight: float
    coverage: float
    rf: float
    metrics: dict
    bench_metrics: dict | None
    path: list[StressPoint]
    warnings: list[str]


def run_performance(
    weights: dict[str, float],
    cash: float,
    closes: dict[str, pd.Series],
    market: pd.Series,
    *,
    market_ticker: str,
    start: date | None,
    end: date | None,
    today: date,
    rf: float,
) -> PerformanceResult:
    """Run buy-and-hold performance metrics over the shared stress path."""
    end_resolved = end or today
    start_resolved = start or end_resolved - timedelta(days=DEFAULT_WINDOW_DAYS)
    try:
        stress = run_stress(
            weights,
            cash,
            closes,
            market,
            market_ticker=market_ticker,
            start=start_resolved,
            end=end_resolved,
        )
    except StressInputError as exc:
        raise PerformanceInputError(str(exc)) from exc

    if stress.n_days < MIN_DAYS:
        raise PerformanceInputError(
            f"Only {stress.n_days} trading days in this window. Pick a window of at least {MIN_DAYS} trading days."
        )

    port_returns = pd.Series([point.value for point in stress.path]).pct_change().dropna()
    market_values = [point.market for point in stress.path]
    market_returns = (
        pd.Series(market_values).pct_change().dropna() if all(value is not None for value in market_values) else None
    )
    metrics = compute_metrics(port_returns, market_returns, rf=rf)
    bench_metrics = compute_metrics(market_returns, None, rf=rf) if market_returns is not None else None

    warnings = list(stress.warnings)
    if stress.n_days < SHORT_WINDOW_DAYS:
        warnings.append(
            f"Only {stress.n_days} trading days in this window. CAGR, Sharpe and alpha are annualised from a short period and can look extreme."
        )
    return PerformanceResult(
        market_ticker=market_ticker,
        start=stress.start,
        end=stress.end,
        n_days=stress.n_days,
        cash_weight=stress.cash_weight,
        coverage=stress.coverage,
        rf=rf,
        metrics=metrics,
        bench_metrics=bench_metrics,
        path=stress.path,
        warnings=warnings,
    )
