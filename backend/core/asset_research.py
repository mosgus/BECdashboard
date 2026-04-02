"""Single-asset research: return/risk profile, Fama-French 3-factor exposure,
portfolio role classification, and correlation analysis.

Functions:
  compute_asset_profile        — CAGR, vol, Sharpe, Sortino, Calmar, capture ratios
  fetch_ff3_factors            — download + cache Kenneth French daily factors
  compute_fama_french_exposure — OLS regression on FF3 factors
  classify_portfolio_role      — rules-based role assignment
  compute_asset_correlation    — per-holding correlation + crowding check
"""
from __future__ import annotations

import io
import zipfile
from typing import Optional

import numpy as np
import pandas as pd
from cachetools import TTLCache
from scipy import stats as scipy_stats

from core.portfolio import (
    compute_drawdown,
    compute_equity_curve,
    compute_metrics,
    compute_rolling_vol,
)

# ── FF3 Factor Cache ─────────────────────────────────────────────────────────

_ff3_cache: TTLCache = TTLCache(maxsize=1, ttl=86400)  # 24h
_FF3_URL = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip"


def fetch_ff3_factors() -> Optional[pd.DataFrame]:
    """Download Fama-French 3 daily factors. Returns DataFrame with
    columns [Mkt-RF, SMB, HML, RF] indexed by date. Values in decimal form."""
    if "ff3" in _ff3_cache:
        return _ff3_cache["ff3"]

    try:
        import urllib.request

        resp = urllib.request.urlopen(_FF3_URL, timeout=30)
        zdata = resp.read()
        with zipfile.ZipFile(io.BytesIO(zdata)) as zf:
            csv_name = [n for n in zf.namelist() if n.endswith(".CSV")][0]
            raw = zf.read(csv_name).decode("utf-8")

        # Parse: skip header rows, find the daily data section
        lines = raw.strip().split("\n")
        start_idx = None
        for i, line in enumerate(lines):
            stripped = line.strip()
            # Daily data starts after a blank line following header text
            if stripped and stripped[0].isdigit() and len(stripped.split(",")) >= 4:
                if start_idx is None:
                    start_idx = i
            elif start_idx is not None:
                # Hit a non-data row after data started — end of daily section
                end_idx = i
                break
        else:
            end_idx = len(lines)

        if start_idx is None:
            return None

        data_lines = lines[start_idx:end_idx]
        rows = []
        for line in data_lines:
            parts = line.strip().split(",")
            if len(parts) < 5:
                continue
            try:
                date_str = parts[0].strip()
                if len(date_str) != 8:
                    continue
                dt = pd.Timestamp(f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}")
                mkt_rf = float(parts[1].strip()) / 100
                smb = float(parts[2].strip()) / 100
                hml = float(parts[3].strip()) / 100
                rf = float(parts[4].strip()) / 100
                rows.append({"date": dt, "Mkt-RF": mkt_rf, "SMB": smb, "HML": hml, "RF": rf})
            except (ValueError, IndexError):
                continue

        if not rows:
            return None

        df = pd.DataFrame(rows).set_index("date").sort_index()
        _ff3_cache["ff3"] = df
        return df

    except Exception:
        return None


# ── Asset Profile ────────────────────────────────────────────────────────────

