"""Portfolio analytics: returns, metrics, equity curve, optimizers.

Three optimization modes:
  - min_variance      : minimize portfolio variance (long-only, fully invested)
  - max_sharpe        : historical returns-based max Sharpe (SLSQP)
  - max_sharpe_capm   : CAPM expected returns + analyst views, per-asset bounds
                        (implements the notebook logic in production form)
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import minimize


# ── Return computations ───────────────────────────────────────────────────────

def compute_returns(prices: pd.DataFrame) -> pd.DataFrame:
    return prices.pct_change().dropna()


def compute_portfolio_returns(returns: pd.DataFrame, weights: np.ndarray) -> pd.Series:
    w = np.asarray(weights, dtype=float)
    return (returns * w).sum(axis=1)


def compute_equity_curve(returns: pd.Series) -> pd.Series:
    return (1 + returns).cumprod()


def compute_rolling_vol(returns: pd.Series, window: int = 21) -> pd.Series:
    return returns.rolling(window).std() * np.sqrt(252)


def compute_drawdown(equity: pd.Series) -> pd.Series:
    roll_max = equity.cummax()
    return (equity - roll_max) / roll_max


# ── Performance metrics ───────────────────────────────────────────────────────

def compute_metrics(
    port_returns: pd.Series,
    bench_returns: Optional[pd.Series] = None,
    rf: float = 0.0,
) -> dict:
    n = len(port_returns)
    if n < 2:
        return {}
    ann = 252
    total = (1 + port_returns).prod() - 1
    n_years = n / ann
    cagr = (1 + total) ** (1 / n_years) - 1 if n_years > 0 else 0.0
    vol = port_returns.std() * np.sqrt(ann)
    sharpe = (cagr - rf) / vol if vol > 0 else 0.0
    equity = compute_equity_curve(port_returns)
    max_dd = compute_drawdown(equity).min()

    out: dict = {
        "cagr": float(cagr),
        "vol": float(vol),
        "sharpe": float(sharpe),
        "max_dd": float(max_dd),
    }

    if bench_returns is not None and len(bench_returns) == n:
        cov = np.cov(port_returns, bench_returns)
        beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] > 0 else float("nan")
        bench_ann = float((1 + bench_returns).prod() ** (ann / n) - 1)
        out["beta"] = beta
        out["alpha"] = float(cagr - rf - beta * (bench_ann - rf))

    return out


# ── CAPM helpers ──────────────────────────────────────────────────────────────

def compute_betas(returns: pd.DataFrame, market_ticker: str) -> dict[str, float]:
    """OLS beta for each asset vs market_ticker via scipy.stats.linregress."""
    if market_ticker not in returns.columns:
        return {}
    betas: dict[str, float] = {}
    for col in returns.columns:
        if col == market_ticker:
            continue
        pair = returns[[market_ticker, col]].dropna()
        if len(pair) < 2:
            betas[col] = float("nan")
            continue
        slope, _, _, _, _ = stats.linregress(pair[market_ticker].values, pair[col].values)
        betas[col] = float(slope)
    return betas


def compute_capm_expected_returns(
    betas: dict[str, float],
    rf: float = 0.0364,
    mrp: float = 0.05,
    views: Optional[dict[str, float]] = None,
) -> dict[str, float]:
    """E[R_i] = rf + beta_i * mrp + mrp * view_i.

    views[ticker] is the analyst undervaluation fraction (e.g. 0.5 = 50% undervalued).
    The boost is additive: mrp * view, mirroring the notebook formula.
    """
    views = views or {}
    return {
        ticker: float(rf + beta * mrp + mrp * views.get(ticker, 0.0))
        for ticker, beta in betas.items()
    }


# ── Optimizer internals ───────────────────────────────────────────────────────

def _port_vol(w: np.ndarray, cov: np.ndarray) -> float:
    return float(np.sqrt(w @ cov @ w))


def _neg_sharpe_hist(w: np.ndarray, mean_ret: np.ndarray, cov: np.ndarray, rf: float) -> float:
    """Historical max-Sharpe objective (annualised)."""
    ret = float(np.dot(w, mean_ret) * 252)
    vol = _port_vol(w, cov) * np.sqrt(252)
    return -(ret - rf) / vol if vol > 0 else 0.0


def _run_optimizer(objective, n: int, bounds: tuple, *args) -> np.ndarray:
    x0 = np.ones(n) / n
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}]
    result = minimize(
        objective,
        x0,
        args=args,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"ftol": 1e-10, "maxiter": 2000},
    )
    if not result.success:
        raise RuntimeError(f"Optimizer did not converge: {result.message}")
    return result.x


# ── Public optimizer API ──────────────────────────────────────────────────────

def optimize_min_variance(
    returns: pd.DataFrame,
    max_weight: float = 1.0,
    asset_bounds: Optional[dict[str, tuple[float, float]]] = None,
) -> dict[str, float]:
    """Long-only minimum-variance portfolio."""
    cov = returns.cov().values * 252
    tickers = returns.columns.tolist()
    bounds = tuple(
        asset_bounds.get(t, (0.0, max_weight)) if asset_bounds else (0.0, max_weight)
        for t in tickers
    )
    w = _run_optimizer(_port_vol, len(tickers), bounds, cov)
    return dict(zip(tickers, w.tolist()))


def optimize_max_sharpe(
    returns: pd.DataFrame,
    rf: float = 0.0,
    max_weight: float = 1.0,
    asset_bounds: Optional[dict[str, tuple[float, float]]] = None,
) -> dict[str, float]:
    """Max-Sharpe using historical mean returns (annualised)."""
    mean_ret = returns.mean().values
    cov = returns.cov().values
    tickers = returns.columns.tolist()
    bounds = tuple(
        asset_bounds.get(t, (0.0, max_weight)) if asset_bounds else (0.0, max_weight)
        for t in tickers
    )
    w = _run_optimizer(_neg_sharpe_hist, len(tickers), bounds, mean_ret, cov, rf)
    return dict(zip(tickers, w.tolist()))


def optimize_max_sharpe_capm(
    returns: pd.DataFrame,
    expected_returns: dict[str, float],
    rf: float = 0.0364,
    max_weight: float = 1.0,
    asset_bounds: Optional[dict[str, tuple[float, float]]] = None,
) -> dict[str, float]:
    """Max-Sharpe using CAPM expected returns + analyst views.

    Uses annualised covariance matrix and annual expected returns directly,
    matching the notebook's portfolio_performance() formulation.
    """
    tickers = [t for t in returns.columns if t in expected_returns]
    if not tickers:
        raise RuntimeError("No tickers overlap between returns and expected_returns.")

    mean_ret_annual = np.array([expected_returns[t] for t in tickers])
    cov_annual = returns[tickers].cov().values * 252
    n = len(tickers)

    bounds = tuple(
        asset_bounds.get(t, (0.0, max_weight)) if asset_bounds else (0.0, max_weight)
        for t in tickers
    )

    # Validate: sum of minimums must be <= 1
    total_min = sum(b[0] for b in bounds)
    if total_min > 1.0 + 1e-6:
        raise RuntimeError(f"Sum of minimum bounds ({total_min:.2%}) exceeds 100%. Relax constraints.")

    def neg_sharpe_capm(w: np.ndarray) -> float:
        ret = float(np.dot(w, mean_ret_annual))
        vol = float(np.sqrt(w @ cov_annual @ w))
        return -(ret - rf) / vol if vol > 0 else 0.0

    x0 = np.ones(n) / n
    # Shift x0 to satisfy min bounds if needed
    for i, (lo, hi) in enumerate(bounds):
        x0[i] = max(x0[i], lo)
    x0 = x0 / x0.sum()

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}]
    result = minimize(
        neg_sharpe_capm,
        x0,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"ftol": 1e-12, "maxiter": 3000},
    )
    if not result.success:
        raise RuntimeError(f"CAPM optimizer did not converge: {result.message}")

    return dict(zip(tickers, result.x.tolist()))
