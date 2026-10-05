"""Pure Fama-French 3 factor attribution of a portfolio's return (contract 0167).

The portfolio path comes from run_stress (today's holdings bought at the start and held, cash flat),
so it matches Performance and Scenarios. Its daily returns are regressed on the factors; the period
return is split into parts that add up exactly."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.stress_run import StressInputError, run_stress

MIN_OBS = 60
SHORT_OBS = 126
DEFAULT_WINDOW_DAYS = 365
FACTOR_SOURCE = "Kenneth R. French Data Library — daily Fama/French 3 factors"


class AttributionInputError(ValueError):
    """The attribution cannot be computed. The router maps it to HTTP 422."""


@dataclass(frozen=True)
class FactorLoading:
    key: str
    label: str
    beta: float
    t_stat: float | None


@dataclass(frozen=True)
class AttributionResult:
    start: date
    end: date
    factor_end: date
    n_obs: int
    cash_weight: float
    coverage: float
    period_return: float
    alpha_daily: float
    alpha_annual: float
    r_squared: float | None
    loadings: list[FactorLoading]
    contributions: dict[str, float]
    source: str
    warnings: list[str]


_FACTOR_LABELS = [("market", "Market (Mkt-RF)"), ("size", "Size (SMB)"), ("value", "Value (HML)")]


def run_attribution(
    weights: dict[str, float], cash: float, closes: dict[str, pd.Series], market: pd.Series,
    factors: pd.DataFrame, *, market_ticker: str, start: date | None, end: date | None, today: date,
) -> AttributionResult:
    if factors.empty:
        raise AttributionInputError("No Fama-French factor data is stored yet.")
    factor_end = factors.index.max()
    end_resolved = min(end or today, factor_end)
    extra_warnings: list[str] = []
    if end is not None and end > factor_end:
        extra_warnings.append(
            f"Factor data ends on {factor_end} (Ken French publishes about a month late), so the window ends there."
        )
    start_resolved = start or end_resolved - timedelta(days=DEFAULT_WINDOW_DAYS)
    try:
        stress = run_stress(
            weights, cash, closes, market, market_ticker=market_ticker, start=start_resolved, end=end_resolved
        )
    except StressInputError as exc:
        raise AttributionInputError(str(exc)) from exc
    warnings = [*stress.warnings, *extra_warnings]

    value = pd.Series([point.value for point in stress.path], index=[point.date for point in stress.path])
    p = value.pct_change().dropna().to_frame("p").join(factors, how="inner")
    n = len(p)
    if n < MIN_OBS:
        raise AttributionInputError(
            f"Only {n} trading days have both prices and factor data. At least {MIN_OBS} are needed. "
            f"Factor data ends on {factor_end}."
        )

    returns = p["p"].to_numpy(dtype=float)
    mkt_rf, smb, hml, rf = (p[column].to_numpy(dtype=float) for column in ("mkt_rf", "smb", "hml", "rf"))
    y = returns - rf
    X = np.column_stack([np.ones(n), mkt_rf, smb, hml])
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ b
    ssr = float(resid @ resid)
    sst = float(((y - y.mean()) ** 2).sum())
    r_squared = 1 - ssr / sst if sst > 0 else None
    sigma2 = ssr / (n - 4)
    se = np.sqrt(np.diag(sigma2 * np.linalg.pinv(X.T @ X)))
    with np.errstate(divide="ignore", invalid="ignore"):
        t = b / se
    t_stats = [float(t[i]) if se[i] > 0 and np.isfinite(se[i]) and np.isfinite(t[i]) else None for i in range(4)]

    period_return = float(np.prod(1 + returns) - 1)
    contributions = {
        "alpha": float(b[0] * n),
        "market": float(b[1] * mkt_rf.sum()),
        "size": float(b[2] * smb.sum()),
        "value": float(b[3] * hml.sum()),
        "risk_free": float(rf.sum()),
        "compounding": float(period_return - returns.sum()),
    }

    if n < SHORT_OBS:
        warnings.append(f"Only {n} trading days in this window, so the loadings and t-stats are noisy.")
    if stress.cash_weight > 0:
        warnings.append(
            f"Cash ({stress.cash_weight:.1%} at the start) is counted at 0% return, so alpha is about "
            f"{stress.cash_weight * float(rf.mean()) * 252:.2%} a year lower than if it earned the T-bill rate."
        )

    alpha_daily = float(b[0])
    return AttributionResult(
        start=stress.start,
        end=stress.end,
        factor_end=factor_end,
        n_obs=n,
        cash_weight=float(stress.cash_weight),
        coverage=float(stress.coverage),
        period_return=period_return,
        alpha_daily=alpha_daily,
        alpha_annual=float((1 + alpha_daily) ** 252 - 1),
        r_squared=None if r_squared is None else float(r_squared),
        loadings=[
            FactorLoading(key, label, float(b[i + 1]), t_stats[i + 1])
            for i, (key, label) in enumerate(_FACTOR_LABELS)
        ],
        contributions=contributions,
        source=FACTOR_SOURCE,
        warnings=warnings,
    )
