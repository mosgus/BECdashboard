"""Rebalance assistant: drift, turnover, and top-trade computation.

Function:
  compute_rebalance — given current and target weights, returns
                      drift table, turnover, and top 10 trades.
"""
from __future__ import annotations


def compute_rebalance(
    current_weights: dict[str, float],
    target_weights: dict[str, float],
) -> dict:
    """Compute drift, turnover, and top trades between current and target portfolios.

    drift_i     = target_i - current_i
    turnover    = 0.5 * Σ |drift_i|   (one-way turnover)
    action      = BUY  if drift >  0.001
                  SELL if drift < -0.001
                  HOLD otherwise

    Args:
        current_weights: {ticker: current_weight}  (may be fractional or percentage)
        target_weights:  {ticker: target_weight}

    Returns:
        {turnover, drift_table: [...], top_trades: [...]}
    """
    all_tickers = sorted(set(current_weights) | set(target_weights))

    rows = []
    for t in all_tickers:
        cur = float(current_weights.get(t, 0.0))
        tgt = float(target_weights.get(t, 0.0))
        drift = tgt - cur
        if drift > 0.001:
            action = "BUY"
        elif drift < -0.001:
            action = "SELL"
        else:
            action = "HOLD"
        rows.append(
            {
                "ticker": t,
                "current_weight": round(cur, 4),
                "target_weight": round(tgt, 4),
                "drift": round(drift, 4),
                "action": action,
            }
        )

    turnover = round(0.5 * sum(abs(r["drift"]) for r in rows), 4)

    # Top 10 trades sorted by absolute drift (largest moves first)
    top_trades = sorted(rows, key=lambda r: abs(r["drift"]), reverse=True)[:10]

    return {
        "turnover": turnover,
        "drift_table": rows,
        "top_trades": top_trades,
    }