def compute_asset_profile(
    prices: pd.Series,
    bench_prices: pd.Series,
) -> dict:
    """Comprehensive single-asset return and risk profile.

    Args:
        prices: daily adjusted close prices for the asset.
        bench_prices: daily adjusted close prices for the benchmark (SPY).

    Returns:
        dict with metrics, rolling_vol, rolling_return series.
    """
    returns = prices.pct_change().dropna()
    bench_returns = bench_prices.pct_change().dropna()

    # Align
    common = returns.index.intersection(bench_returns.index)
    returns = returns.loc[common]
    bench_returns = bench_returns.loc[common]

    n = len(returns)
    if n < 10:
        return {"error": "Insufficient data", "history_days": n}

    # Base metrics
    base = compute_metrics(returns, bench_returns)

    # Downside deviation
    downside = returns[returns < 0]
    downside_dev = float(downside.std() * np.sqrt(252)) if len(downside) > 1 else 0.0

    # Sortino
    sortino = (base.get("cagr", 0) / downside_dev) if downside_dev > 0 else 0.0

    # Calmar
    max_dd = base.get("max_dd", -1.0)
    calmar = (base.get("cagr", 0) / abs(max_dd)) if max_dd < 0 else 0.0

    # Capture ratios
    up_periods = bench_returns > 0
    down_periods = bench_returns < 0

    upside_capture = 0.0
    if up_periods.sum() > 5:
        upside_capture = float(returns[up_periods].mean() / bench_returns[up_periods].mean())

    downside_capture = 0.0
    if down_periods.sum() > 5:
        downside_capture = float(returns[down_periods].mean() / bench_returns[down_periods].mean())

    # Rolling series (252-day)
    rolling_vol = compute_rolling_vol(returns, 63).dropna()
    rolling_ret_252 = returns.rolling(252).apply(
        lambda x: float((1 + x).prod() - 1), raw=False
    ).dropna()

    return {
        "cagr": base.get("cagr", 0.0),
        "vol": base.get("vol", 0.0),
        "sharpe": base.get("sharpe", 0.0),
        "max_dd": base.get("max_dd", 0.0),
        "beta": base.get("beta"),
        "alpha": base.get("alpha"),
        "downside_dev": round(downside_dev, 4),
        "sortino": round(sortino, 4),
        "calmar": round(calmar, 4),
        "upside_capture": round(upside_capture, 4),
        "downside_capture": round(downside_capture, 4),
        "history_days": n,
        "rolling_vol": [
            {"date": str(d.date()), "value": round(float(v), 4)}
            for d, v in rolling_vol.items()
        ],
        "rolling_return": [
            {"date": str(d.date()), "value": round(float(v), 4)}
            for d, v in rolling_ret_252.items()
        ],
    }


# ── Fama-French 3-Factor Exposure ────────────────────────────────────────────

def compute_fama_french_exposure(returns: pd.Series) -> dict:
    """OLS regression of asset excess returns on FF3 factors.

    R_i - Rf = alpha + beta_mkt*(Rm-Rf) + beta_smb*SMB + beta_hml*HML + eps

    Returns:
        {alpha, beta_mkt, beta_smb, beta_hml, r_squared, t_stats, residual_vol}
    """
    ff3 = fetch_ff3_factors()
    if ff3 is None:
        return {"error": "Could not fetch Fama-French factors"}

    # Align dates
    common = returns.index.intersection(ff3.index)
    if len(common) < 60:
        return {"error": f"Insufficient overlapping data ({len(common)} days, need 60+)"}

    y = returns.loc[common] - ff3.loc[common, "RF"]
    X = ff3.loc[common, ["Mkt-RF", "SMB", "HML"]]

    # Add constant for alpha
    X_with_const = X.copy()
    X_with_const.insert(0, "const", 1.0)

    # OLS via numpy
    X_mat = X_with_const.values
    y_vec = y.values

    try:
        beta, residuals, rank, sv = np.linalg.lstsq(X_mat, y_vec, rcond=None)
    except Exception as exc:
        return {"error": f"OLS failed: {str(exc)[:100]}"}

    y_hat = X_mat @ beta
    ss_res = float(np.sum((y_vec - y_hat) ** 2))
    ss_tot = float(np.sum((y_vec - y_vec.mean()) ** 2))
    r_squared = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # Standard errors and t-stats
    n_obs = len(y_vec)
    k = X_mat.shape[1]
    mse = ss_res / (n_obs - k) if n_obs > k else 0.0
    try:
        cov_beta = mse * np.linalg.inv(X_mat.T @ X_mat)
        se = np.sqrt(np.diag(cov_beta))
        t_stats = beta / se
    except Exception:
        se = np.zeros(k)
        t_stats = np.zeros(k)

    residual_vol = float(np.std(y_vec - y_hat) * np.sqrt(252))

    # Annualise alpha
    alpha_daily = float(beta[0])
    alpha_annual = float((1 + alpha_daily) ** 252 - 1)

    return {
        "alpha_daily": round(alpha_daily, 6),
        "alpha_annual": round(alpha_annual, 4),
        "beta_mkt": round(float(beta[1]), 4),
        "beta_smb": round(float(beta[2]), 4),
        "beta_hml": round(float(beta[3]), 4),
        "r_squared": round(r_squared, 4),
        "t_stats": {
            "alpha": round(float(t_stats[0]), 2),
            "mkt": round(float(t_stats[1]), 2),
            "smb": round(float(t_stats[2]), 2),
            "hml": round(float(t_stats[3]), 2),
        },
        "residual_vol": round(residual_vol, 4),
        "n_obs": n_obs,
    }


# ── Portfolio Role Classification ────────────────────────────────────────────

