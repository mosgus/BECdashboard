"""Universe data quality audit, screening, and summary statistics.

Functions:
  audit_data_quality   — per-ticker history length, gap %, volume, quality grade
  screen_universe      — apply fundamental/data filters, return pass/fail
  compute_universe_stats — sector distribution, market cap percentiles, coverage
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import yfinance as yf

from core.cache import fetch_prices


# ── Data quality audit ───────────────────────────────────────────────────────

def _audit_single_ticker(
    ticker: str,
    start: str,
    end: str,
    min_history_days: int,
) -> dict:
    """Audit a single ticker's data quality."""
    result = {
        "ticker": ticker,
        "history_days": 0,
        "first_date": None,
        "last_date": None,
        "pct_gaps": 0.0,
        "avg_daily_volume": None,
        "grade": "F",
        "issues": [],
    }

    try:
        # Fetch raw OHLCV (not the cache, which forward-fills)
        raw = yf.download(
            ticker,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
        )
        if raw.empty:
            result["issues"].append("No data returned from yfinance")
            return result

        close = raw["Close"].squeeze() if isinstance(raw["Close"], pd.DataFrame) else raw["Close"]
        n_total = len(close)
        n_valid = int(close.notna().sum())
        n_gaps = n_total - n_valid

        result["history_days"] = n_total
        result["first_date"] = str(close.index[0].date()) if n_total > 0 else None
        result["last_date"] = str(close.index[-1].date()) if n_total > 0 else None
        result["pct_gaps"] = round(n_gaps / n_total, 4) if n_total > 0 else 0.0

        # Volume
        if "Volume" in raw.columns:
            vol_series = raw["Volume"].squeeze() if isinstance(raw["Volume"], pd.DataFrame) else raw["Volume"]
            avg_vol = float(vol_series.mean())
            result["avg_daily_volume"] = round(avg_vol, 0)

        # Grading
        issues = []
        if n_total < min_history_days:
            issues.append(f"Short history ({n_total} < {min_history_days} days)")
        if result["pct_gaps"] > 0.05:
            issues.append(f"High gap rate ({result['pct_gaps']:.1%})")
        if result["avg_daily_volume"] is not None and result["avg_daily_volume"] < 100_000:
            issues.append(f"Low volume (ADV={result['avg_daily_volume']:,.0f})")

        result["issues"] = issues
        if len(issues) == 0:
            result["grade"] = "A"
        elif len(issues) == 1:
            result["grade"] = "B"
        elif n_total < 60:
            result["grade"] = "F"
        else:
            result["grade"] = "C"

    except Exception as exc:
        result["issues"].append(f"Fetch error: {str(exc)[:100]}")

    return result


def audit_data_quality(
    tickers: list[str],
    min_history_days: int = 504,
    lookback_years: int = 3,
) -> list[dict]:
    """Audit data quality for a list of tickers.

    Returns per-ticker dict with history_days, pct_gaps, avg_daily_volume,
    grade (A/B/C/F), and issues list.
    """
    end = datetime.now()
    start = end - timedelta(days=lookback_years * 365)
    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_audit_single_ticker, t, start_str, end_str, min_history_days): t
            for t in tickers
        }
        for fut in as_completed(futures):
            results.append(fut.result())

    return sorted(results, key=lambda r: r["ticker"])


# ── Screening ────────────────────────────────────────────────────────────────

def screen_universe(
    tickers: list[dict],
    min_market_cap: Optional[float] = None,
    max_pe: Optional[float] = None,
    min_div_yield: Optional[float] = None,
    sectors_include: Optional[list[str]] = None,
    sectors_exclude: Optional[list[str]] = None,
    min_history_days: Optional[int] = None,
    quality_results: Optional[list[dict]] = None,
) -> list[dict]:
    """Screen universe tickers against fundamental and data quality filters.

    Args:
        tickers: list of dicts with keys: ticker, sector, market_cap, pe_ratio,
                 dividend_yield, etc. (from _ticker_dict in universe router)
        quality_results: optional output of audit_data_quality to join on.

    Returns:
        list of {ticker, filters: {filter_name: pass/fail}, eligible: bool}
    """
    quality_map = {}
    if quality_results:
        quality_map = {q["ticker"]: q for q in quality_results}

    results = []
    for t in tickers:
        filters = {}

        if min_market_cap is not None:
            cap = t.get("market_cap")
            filters["min_market_cap"] = cap is not None and cap >= min_market_cap

        if max_pe is not None:
            pe = t.get("pe_ratio")
            filters["max_pe"] = pe is not None and pe <= max_pe

        if min_div_yield is not None:
            dy = t.get("dividend_yield")
            filters["min_div_yield"] = dy is not None and dy >= min_div_yield

        if sectors_include is not None:
            sec = t.get("sector") or ""
            filters["sector_include"] = sec in sectors_include

        if sectors_exclude is not None:
            sec = t.get("sector") or ""
            filters["sector_exclude"] = sec not in sectors_exclude

        if min_history_days is not None:
            q = quality_map.get(t["ticker"], {})
            hd = q.get("history_days", 0)
            filters["min_history"] = hd >= min_history_days

        eligible = all(filters.values()) if filters else True
        results.append({
            "ticker": t["ticker"],
            "name": t.get("name"),
            "sector": t.get("sector"),
            "market_cap": t.get("market_cap"),
            "pe_ratio": t.get("pe_ratio"),
            "dividend_yield": t.get("dividend_yield"),
            "filters": filters,
            "eligible": eligible,
        })

    return results


# ── Summary stats ────────────────────────────────────────────────────────────

def compute_universe_stats(tickers: list[dict]) -> dict:
    """Compute aggregate universe statistics.

    Args:
        tickers: list of ticker dicts with enrichment fields.

    Returns:
        {total, active, sector_distribution, market_cap_percentiles, coverage}
    """
    total = len(tickers)
    active = sum(1 for t in tickers if t.get("active", True))

    # Sector distribution
    sectors: dict[str, int] = {}
    for t in tickers:
        sec = t.get("sector") or "Unknown"
        sectors[sec] = sectors.get(sec, 0) + 1

    # Market cap percentiles
    caps = [t["market_cap"] for t in tickers if t.get("market_cap")]
    cap_percentiles = {}
    if caps:
        arr = np.array(caps, dtype=float)
        cap_percentiles = {
            "p10": float(np.percentile(arr, 10)),
            "p25": float(np.percentile(arr, 25)),
            "p50": float(np.percentile(arr, 50)),
            "p75": float(np.percentile(arr, 75)),
            "p90": float(np.percentile(arr, 90)),
        }

    # Coverage stats
    has_sector = sum(1 for t in tickers if t.get("sector"))
    has_cap = sum(1 for t in tickers if t.get("market_cap"))
    has_pe = sum(1 for t in tickers if t.get("pe_ratio"))
    has_div = sum(1 for t in tickers if t.get("dividend_yield"))

    return {
        "total": total,
        "active": active,
        "sector_distribution": dict(sorted(sectors.items(), key=lambda x: -x[1])),
        "market_cap_percentiles": cap_percentiles,
        "coverage": {
            "sector": has_sector,
            "market_cap": has_cap,
            "pe_ratio": has_pe,
            "dividend_yield": has_div,
        },
    }
