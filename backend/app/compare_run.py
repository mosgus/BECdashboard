"""Pure orchestration for comparing all eight optimizer modes on one portfolio, in-sample and on
a holdout the fit never saw. Every optimizer number comes from app.optimize_run.run_optimize, so
the in-sample columns match Historical Optimize for the same settings."""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import date, timedelta

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform

from app.optimize_run import PIN_GRACE_DAYS, Mode, OptimizeInputError, OptimizeResult, run_optimize
from app.optimizer import compute_metrics, compute_returns
from app.portfolio_series import Rebalance, backtest_series

HOLDOUT_DAYS = 365
WALK_FORWARD_FOLDS = 4
_FALLBACK_VOL_TARGET = 0.10
MODES: tuple[Mode, ...] = (
    "equal_weight", "min_variance", "max_sharpe", "risk_parity",
    "max_sortino", "min_cvar", "max_diversification", "target_volatility",
)

_ZERO_VARIANCE = 1e-12


@dataclass(frozen=True)
class CompareMetrics:
    cagr: float | None
    vol: float | None
    sharpe: float | None
    max_dd: float | None


@dataclass(frozen=True)
class ModeRow:
    mode: str
    error: str | None
    feasible: bool | None
    target_weights: dict[str, float] | None
    traded: float | None
    in_sample: CompareMetrics | None
    point: tuple[float, float] | None
    holdout_weights: dict[str, float] | None
    holdout: CompareMetrics | None
    holdout_error: str | None


@dataclass(frozen=True)
class CurrentRow:
    in_sample: CompareMetrics
    holdout: CompareMetrics | None
    point: tuple[float, float] | None


@dataclass(frozen=True)
class HoldoutWindow:
    fit_start: date
    fit_end: date
    score_start: date
    score_end: date
    tickers: list[str]
    excluded: list[str]


@dataclass(frozen=True)
class FoldMode:
    mode: str
    holdout: CompareMetrics | None
    error: str | None          # None when holdout is set, or when the mode was not attempted


@dataclass(frozen=True)
class Fold:
    fold: int                  # 1 = most recent year
    cut: date                  # fit uses closes <= cut
    score_end: date            # nominal end of the scored year
    fit_start: date | None
    fit_end: date | None
    score_start: date | None
    tickers: list[str]         # eligible holdings
    excluded: list[str]        # holdings with no price on or before cut
    vol_target: float | None   # resolved target used in this fold's fit; None if unavailable
    unavailable: str | None    # set => current is None and modes is []
    current: CompareMetrics | None
    modes: list[FoldMode]


@dataclass(frozen=True)
class _FoldRun:
    fold: Fold
    weights: dict[str, dict[str, float]]   # mode -> fitted target weights, scored modes only
    score_end: date | None                 # last bar actually scored


@dataclass(frozen=True)
class CorrelationResult:
    tickers: list[str]
    matrix: list[list[float]]
    start: date
    end: date
    n_returns: int
    limited_by: str | None
    excluded: list[str]


@dataclass(frozen=True)
class CompareFrontier:
    points: list[tuple[float, float]]
    cloud: list[tuple[float, float]]
    tickers: list[str]
    excluded: list[str]


@dataclass(frozen=True)
class CompareResult:
    tickers: list[str]
    current_weights: dict[str, float]
    pinned: list[str]
    lookback_days: int
    rebalance: str
    rf: float
    fit_start: date
    fit_end: date
    score_start: date
    current: CurrentRow
    modes: list[ModeRow]
    folds: list[Fold]
    vol_target: float
    holdout: HoldoutWindow | None
    holdout_unavailable: str | None
    frontier: CompareFrontier | None
    correlation: CorrelationResult | None
    warnings: list[str]


def _finite(metrics: dict, key: str) -> float | None:
    value = metrics.get(key)
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _to_metrics(metrics: dict) -> CompareMetrics:
    """compute_metrics returns {} for fewer than two returns; every field is then None."""
    return CompareMetrics(
        cagr=_finite(metrics, "cagr"),
        vol=_finite(metrics, "vol"),
        sharpe=_finite(metrics, "sharpe"),
        max_dd=_finite(metrics, "max_dd"),
    )


def _score(curve_total: list[float], rf: float) -> CompareMetrics:
    return _to_metrics(compute_metrics(pd.Series(curve_total).pct_change().dropna(), None, rf=rf))


def _mode_row(run: OptimizeResult) -> ModeRow:
    return ModeRow(
        mode=run.mode,
        error=None,
        feasible=run.feasible,
        target_weights=run.target_weights,
        traded=float(sum(abs(v) for v in run.implied_trades.values())),
        in_sample=_to_metrics(run.metrics["optimized"]),
        point=run.optimized_point,
        holdout_weights=None,
        holdout=None,
        holdout_error=None,
    )


def _error_row(mode: str, error: str) -> ModeRow:
    return ModeRow(
        mode=mode, error=error, feasible=None, target_weights=None, traded=None, in_sample=None,
        point=None, holdout_weights=None, holdout=None, holdout_error=None,
    )


