"""Walk-forward (anchored) out-of-sample backtesting engine.

Splits the return history into sequential train/test folds, optimises on
each training window, then evaluates the resulting weights out-of-sample.

Returns per-fold IS vs OOS metrics and an aggregate degradation ratio.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from core.portfolio import (
    compute_equity_curve,
    compute_metrics,
    compute_portfolio_returns,
    optimize_equal_weight,
    optimize_max_diversification,
    optimize_max_sharpe,
    optimize_max_sortino,
    optimize_min_cvar,
    optimize_min_variance,
    optimize_risk_parity,
    optimize_target_volatility,
)


# ── Optimizer dispatch ───────────────────────────────────────────────────────

_OPTIMIZERS: dict[str, callable] = {
    "equal_weight":        lambda r, mw: optimize_equal_weight(r),
    "min_variance":        lambda r, mw: optimize_min_variance(r, max_weight=mw),
    "max_sharpe":          lambda r, mw: optimize_max_sharpe(r, max_weight=mw),
    "risk_parity":         lambda r, mw: optimize_risk_parity(r, max_weight=mw),
    "max_sortino":         lambda r, mw: optimize_max_sortino(r, max_weight=mw),
    "min_cvar":            lambda r, mw: optimize_min_cvar(r, max_weight=mw),
    "max_diversification": lambda r, mw: optimize_max_diversification(r, max_weight=mw),
    "target_volatility":   lambda r, mw: optimize_target_volatility(r, max_weight=mw),
}

AVAILABLE_MODES = list(_OPTIMIZERS.keys())


def dispatch_optimizer(
    returns: pd.DataFrame,
    mode: str,
    max_weight: float = 1.0,
) -> dict[str, float]:
    """Run a single optimizer mode and return {ticker: weight}."""
    fn = _OPTIMIZERS.get(mode)
    if fn is None:
        raise ValueError(f"Unknown optimizer mode: {mode!r}. Available: {AVAILABLE_MODES}")
    return fn(returns, max_weight)


# ── Walk-forward engine ──────────────────────────────────────────────────────

def run_walk_forward(
    returns: pd.DataFrame,
    mode: str = "max_sharpe",
    train_days: int = 504,
    test_days: int = 63,
    n_folds: int = 4,
    max_weight: float = 1.0,
) -> dict:
    """Anchored walk-forward backtest.

    For each fold *i* (0 .. n_folds-1):
      - train window ends at ``fold_end = total_len - (n_folds - i) * test_days``
      - train window starts at ``max(0, fold_end - train_days)``
      - test window is ``[fold_end, fold_end + test_days)``

    Returns
    -------
    dict with keys:
        folds : list[dict]
            Per-fold results: is_metrics, oos_metrics, weights (dict), dates.
        aggregate_oos : dict
            Metrics computed on the concatenated OOS returns.
        degradation_ratio : float
            aggregate OOS Sharpe / aggregate IS Sharpe.  Values near 1.0
            indicate the strategy is robust; values near 0 indicate overfitting.
    """
    total = len(returns)
    required = train_days + n_folds * test_days
    if total < required:
        return {
            "error": (
                f"Insufficient data: need {required} days "
                f"(train={train_days} + {n_folds}x{test_days}), "
                f"but only {total} available."
            ),
            "folds": [],
            "aggregate_oos": {},
            "degradation_ratio": None,
        }

    folds: list[dict] = []
    all_oos_returns: list[pd.Series] = []
    all_is_sharpes: list[float] = []

    for i in range(n_folds):
        fold_end = total - (n_folds - i) * test_days
        fold_start = max(0, fold_end - train_days)
        test_start = fold_end
        test_end = fold_end + test_days

        train_ret = returns.iloc[fold_start:fold_end]
        test_ret = returns.iloc[test_start:test_end]

        try:
            weights = dispatch_optimizer(train_ret, mode, max_weight)
        except Exception as exc:
            folds.append({
                "fold": i + 1,
                "error": str(exc),
                "train_start": str(train_ret.index[0].date()) if len(train_ret) > 0 else None,
                "train_end": str(train_ret.index[-1].date()) if len(train_ret) > 0 else None,
                "test_start": str(test_ret.index[0].date()) if len(test_ret) > 0 else None,
                "test_end": str(test_ret.index[-1].date()) if len(test_ret) > 0 else None,
            })
            continue

        w_arr = np.array([weights.get(t, 0.0) for t in returns.columns])

        # In-sample metrics
        is_port = compute_portfolio_returns(train_ret, w_arr)
        is_metrics = compute_metrics(is_port)

        # Out-of-sample metrics
        oos_port = compute_portfolio_returns(test_ret, w_arr)
        oos_metrics = compute_metrics(oos_port)

        all_oos_returns.append(oos_port)
        all_is_sharpes.append(is_metrics.get("sharpe", 0.0))

        folds.append({
            "fold": i + 1,
            "train_start": str(train_ret.index[0].date()),
            "train_end": str(train_ret.index[-1].date()),
            "test_start": str(test_ret.index[0].date()),
            "test_end": str(test_ret.index[-1].date()),
            "train_days": len(train_ret),
            "test_days": len(test_ret),
            "is_metrics": is_metrics,
            "oos_metrics": oos_metrics,
            "weights": {k: round(v, 4) for k, v in weights.items()},
        })

    # Aggregate OOS
    aggregate_oos: dict = {}
    degradation_ratio: float | None = None
    oos_equity_curve: list[dict] = []

    if all_oos_returns:
        combined_oos = pd.concat(all_oos_returns)
        aggregate_oos = compute_metrics(combined_oos)
        eq = compute_equity_curve(combined_oos)
        oos_equity_curve = [
            {"date": str(d.date()), "value": round(float(v), 4)}
            for d, v in eq.items()
        ]

        avg_is_sharpe = float(np.mean(all_is_sharpes)) if all_is_sharpes else 0.0
        oos_sharpe = aggregate_oos.get("sharpe", 0.0)
        if abs(avg_is_sharpe) > 1e-6:
            degradation_ratio = round(oos_sharpe / avg_is_sharpe, 4)

    return {
        "mode": mode,
        "train_days": train_days,
        "test_days": test_days,
        "n_folds": n_folds,
        "folds": folds,
        "aggregate_oos": aggregate_oos,
        "oos_equity_curve": oos_equity_curve,
        "degradation_ratio": degradation_ratio,
    }