def classify_portfolio_role(
    profile: dict,
    corr_to_portfolio: float,
    dividend_yield: Optional[float] = None,
) -> dict:
    """Rules-based portfolio role classification.

    Categories:
      - Return Engine: high beta, high vol, positive alpha
      - Diversifier: low correlation to portfolio
      - Defensive Ballast: low beta, low vol, shallow drawdown
      - Income Generator: high dividend yield, low vol
    """
    beta = profile.get("beta") or 0.0
    vol = profile.get("vol") or 0.0
    max_dd = profile.get("max_dd") or 0.0
    alpha = profile.get("alpha") or 0.0
    div_yield = dividend_yield or 0.0

    scores: dict[str, float] = {}

    # Return Engine: high beta, high vol, positive alpha
    re_score = 0.0
    if beta > 1.1:
        re_score += 0.4
    if vol > 0.20:
        re_score += 0.3
    if alpha > 0.02:
        re_score += 0.3
    scores["Return Engine"] = re_score

    # Diversifier: low correlation, moderate characteristics
    div_score = 0.0
    if corr_to_portfolio < 0.3:
        div_score += 0.6
    elif corr_to_portfolio < 0.5:
        div_score += 0.3
    if beta < 0.8:
        div_score += 0.2
    if vol < 0.25:
        div_score += 0.2
    scores["Diversifier"] = div_score

    # Defensive Ballast: low beta, low vol, shallow drawdown
    db_score = 0.0
    if beta < 0.7:
        db_score += 0.35
    if vol < 0.15:
        db_score += 0.35
    if max_dd > -0.20:  # shallow drawdown
        db_score += 0.3
    scores["Defensive Ballast"] = db_score

    # Income Generator: high div yield, low vol
    ig_score = 0.0
    if div_yield > 0.03:
        ig_score += 0.5
    elif div_yield > 0.02:
        ig_score += 0.3
    if vol < 0.18:
        ig_score += 0.3
    if max_dd > -0.25:
        ig_score += 0.2
    scores["Income Generator"] = ig_score

    # Pick top two
    ranked = sorted(scores.items(), key=lambda x: -x[1])
    primary = ranked[0]
    secondary = ranked[1] if ranked[1][1] > 0.3 else None

    # Build rationale
    reasons = []
    if beta > 1.1:
        reasons.append(f"high beta ({beta:.2f})")
    elif beta < 0.7:
        reasons.append(f"low beta ({beta:.2f})")
    if corr_to_portfolio < 0.3:
        reasons.append(f"low portfolio correlation ({corr_to_portfolio:.2f})")
    elif corr_to_portfolio > 0.8:
        reasons.append(f"highly correlated to portfolio ({corr_to_portfolio:.2f})")
    if vol > 0.25:
        reasons.append(f"high volatility ({vol:.1%})")
    elif vol < 0.15:
        reasons.append(f"low volatility ({vol:.1%})")
    if div_yield > 0.03:
        reasons.append(f"high dividend yield ({div_yield:.1%})")

    return {
        "primary_role": primary[0],
        "primary_score": round(primary[1], 2),
        "secondary_role": secondary[0] if secondary else None,
        "secondary_score": round(secondary[1], 2) if secondary else None,
        "rationale": "; ".join(reasons) if reasons else "Mixed characteristics",
        "scores": {k: round(v, 2) for k, v in scores.items()},
    }


# ── Correlation vs Portfolio Holdings ────────────────────────────────────────

def compute_asset_correlation(
    target_returns: pd.Series,
    portfolio_returns: pd.DataFrame,
) -> dict:
    """Compute correlation of target asset vs each portfolio holding.

    Returns:
        {per_holding: [{ticker, correlation}], avg_corr, max_corr, max_corr_ticker}
    """
    results = []
    for col in portfolio_returns.columns:
        common = target_returns.index.intersection(portfolio_returns[col].dropna().index)
        if len(common) < 30:
            results.append({"ticker": col, "correlation": None})
            continue
        corr = float(target_returns.loc[common].corr(portfolio_returns[col].loc[common]))
        results.append({"ticker": col, "correlation": round(corr, 4)})

    valid = [r for r in results if r["correlation"] is not None]
    corrs = [r["correlation"] for r in valid]

    avg_corr = float(np.mean(corrs)) if corrs else None
    max_corr = float(np.max(corrs)) if corrs else None
    max_ticker = valid[int(np.argmax(corrs))]["ticker"] if corrs else None

    return {
        "per_holding": sorted(results, key=lambda r: -(r["correlation"] or -2)),
        "avg_correlation": round(avg_corr, 4) if avg_corr is not None else None,
        "max_correlation": round(max_corr, 4) if max_corr is not None else None,
        "max_corr_ticker": max_ticker,
        "crowding_warning": max_corr is not None and max_corr > 0.8,
    }
