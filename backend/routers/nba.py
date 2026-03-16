"""NBA Betting Intelligence — live predictions."""
from datetime import date

from fastapi import APIRouter, Query

from nba.fetch import fetch_games, fetch_kalshi_markets, fetch_nba_stats, load_schedule
from nba.model import build_all_rows

router = APIRouter()


@router.get("/nba/predictions")
def get_nba_predictions(w_xgb: float = Query(default=1.0, ge=0.0, le=2.0)):
    games       = fetch_games(date.today())
    kalshi      = fetch_kalshi_markets()
    stats_df    = fetch_nba_stats()
    schedule_df = load_schedule()

    weights = {"w_xgb": w_xgb}
    df = build_all_rows(games, kalshi, stats_df, schedule_df, weights)
    rows = df.to_dict(orient="records") if not df.empty else []

    return {
        "games_count":   len(games),
        "markets_count": len(rows),
        "positive_ev":   sum(1 for r in rows if r.get("ev", 0) > 0),
        "positive_edge": sum(1 for r in rows if r.get("edge", 0) > 0),
        "stats_loaded":  any(r.get("stats_loaded") for r in rows),
        "rows":          rows,
    }
