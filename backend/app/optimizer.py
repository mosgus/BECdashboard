"""Portfolio analytics: returns, metrics, equity curve, optimizers.

Eight optimization modes (run_optimize):
  - equal_weight        : 1/N — simplest baseline
  - min_variance        : minimize portfolio variance (fully invested; long-only unless shorting is enabled)
  - max_sharpe          : historical returns-based max Sharpe (SLSQP)
  - risk_parity         : equal risk contribution (ERC) portfolio
  - max_sortino         : maximise Sortino ratio (excess return / downside deviation below rf)
  - min_cvar            : minimise CVaR at 95% confidence (Expected Shortfall)
  - max_diversification : maximise diversification ratio (w·σ_i / σ_p)
  - target_volatility   : maximise return subject to portfolio vol ≤ vol_target

optimize_max_sharpe_capm is not a run_optimize mode; capm_run uses it for the Outlook CAPM tab.

Ported from main's portfolio module. Risk parity uses variance as its
ERC target, and near-zero volatility produces a None Sharpe ratio.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
from scipy import stats
from scipy.optimize import minimize


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
    sharpe = (cagr - rf) / vol if vol > 1e-12 else None
    equity = compute_equity_curve(port_returns)
    max_dd = compute_drawdown(equity).min()

    out: dict = {
        "cagr": float(cagr),
        "vol": float(vol),
        "sharpe": float(sharpe) if sharpe is not None else None,
        "max_dd": float(max_dd),
    }
    if bench_returns is not None and len(bench_returns) == n:
        cov = np.cov(port_returns, bench_returns)
        beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] > 0 else float("nan")
        bench_ann = float((1 + bench_returns).prod() ** (ann / n) - 1)
        out["beta"] = beta
        out["alpha"] = float(cagr - rf - beta * (bench_ann - rf))
    return out


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


# FLAG(custom): the `mrp * view` term is not part of CAPM or Black-Litterman. It adds a flat
# return bump per unit of conviction (view 0.20 → +1.0% at mrp 5%). Ported unchanged from main;
# intent to be confirmed with its author before changing.
def compute_capm_expected_returns(
    betas: dict[str, float], rf: float = 0.04, mrp: float = 0.05, views: Optional[dict[str, float]] = None
) -> dict[str, float]:
    views = views or {}
    return {ticker: float(rf + beta * mrp + mrp * views.get(ticker, 0.0)) for ticker, beta in betas.items()}


def _port_vol(w: np.ndarray, cov: np.ndarray) -> float:
    return float(np.sqrt(w @ cov @ w))


def _neg_sharpe_hist(w: np.ndarray, mean_ret: np.ndarray, cov: np.ndarray, rf: float) -> float:
    ret = float(np.dot(w, mean_ret) * 252)
    vol = _port_vol(w, cov) * np.sqrt(252)
    return -(ret - rf) / vol if vol > 0 else 0.0


def _short_cap_constraint(max_short: float | None) -> list[dict]:
    """Total short exposure Σ max(−wᵢ, 0) ≤ max_short. Empty when there is no cap."""
    if max_short is None:
        return []
    return [{"type": "ineq", "fun": lambda w: max_short - float(np.maximum(-w, 0.0).sum())}]


def _run_optimizer(objective, n: int, bounds: tuple, *args, extra_constraints=()) -> np.ndarray:
    x0 = np.ones(n) / n
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}, *extra_constraints]
    result = minimize(objective, x0, args=args, method="SLSQP", bounds=bounds, constraints=constraints, options={"ftol": 1e-10, "maxiter": 2000})
    if not result.success:
        raise RuntimeError(f"Optimizer did not converge: {result.message}")
    return result.x


def optimize_min_variance(returns: pd.DataFrame, max_weight: float = 1.0, min_weight: float = 0.0, asset_bounds: Optional[dict[str, tuple[float, float]]] = None, max_short: float | None = None) -> dict[str, float]:
    cov = returns.cov().values * 252
    tickers = returns.columns.tolist()
    bounds = tuple(asset_bounds.get(t, (min_weight, max_weight)) if asset_bounds else (min_weight, max_weight) for t in tickers)
    return dict(zip(tickers, _run_optimizer(_port_vol, len(tickers), bounds, cov, extra_constraints=_short_cap_constraint(max_short)).tolist()))


def optimize_max_sharpe(returns: pd.DataFrame, rf: float = 0.0, max_weight: float = 1.0, min_weight: float = 0.0, asset_bounds: Optional[dict[str, tuple[float, float]]] = None, max_short: float | None = None) -> dict[str, float]:
    mean_ret, cov = returns.mean().values, returns.cov().values
    tickers = returns.columns.tolist()
    bounds = tuple(asset_bounds.get(t, (min_weight, max_weight)) if asset_bounds else (min_weight, max_weight) for t in tickers)
    return dict(zip(tickers, _run_optimizer(_neg_sharpe_hist, len(tickers), bounds, mean_ret, cov, rf, extra_constraints=_short_cap_constraint(max_short)).tolist()))


# FLAG(custom): the method is standard (max Sharpe on CAPM expected returns). The custom part is
# the expected-returns input, which carries the view bumps — see compute_capm_expected_returns.
def optimize_max_sharpe_capm(returns: pd.DataFrame, expected_returns: dict[str, float], rf: float = 0.04, max_weight: float = 1.0, min_weight: float = 0.0, asset_bounds: Optional[dict[str, tuple[float, float]]] = None, max_short: float | None = None) -> dict[str, float]:
    tickers = [t for t in returns.columns if t in expected_returns]
    if not tickers:
        raise RuntimeError("No tickers overlap between returns and expected_returns.")
    mean_ret_annual = np.array([expected_returns[t] for t in tickers])
    cov_annual = returns[tickers].cov().values * 252
    bounds = tuple(asset_bounds.get(t, (min_weight, max_weight)) if asset_bounds else (min_weight, max_weight) for t in tickers)
    total_min = sum(b[0] for b in bounds)
    if total_min > 1.0 + 1e-6:
        raise RuntimeError(f"Sum of minimum bounds ({total_min:.2%}) exceeds 100%. Relax constraints.")
    def neg_sharpe_capm(w: np.ndarray) -> float:
        ret, vol = float(np.dot(w, mean_ret_annual)), float(np.sqrt(w @ cov_annual @ w))
        return -(ret - rf) / vol if vol > 0 else 0.0
    x0 = np.ones(len(tickers)) / len(tickers)
    for i, (lo, _) in enumerate(bounds):
        x0[i] = max(x0[i], lo)
    x0 = x0 / x0.sum()
    result = minimize(neg_sharpe_capm, x0, method="SLSQP", bounds=bounds, constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1.0}, *_short_cap_constraint(max_short)], options={"ftol": 1e-12, "maxiter": 3000})
    if not result.success:
        raise RuntimeError(f"CAPM optimizer did not converge: {result.message}")
    return dict(zip(tickers, result.x.tolist()))


def optimize_equal_weight(returns: pd.DataFrame) -> dict[str, float]:
    tickers = returns.columns.tolist()
    return {t: 1.0 / len(tickers) for t in tickers}


def optimize_risk_parity(returns: pd.DataFrame, max_weight: float = 1.0, min_weight: float = 0.0) -> dict[str, float]:
    cov, tickers = returns.cov().values * 252, returns.columns.tolist()
    n = len(tickers)
    def erc_objective(w: np.ndarray) -> float:
        port_var = float(w @ cov @ w)
        mrc = cov @ w
        rc = w * mrc
        target = port_var / n
        return float(np.sum((rc - target) ** 2))
    result = minimize(erc_objective, np.ones(n) / n, method="SLSQP", bounds=tuple((max(1e-6, min_weight), max_weight) for _ in tickers), constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1.0}], options={"ftol": 1e-12, "maxiter": 3000})
    if not result.success:
        raise RuntimeError(f"Risk parity optimizer did not converge: {result.message}")
    w = result.x / result.x.sum()
    return dict(zip(tickers, w.tolist()))


def optimize_max_sortino(returns: pd.DataFrame, rf: float = 0.0, max_weight: float = 1.0, min_weight: float = 0.0, max_short: float | None = None) -> dict[str, float]:
    tickers, ret_matrix = returns.columns.tolist(), returns.values
    mar = rf / 252.0
    def neg_sortino(w: np.ndarray) -> float:
        port = ret_matrix @ w
        excess_ann = float(port.mean()) * 252 - rf
        downside_dev = float(np.sqrt(np.mean(np.minimum(port - mar, 0.0) ** 2))) * np.sqrt(252)
        return -excess_ann / max(downside_dev, 1e-12)
    return dict(zip(tickers, _run_optimizer(neg_sortino, len(tickers), tuple((min_weight, max_weight) for _ in tickers), extra_constraints=_short_cap_constraint(max_short)).tolist()))


def optimize_min_cvar(returns: pd.DataFrame, alpha: float = 0.05, max_weight: float = 1.0, min_weight: float = 0.0, max_short: float | None = None) -> dict[str, float]:
    tickers, ret_matrix = returns.columns.tolist(), returns.values
    def cvar_objective(w: np.ndarray) -> float:
        port_rets = ret_matrix @ w
        tail = port_rets[port_rets <= float(np.percentile(port_rets, alpha * 100))]
        return -float(np.mean(tail)) if len(tail) else 0.0
    return dict(zip(tickers, _run_optimizer(cvar_objective, len(tickers), tuple((min_weight, max_weight) for _ in tickers), extra_constraints=_short_cap_constraint(max_short)).tolist()))


def optimize_max_diversification(returns: pd.DataFrame, max_weight: float = 1.0, min_weight: float = 0.0) -> dict[str, float]:
    cov, tickers = returns.cov().values * 252, returns.columns.tolist()
    asset_vols = np.sqrt(np.diag(cov))
    def neg_dr(w: np.ndarray) -> float:
        return -float(np.dot(w, asset_vols)) / float(np.sqrt(max(w @ cov @ w, 1e-12)))
    return dict(zip(tickers, _run_optimizer(neg_dr, len(tickers), tuple((max(0.0, min_weight), max_weight) for _ in tickers)).tolist()))


def optimize_target_volatility(returns: pd.DataFrame, vol_target: float = 0.10, max_weight: float = 1.0, min_weight: float = 0.0, max_short: float | None = None) -> dict[str, float]:
    cov, mean_ret_ann, tickers = returns.cov().values * 252, returns.mean().values * 252, returns.columns.tolist()
    def neg_ret(w: np.ndarray) -> float:
        return -float(np.dot(w, mean_ret_ann))
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}, {"type": "ineq", "fun": lambda w: vol_target - np.sqrt(max(float(w @ cov @ w), 0.0))}, *_short_cap_constraint(max_short)]
    result = minimize(neg_ret, np.ones(len(tickers)) / len(tickers), method="SLSQP", bounds=tuple((min_weight, max_weight) for _ in tickers), constraints=constraints, options={"ftol": 1e-10, "maxiter": 2000})
    if not result.success:
        raise RuntimeError(f"Target-vol optimizer did not converge: {result.message}")
    return dict(zip(tickers, result.x.tolist()))