def correlation_matrix(
    closes: dict[str, pd.Series], tickers: list[str], start: date, end: date,
) -> CorrelationResult | None:
    """Correlation of daily returns over one common window, in hierarchical-cluster order.

    Every pair is measured on the same dates (the window starts where the youngest holding
    starts), so the cells are comparable and the matrix is positive semi-definite. Distance is
    sqrt(0.5 * (1 - rho)), a true metric, with average linkage: Ward would assume Euclidean
    distances, which 1 - rho is not."""
    in_range: dict[str, pd.Series] = {}
    for ticker in tickers:
        series = closes[ticker]
        clipped = series.loc[(series.index >= start) & (series.index <= end)]
        if clipped.empty:
            raise ValueError(f"{ticker} has no bars between {start} and {end}")
        in_range[ticker] = clipped

    common_start = max(series.index[0] for series in in_range.values())
    frame = pd.DataFrame(in_range).sort_index()
    frame = frame.loc[frame.index >= common_start].ffill()
    returns = compute_returns(frame)

    excluded = [ticker for ticker in tickers if returns[ticker].std() < _ZERO_VARIANCE]
    kept = [ticker for ticker in tickers if ticker not in excluded]
    if len(kept) < 2 or len(returns) < 2:
        return None

    rho = returns[kept].corr()
    distance = np.sqrt(np.clip(0.5 * (1.0 - rho.values), 0.0, None))
    np.fill_diagonal(distance, 0.0)
    distance = (distance + distance.T) / 2.0
    order = leaves_list(linkage(squareform(distance, checks=False), method="average", optimal_ordering=True))
    ordered = [kept[i] for i in order]
    matrix = rho.loc[ordered, ordered].values

    limited_by = None
    if common_start > start + timedelta(days=PIN_GRACE_DAYS):
        limited_by = next(
            (ticker for ticker in tickers if in_range[ticker].index[0] == common_start), None
        )

    return CorrelationResult(
        tickers=ordered,
        matrix=[[float(v) for v in row] for row in matrix],
        start=returns.index[0],
        end=returns.index[-1],
        n_returns=len(returns),
        limited_by=limited_by,
        excluded=excluded,
    )


def run_compare(
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    benchmark: pd.Series | None,
    *,
    lookback_days: int = 1825,
    max_weight: float = 1.0,
    min_weight: float = 0.0,
    vol_target: float | None = 0.10,
    rebalance: Rebalance = "none",
    rf: float = 0.0427,
    folds: int = WALK_FORWARD_FOLDS,
) -> CompareResult:
    common = dict(
        lookback_days=lookback_days, max_weight=max_weight, min_weight=min_weight,
        vol_target=_FALLBACK_VOL_TARGET if vol_target is None else vol_target,
        rebalance=rebalance, rf=rf,
    )

    # In-sample. Equal weight has no mode-specific failure, so an OptimizeInputError from it is a
    # shared input error and propagates; the other seven are caught per mode.
    equal_run = run_optimize(weights, closes, benchmark, mode="equal_weight", **common)
    if vol_target is None:
        common["vol_target"] = _match_current_vol(equal_run)
    resolved_vol_target = common["vol_target"]
    rows: dict[str, ModeRow] = {"equal_weight": _mode_row(equal_run)}
    for mode in MODES[1:]:
        try:
            run = run_optimize(weights, closes, benchmark, mode=mode, include_frontier=False, **common)
        except OptimizeInputError as exc:
            rows[mode] = _error_row(mode, str(exc))
        else:
            rows[mode] = _mode_row(run)

    # Walk-forward: fold 1 is the original holdout (fit on the same-length lookback ending
    # HOLDOUT_DAYS before the last bar, score on the days the fit never saw); later folds step
    # back a year each. The legacy holdout fields are all derived from fold 1.
    end = min(closes[t].index[-1] for t in weights)
    in_sample_failed = {mode for mode, row in rows.items() if row.error is not None}
    fold_runs = [
        _run_fold(k, end, weights, closes, common, vol_target is None, in_sample_failed, rebalance, rf)
        for k in range(1, folds + 1)
    ]

    first = fold_runs[0]
    holdout: HoldoutWindow | None = None
    holdout_unavailable = first.fold.unavailable
    current_holdout = first.fold.current
    if first.fold.unavailable is None:
        for fold_mode in first.fold.modes:
            if fold_mode.error is not None:
                rows[fold_mode.mode] = _with_holdout_error(rows[fold_mode.mode], fold_mode.error)
            elif fold_mode.holdout is not None:
                rows[fold_mode.mode] = replace(
                    rows[fold_mode.mode],
                    holdout_weights=first.weights[fold_mode.mode], holdout=fold_mode.holdout,
                )
        holdout = HoldoutWindow(
            fit_start=first.fold.fit_start,
            fit_end=first.fold.fit_end,
            score_start=first.fold.score_start,
            score_end=first.score_end,
            tickers=first.fold.tickers,
            excluded=first.fold.excluded,
        )

    frontier = None
    if equal_run.frontier is not None:
        frontier = CompareFrontier(
            points=equal_run.frontier.points,
            cloud=equal_run.frontier.cloud,
            tickers=equal_run.frontier.tickers,
            excluded=equal_run.frontier.excluded,
        )

    return CompareResult(
        tickers=equal_run.tickers,
        current_weights=equal_run.current_weights,
        pinned=[p.ticker for p in equal_run.pinned],
        lookback_days=lookback_days,
        rebalance=rebalance,
        rf=rf,
        fit_start=equal_run.fit_start,
        fit_end=equal_run.fit_end,
        score_start=equal_run.score_start,
        current=CurrentRow(
            in_sample=_to_metrics(equal_run.metrics["current"]),
            holdout=current_holdout,
            point=None if equal_run.frontier is None else equal_run.frontier.current,
        ),
        modes=[rows[mode] for mode in MODES],
        folds=[fold_run.fold for fold_run in fold_runs],
        vol_target=resolved_vol_target,
        holdout=holdout,
        holdout_unavailable=holdout_unavailable,
        frontier=frontier,
        correlation=correlation_matrix(
            closes, equal_run.tickers, end - timedelta(days=lookback_days), end
        ),
        warnings=equal_run.warnings,
    )


