"""Portfolio risk decomposition: concentration, beta, component risk contributions.

Functions:
  compute_concentration   — HHI, N_eff, Top-5
  compute_risk_contributions — RC_i and MCTR_i, Σ RC_i = 1
  compute_portfolio_health — orchestrator
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd


# ── Concentration ─────────────────────────────────────────────────────────────

def compute_concentration(weights: dict[str, float]) -> dict:
    """Herfindahl-Hirschman Index, effective N, and top-5 weight sum.

    Args:
        weights: {ticker: weight}, weights need not sum to exactly 1.

    Returns:
        {hhi, n_eff, top5}
    """
    w = np.array(list(weights.values()), dtype=float)
    if w.sum() > 0:
        w = w / w.sum()  # normalise defensively
    hhi = float(np.sum(w ** 2))
    n_eff = float(1.0 / hhi) if hhi > 1e-12 else 0.0
    top5 = float(np.sum(np.sort(w)[::-1][:5]))
    return {
        "hhi": round(hhi, 4),
        "n_eff": round(n_eff, 2),
        "top5": round(top5, 4),
    }


# ── Risk contributions ─────────────────────────────────────────────────────────

def compute_risk_contributions(
    prices: pd.DataFrame,
    weights: dict[str, float],
) -> list[dict]:
    """Compute fractional risk contribution (RC) and MCTR per ticker.

    RC_i = w_i * (Σw)_i / (w'Σw)  →  Σ RC_i = 1

    MCTR_i = (Σw)_i / σ_p  (marginal contribution to portfolio vol)

    Args:
        prices: adjusted-close DataFrame with tickers as columns.
        weights: {ticker: weight}

    Returns:
        list of {ticker, weight, rc, mctr} sorted by rc descending.
    """
    tickers = [t for t in weights if t in prices.columns]
    missing = [t for t in weights if t not in prices.columns]
    if not tickers:
        return []

    w = np.array([weights[t] for t in tickers], dtype=float)
    if w.sum() > 0:
        w = w / w.sum()

    rets = prices[tickers].pct_change().dropna()
    if len(rets) < 5:
        return [
            {"ticker": t, "weight": round(float(weights[t]), 4), "rc": None, "mctr": None}
            for t in tickers
        ]

    cov = rets.cov().values * 252  # annualised
    port_var = float(w @ cov @ w)
    port_vol = float(np.sqrt(max(port_var, 1e-12)))
    marginal = cov @ w  # ∂σ_p² / ∂w_i (scaled)
    rc_raw = w * marginal
    rc = rc_raw / port_var if port_var > 1e-12 else np.zeros(len(w))
    mctr = marginal / port_vol

    rows = [
        {
            "ticker": tickers[i],
            "weight": round(float(w[i]), 4),
            "rc": round(float(rc[i]), 4),
            "mctr": round(float(mctr[i]), 4),
        }
        for i in range(len(tickers))
    ]
    # append tickers with no price data
    for t in missing:
        rows.append({"ticker": t, "weight": round(float(weights.get(t, 0)), 4), "rc": None, "mctr": None})

    return sorted(rows, key=lambda r: (r["rc"] is not None, r["rc"] or 0), reverse=True)


# ── Orchestrator ───────────────────────────────────────────────────────────────

def compute_portfolio_health(
    prices: pd.DataFrame,
    weights: dict[str, float],
    bench_prices: pd.DataFrame,
    lookback: int = 252,
) -> dict:
    """Compute concentration, beta, vol, and component risk contributions.

    Args:
        prices: adjusted-close DataFrame (portfolio tickers as columns).
        weights: {ticker: weight}.
        bench_prices: single-ticker DataFrame (benchmark, e.g. SPY).
        lookback: number of most-recent trading days to use.

    Returns:
        {concentration, beta, vol, risk_contributions, warnings}
    """
    warnings: list[str] = []

    # Trim to lookback
    prices = prices.iloc[-lookback:].copy()
    bench_prices = bench_prices.iloc[-lookback:].copy()

    tickers = [t for t in weights if t in prices.columns]
    if not tickers:
        warnings.append("No price data available for any position.")
        return {
            "concentration": compute_concentration(weights),
            "beta": None,
            "vol": None,
            "risk_contributions": [],
            "warnings": warnings,
        }

    w_arr = np.array([weights[t] for t in tickers], dtype=float)
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()

    rets = prices[tickers].pct_change().dropna()
    port_rets = (rets * w_arr).sum(axis=1)

    # Vol
    vol: Optional[float] = None
    if len(port_rets) >= 2:
        vol = round(float(port_rets.std() * np.sqrt(252)), 4)

    # Beta vs benchmark
    beta: Optional[float] = None
    try:
        bench_col = bench_prices.columns[0]
        bench_rets = bench_prices[bench_col].pct_change().dropna()
        common = port_rets.index.intersection(bench_rets.index)
        if len(common) >= 10:
            p = port_rets.loc[common].values
            b = bench_rets.loc[common].values
            cov_pb = np.cov(p, b)
            bench_var = cov_pb[1, 1]
            if bench_var > 1e-12:
                beta = round(float(cov_pb[0, 1] / bench_var), 4)
    except Exception as exc:
        warnings.append(f"Beta computation failed: {exc}")

    if len(port_rets) < 30:
        warnings.append(
            f"Only {len(port_rets)} days of returns — risk metrics may be unreliable. "
            "Consider a longer lookback window."
        )

    rc = compute_risk_contributions(prices, weights)
    conc = compute_concentration(weights)

    return {
        "concentration": conc,
        "beta": beta,
        "vol": vol,
        "risk_contributions": rc,
        "warnings": warnings,
    }
