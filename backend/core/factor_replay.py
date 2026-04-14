"""Factor-projected scenario analysis.

Given a historical window, we:
  1. characterize_regime       — compute cumulative FF3 factor returns over the window
  2. fit_current_betas          — OLS regression on the portfolio's recent returns
  3. project_portfolio_impact   — apply historical factor shocks to today's betas;
                                  Monte Carlo overlay via block bootstrap of daily factors

Key difference from historical_replay: we don't apply today's weights to 2008
prices (which drops tickers that didn't exist). Instead we characterize the
2008 regime by its factor returns, then project onto today's portfolio's
current factor exposures.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from core.asset_research import fetch_ff3_factors


# ── Regime characterization ──────────────────────────────────────────────────

def characterize_regime(start: str, end: str) -> dict:
    """Compute cumulative FF3 factor returns for a historical window.

    Returns:
        {
          mkt_rf_sum, smb_sum, hml_sum, rf_sum   — sum of daily returns (period return approx)
          n_days,
          daily_factors                          — DataFrame[date x (Mkt-RF, SMB, HML, RF)]
          error                                  — optional error string
        }
    """
    ff3 = fetch_ff3_factors()
    if ff3 is None:
        return {"error": "Could not fetch Fama-French factors"}

    window = ff3.loc[start:end]
    if window.empty:
        return {"error": f"No FF3 data in window {start} -> {end}"}

    return {
        "mkt_rf_sum": float(window["Mkt-RF"].sum()),
        "smb_sum":    float(window["SMB"].sum()),
        "hml_sum":    float(window["HML"].sum()),
        "rf_sum":     float(window["RF"].sum()),
        "n_days":     int(len(window)),
        "daily_factors": window,
    }


# ── Current betas ────────────────────────────────────────────────────────────

def fit_current_betas(port_returns: pd.Series) -> dict:
    """Fit FF3 regression on the portfolio's recent daily returns.

    Returns:
        {
          alpha_daily, beta_mkt, beta_smb, beta_hml,
          r_squared, residual_vol_daily, n_obs,
          error (optional)
        }
    """
    ff3 = fetch_ff3_factors()
    if ff3 is None:
        return {"error": "Could not fetch Fama-French factors"}

    common = port_returns.index.intersection(ff3.index)
    if len(common) < 60:
        return {"error": f"Insufficient overlap ({len(common)} days, need 60+)"}

    p = port_returns.loc[common]
    factors = ff3.loc[common]
    y = (p - factors["RF"]).values
    X = np.column_stack([
        np.ones(len(common)),
        factors["Mkt-RF"].values,
        factors["SMB"].values,
        factors["HML"].values,
    ])

    try:
        beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
    except Exception as exc:
        return {"error": f"OLS failed: {str(exc)[:100]}"}

    y_hat = X @ beta
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    residual_vol = float(np.std(y - y_hat))

    return {
        "alpha_daily": round(float(beta[0]), 6),
        "beta_mkt":    round(float(beta[1]), 4),
        "beta_smb":    round(float(beta[2]), 4),
        "beta_hml":    round(float(beta[3]), 4),
        "r_squared":   round(r_squared, 4),
        "residual_vol_daily": round(residual_vol, 6),
        "n_obs":       len(common),
    }


# ── Projection + Monte Carlo ─────────────────────────────────────────────────

def project_portfolio_impact(
    betas: dict,
    regime: dict,
    n_monte_carlo: int = 500,
    block_size: int = 5,
    seed: int = 42,
) -> dict:
    """Apply regime factor shocks to current betas; Monte Carlo via block bootstrap.

    Point projection (additive over the window):
        total = alpha_daily * n_days
              + beta_mkt * mkt_rf_sum
              + beta_smb * smb_sum
              + beta_hml * hml_sum
              + rf_sum

    Monte Carlo: resample daily factor vectors from the regime window using
    overlapping blocks of `block_size` days (preserves weekly autocorrelation),
    compute portfolio daily return via current betas, compound to a path,
    repeat n_monte_carlo times. Residual idiosyncratic shock sampled from
    Gaussian(0, residual_vol_daily).
    """
    if betas.get("error") or regime.get("error"):
        return {
            "error": betas.get("error") or regime.get("error"),
        }

    alpha = betas["alpha_daily"]
    b_mkt = betas["beta_mkt"]
    b_smb = betas["beta_smb"]
    b_hml = betas["beta_hml"]
    resid_vol = betas["residual_vol_daily"]

    n_days = regime["n_days"]
    daily = regime["daily_factors"]
    mkt = daily["Mkt-RF"].values
    smb = daily["SMB"].values
    hml = daily["HML"].values
    rf = daily["RF"].values

    # ── Point projection (sum of daily factor contributions) ───────────────
    market_sum = b_mkt * regime["mkt_rf_sum"]
    smb_contrib = b_smb * regime["smb_sum"]
    hml_contrib = b_hml * regime["hml_sum"]
    alpha_contrib = alpha * n_days
    rf_contrib = regime["rf_sum"]
    point_total = alpha_contrib + market_sum + smb_contrib + hml_contrib + rf_contrib

    point = {
        "total_pct":   round(float(point_total), 6),
        "market_pct":  round(float(market_sum), 6),
        "smb_pct":     round(float(smb_contrib), 6),
        "hml_pct":     round(float(hml_contrib), 6),
        "alpha_pct":   round(float(alpha_contrib), 6),
        "rf_pct":      round(float(rf_contrib), 6),
    }

    # ── Monte Carlo via block bootstrap ─────────────────────────────────────
    rng = np.random.default_rng(seed)
    n_blocks_per_path = max(1, n_days // block_size)
    path_lengths: list[np.ndarray] = []
    all_terminal_returns: list[float] = []
    # Track P5/P50/P95 by day for the fan chart
    path_matrix = np.zeros((n_monte_carlo, n_days), dtype=np.float64)

    for p_idx in range(n_monte_carlo):
        # Build a path of n_days daily portfolio returns by sampling factor blocks
        block_starts = rng.integers(0, max(1, len(mkt) - block_size + 1), size=n_blocks_per_path + 2)
        mkt_path = np.concatenate([mkt[s:s + block_size] for s in block_starts])[:n_days]
        smb_path = np.concatenate([smb[s:s + block_size] for s in block_starts])[:n_days]
        hml_path = np.concatenate([hml[s:s + block_size] for s in block_starts])[:n_days]
        rf_path  = np.concatenate([rf[s:s + block_size]  for s in block_starts])[:n_days]

        # Residual noise
        eps = rng.normal(0.0, resid_vol, size=n_days)

        # Daily portfolio return: alpha + beta-weighted factors + RF + residual
        daily_port = (
            alpha + b_mkt * mkt_path + b_smb * smb_path + b_hml * hml_path + rf_path + eps
        )
        # Cumulative geometric return (path)
        equity = np.cumprod(1.0 + daily_port) - 1.0
        path_matrix[p_idx, :] = equity
        all_terminal_returns.append(float(equity[-1]))

    all_terminal_returns_arr = np.array(all_terminal_returns)

    mc = {
        "p5":   round(float(np.percentile(all_terminal_returns_arr, 5)), 6),
        "p25":  round(float(np.percentile(all_terminal_returns_arr, 25)), 6),
        "p50":  round(float(np.percentile(all_terminal_returns_arr, 50)), 6),
        "p75":  round(float(np.percentile(all_terminal_returns_arr, 75)), 6),
        "p95":  round(float(np.percentile(all_terminal_returns_arr, 95)), 6),
        "mean": round(float(all_terminal_returns_arr.mean()), 6),
        "prob_loss_gt_20": round(float((all_terminal_returns_arr < -0.20).mean()), 4),
        "prob_loss_gt_10": round(float((all_terminal_returns_arr < -0.10).mean()), 4),
        "prob_loss": round(float((all_terminal_returns_arr < 0).mean()), 4),
        "n_paths": n_monte_carlo,
    }

    # Sparse path summary for plotting (every ~5 days to keep payload small)
    stride = max(1, n_days // 40)
    paths_summary = []
    for d in range(0, n_days, stride):
        col = path_matrix[:, d]
        paths_summary.append({
            "day": int(d),
            "p5":  round(float(np.percentile(col, 5)), 6),
            "p25": round(float(np.percentile(col, 25)), 6),
            "p50": round(float(np.percentile(col, 50)), 6),
            "p75": round(float(np.percentile(col, 75)), 6),
            "p95": round(float(np.percentile(col, 95)), 6),
        })
    # Always include final day
    if paths_summary[-1]["day"] != n_days - 1:
        col = path_matrix[:, -1]
        paths_summary.append({
            "day": int(n_days - 1),
            "p5":  round(float(np.percentile(col, 5)), 6),
            "p25": round(float(np.percentile(col, 25)), 6),
            "p50": round(float(np.percentile(col, 50)), 6),
            "p75": round(float(np.percentile(col, 75)), 6),
            "p95": round(float(np.percentile(col, 95)), 6),
        })

    return {
        "point_projection": point,
        "mc_distribution":  mc,
        "paths_summary":    paths_summary,
    }