def _match_current_vol(equal_run: OptimizeResult) -> float:
    """Target for "match current": the current portfolio's own volatility over the fit window.
    Approximation: with pinned holdings that vol covers the whole portfolio, while the target
    constrains only the fitted sleeve."""
    vol = _finite(equal_run.metrics["current"], "vol")
    return _FALLBACK_VOL_TARGET if vol is None else vol


def _run_fold(
    k: int,
    end: date,
    weights: dict[str, float],
    closes: dict[str, pd.Series],
    common: dict,
    match_current: bool,
    in_sample_failed: set[str],
    rebalance: Rebalance,
    rf: float,
) -> _FoldRun:
    score_end = end - timedelta(days=(k - 1) * HOLDOUT_DAYS)
    cut = score_end - timedelta(days=HOLDOUT_DAYS)
    eligible = [t for t in weights if closes[t].index[0] <= cut]
    excluded = [t for t in weights if t not in eligible]

    def unavailable(message: str) -> _FoldRun:
        return _FoldRun(
            Fold(
                fold=k, cut=cut, score_end=score_end, fit_start=None, fit_end=None, score_start=None,
                tickers=eligible, excluded=excluded, vol_target=None, unavailable=message,
                current=None, modes=[],
            ),
            {}, None,
        )

    if len(eligible) < 2:
        return unavailable(
            f"The holdout needs at least 2 holdings with prices on or before {cut}; {len(eligible)} have them."
        )

    fit_closes = {t: closes[t].loc[closes[t].index <= cut] for t in eligible}
    fit_weights = {t: weights[t] for t in eligible}
    fold_common = dict(common)
    try:
        equal = run_optimize(fit_weights, fit_closes, None, mode="equal_weight", include_frontier=False, **fold_common)
    except OptimizeInputError as exc:
        return unavailable(f"Fold fit: {exc}")
    if match_current:
        fold_common["vol_target"] = _match_current_vol(equal)

    runs: dict[str, OptimizeResult] = {"equal_weight": equal}
    errors: dict[str, str] = {}
    for mode in MODES[1:]:
        if mode in in_sample_failed:
            continue
        try:
            runs[mode] = run_optimize(fit_weights, fit_closes, None, mode=mode, include_frontier=False, **fold_common)
        except OptimizeInputError as exc:
            errors[mode] = str(exc)
    for mode, run in list(runs.items()):
        if not run.feasible:
            del runs[mode]
            errors[mode] = "The optimizer did not converge on the holdout fit."

    scored = {
        t: closes[t].loc[(closes[t].index >= equal.fit_end) & (closes[t].index <= score_end)]
        for t in eligible
    }
    metrics = {mode: _score(backtest_series(run.target_weights, scored, rebalance).total, rf)
               for mode, run in runs.items()}
    current_curve = backtest_series(fit_weights, scored, rebalance)

    return _FoldRun(
        Fold(
            fold=k, cut=cut, score_end=score_end, fit_start=equal.fit_start, fit_end=equal.fit_end,
            score_start=current_curve.dates[0], tickers=eligible, excluded=excluded,
            vol_target=fold_common["vol_target"], unavailable=None,
            current=_score(current_curve.total, rf),
            modes=[FoldMode(mode, metrics.get(mode), errors.get(mode)) for mode in MODES],
        ),
        {mode: run.target_weights for mode, run in runs.items()},
        current_curve.dates[-1],
    )


def _with_holdout_error(row: ModeRow, message: str) -> ModeRow:
    return replace(row, holdout_error=message)
