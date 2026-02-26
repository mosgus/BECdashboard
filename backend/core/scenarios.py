"""Portfolio scenario analysis: parametric shocks + historical window replay.

Functions:
  run_market_shock        — uniform shock to all assets
  run_vol_shock           — scale covariance matrix, observe portfolio vol change
  run_historical_replay   — apply current weights to realized returns in a date window
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd


# ── Market shock ───────────────────────────────────────────────────────────────

def run_market_shock(
    weights: dict[str, float],
    shock_pct: float,
) -> dict:
    """Apply a uniform simultaneous shock_pct to every asset.

    For a fully invested portfolio (Σw = 1) the portfolio impact equals shock_pct.
    Individual contributions = w_i * shock_pct.

    Args:
        weights:   {ticker: weight}
        shock_pct: fractional shock, e.g. -0.20 for a 20% drawdown.

    Returns:
        {portfolio_impact, contributions: [{ticker, weight, impact}]}
    """
    total_w = sum(weights.values())
    portfolio_impact = round(shock_pct * total_w, 4)  # handles non-unit portfolios

    contributions = sorted(
        [
            {
                "ticker": t,
                "weight": round(float(w), 4),
                "impact": round(float(w * shock_pct), 4),
            }
            for t, w in weights.items()
        ],
        key=lambda x: x["impact"],  # worst first
    )
    return {
        "portfolio_impact": portfolio_impact,
        "contributions": contributions,
    }


# ── Vol shock ─────────────────────────────────────────────────────────────────

def run_vol_shock(
    prices: pd.DataFrame,
    weights: dict[str, float],
    vol_scale: float,
) -> dict:
    """Scale the covariance matrix by vol_scale² and report the new portfolio vol.

    Args:
        prices:    adjusted-close DataFrame (portfolio tickers as columns).
        weights:   {ticker: weight}.
        vol_scale: multiplier on vol, e.g. 2.0 = double current volatility.

    Returns:
        {base_vol, shocked_vol, vol_scale}
    """
    tickers = [t for t in weights if t in prices.columns]
    if not tickers:
        return {"base_vol": None, "shocked_vol": None, "vol_scale": vol_scale,
                "warnings": ["No price data for portfolio tickers."]}

    w = np.array([weights[t] for t in tickers], dtype=float)
    if w.sum() > 0:
        w = w / w.sum()

    rets = prices[tickers].pct_change().dropna()
    if len(rets) < 5:
        return {"base_vol": None, "shocked_vol": None, "vol_scale": vol_scale,
                "warnings": ["Insufficient return history for vol computation."]}

    cov = rets.cov().values * 252
    base_vol = float(np.sqrt(max(float(w @ cov @ w), 0.0)))
    shocked_cov = cov * (vol_scale ** 2)
    shocked_vol = float(np.sqrt(max(float(w @ shocked_cov @ w), 0.0)))

    return {
        "base_vol": round(base_vol, 4),
        "shocked_vol": round(shocked_vol, 4),
        "vol_scale": vol_scale,
    }


# ── Historical replay ─────────────────────────────────────────────────────────

def run_historical_replay(
    prices: pd.DataFrame,
    weights: dict[str, float],
    start: str,
    end: str,
) -> dict:
    """Apply today's weights to realized historical returns in [start, end].

    Args:
        prices:  adjusted-close DataFrame (all tickers, full history).
        weights: {ticker: weight} — current portfolio weights.
        start:   start date string, e.g. "2022-01-01".
        end:     end date string, e.g. "2022-12-31".

    Returns:
        {total_return, max_dd, worst_day, best_day, contributors, equity_curve, n_days}
    """
    from core.portfolio import compute_portfolio_returns, compute_equity_curve, compute_drawdown

    tickers = [t for t in weights if t in prices.columns]
    missing = [t for t in weights if t not in prices.columns]
    warnings: list[str] = []
    if missing:
        warnings.append(f"No price data for: {', '.join(missing)}. Excluded from replay.")

    if not tickers:
        return {"error": "No price data for any portfolio ticker.", "warnings": warnings}

    w = np.array([weights[t] for t in tickers], dtype=float)
    if w.sum() > 0:
        w = w / w.sum()

    # Slice to window
    window_prices = prices[tickers].loc[start:end]
    if len(window_prices) < 2:
        return {
            "error": f"No trading days found between {start} and {end}.",
            "warnings": warnings,
        }

    rets = window_prices.pct_change().dropna()
    if len(rets) < 1:
        return {"error": "Insufficient return data in window.", "warnings": warnings}

    port_rets = compute_portfolio_returns(rets, w)
    equity = compute_equity_curve(port_rets)
    dd = compute_drawdown(equity)

    # Per-asset contribution over window
    asset_returns = (window_prices.iloc[-1] / window_prices.iloc[0]) - 1.0
    contributors = sorted(
        [
            {
                "ticker": tickers[i],
                "asset_return": round(float(asset_returns.iloc[i]), 4),
                "weight": round(float(w[i]), 4),
                "weighted_contribution": round(float(w[i] * float(asset_returns.iloc[i])), 4),
            }
            for i in range(len(tickers))
        ],
        key=lambda x: x["weighted_contribution"],
    )

    equity_curve = [
        {"date": str(d.date()), "value": round(float(v), 4)}
        for d, v in equity.items()
    ]

    return {
        "total_return": round(float(equity.iloc[-1] - 1.0), 4),
        "max_dd": round(float(dd.min()), 4),
        "worst_day": round(float(port_rets.min()), 4),
        "best_day": round(float(port_rets.max()), 4),
        "contributors": contributors,
        "equity_curve": equity_curve,
        "start": start,
        "end": end,
        "n_days": int(len(port_rets)),
        "warnings": warnings,
    }
