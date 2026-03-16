"""
Data fetching layer — BallDontLie games, Kalshi markets, NBA stats via stats.nba.com.
Uses the same data pipeline as the NBA ML model (kyleskom/NBA-Machine-Learning-Sports-Betting).
"""

import os
import sys
import time
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import List, Dict, Optional

import pandas as pd
import requests

# Add src/ to path so we can import NBA ML utilities
NBA_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NBA_DIR))

from nba.config import (
    KALSHI_API_BASE,
    BALLDONTLIE_API_BASE,
    NBA_STATS_URL,
    NBA_STATS_HEADERS,
    FULL_TO_ABBREV,
)

SCHEDULE_PATH = NBA_DIR / "Data" / "nba-2025-UTC.csv"

# ============================================================================
# MODULE-LEVEL TTL CACHE (replaces Streamlit @st.cache_data)
# ============================================================================

_cache: dict = {}


def _cached(key: str, ttl: int, fn):
    now = time.time()
    if key in _cache and now - _cache[key]["ts"] < ttl:
        return _cache[key]["data"]
    data = fn()
    _cache[key] = {"data": data, "ts": now}
    return data


# ============================================================================
# BALLDONTLIE — TODAY'S GAMES
# ============================================================================

def fetch_games(game_date: date) -> List[Dict]:
    """
    Fetch today's NBA games from BallDontLie.
    Returns: [{game_id, home_abbr, away_abbr, home_name, away_name, tipoff_utc, status}]
    Called fresh each request (client-side React Query handles caching).
    """
    try:
        api_key = os.environ.get("BALLDONTLIE_API_KEY", "")
        headers = {"Authorization": api_key} if api_key else {}
        resp = requests.get(
            f"{BALLDONTLIE_API_BASE}/games",
            params={"dates[]": game_date.isoformat()},
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()

        games = []
        for raw in resp.json().get("data", []):
            home = raw.get("home_team", {})
            away = raw.get("visitor_team", {})
            home_abbr = home.get("abbreviation", "")
            away_abbr = away.get("abbreviation", "")
            status = raw.get("status", "")

            dt_str = raw.get("datetime") or raw.get("date", "")
            try:
                tipoff = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            except Exception:
                tipoff = datetime.utcnow()

            if status == "Final":
                game_status = "final"
            elif status in ("In Progress", "1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr", "Halftime", "OT"):
                game_status = "in_progress"
            else:
                game_status = "scheduled"

            if home_abbr and away_abbr and game_status != "final":
                games.append({
                    "game_id": raw.get("id", ""),
                    "home_abbr": home_abbr,
                    "away_abbr": away_abbr,
                    "home_name": home.get("full_name", ""),
                    "away_name": away.get("full_name", ""),
                    "tipoff_utc": tipoff.isoformat(),
                    "status": game_status,
                })
        return games

    except Exception:
        return []


# ============================================================================
# KALSHI — ALL THREE MARKET TYPES
# ============================================================================

def fetch_kalshi_markets() -> Dict[str, List[Dict]]:
    """
    Fetch Kalshi NBA markets: moneyline, spread, total.
    Returns: {"moneyline": [...], "spread": [...], "total": [...]}
    Each market dict has: ticker, title, event_ticker, yes_bid, yes_ask, last_price, volume
    Called fresh each request (React Query handles client-side caching).
    """
    results = {}
    for market_type, prefix in [
        ("moneyline", "KXNBAGAME"),
        ("spread", "KXNBASPREAD"),
        ("total", "KXNBATOTAL"),
    ]:
        try:
            api_key = os.environ.get("KALSHI_API_KEY", "")
            headers = {"Authorization": api_key} if api_key else {}
            resp = requests.get(
                f"{KALSHI_API_BASE}/markets",
                params={"status": "open", "series_ticker": prefix, "limit": 500},
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            markets = []
            for mkt in resp.json().get("markets", []):
                yes_bid    = (mkt.get("yes_bid",    0) or 0) / 100.0
                yes_ask    = (mkt.get("yes_ask",    0) or 0) / 100.0
                last_price = (mkt.get("last_price", 0) or 0) / 100.0
                if yes_bid <= 0 and yes_ask <= 0 and last_price <= 0:
                    continue
                markets.append({
                    "ticker":       mkt.get("ticker", ""),
                    "title":        mkt.get("title", ""),
                    "event_ticker": mkt.get("event_ticker", ""),
                    "yes_bid":      yes_bid,
                    "yes_ask":      yes_ask,
                    "last_price":   last_price,
                    "volume":       mkt.get("volume", 0),
                })
            results[market_type] = markets
        except Exception:
            results[market_type] = []
    return results


# ============================================================================
# NBA STATS — stats.nba.com (slow — 1-hour TTL cache)
# ============================================================================

def _fetch_nba_stats_impl() -> Optional[pd.DataFrame]:
    now = datetime.now()
    yr = now.year if now.month >= 10 else now.year - 1
    season = f"{yr}-{str(yr + 1)[2:]}"  # "2025-26"

    url = NBA_STATS_URL.format(season=season)

    for attempt in range(3):
        try:
            time.sleep(1.0 + attempt)
            resp = requests.get(url, headers=NBA_STATS_HEADERS, timeout=20)
            resp.raise_for_status()
            result_sets = resp.json().get("resultSets", [])
            if not result_sets:
                continue
            rs = result_sets[0]
            df = pd.DataFrame(data=rs["rowSet"], columns=rs["headers"])
            return df
        except Exception:
            if attempt == 2:
                return None

    return None


def fetch_nba_stats() -> Optional[pd.DataFrame]:
    """
    Fetch current-season per-game team stats from stats.nba.com.
    Cached for 1 hour at module level.
    """
    return _cached("nba_stats", 3600, _fetch_nba_stats_impl)


# ============================================================================
# SCHEDULE — 24-hour TTL cache
# ============================================================================

def _load_schedule_impl() -> Optional[pd.DataFrame]:
    try:
        df = pd.read_csv(SCHEDULE_PATH, parse_dates=["Date"], date_format="%d/%m/%Y %H:%M")
        return df
    except Exception:
        return None


def load_schedule() -> Optional[pd.DataFrame]:
    """Load season schedule CSV. Cached for 24 hours."""
    return _cached("schedule", 86400, _load_schedule_impl)


def compute_rest_days(team_full_name: str, today: datetime, schedule_df: pd.DataFrame) -> int:
    """
    Calculate days of rest for a team before today's game.
    Returns 2 (league average) if unavailable.
    """
    if schedule_df is None:
        return 2
    try:
        games = schedule_df[
            (schedule_df["Home Team"] == team_full_name) |
            (schedule_df["Away Team"] == team_full_name)
        ]
        prev = games.loc[games["Date"] <= today].sort_values("Date", ascending=False).head(1)["Date"]
        if len(prev) > 0:
            last_date = prev.iloc[0]
            return (timedelta(days=1) + today - last_date).days
        return 7  # First game of season
    except Exception:
        return 2
