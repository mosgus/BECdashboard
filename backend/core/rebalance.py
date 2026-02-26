"""Rebalance assistant: drift, turnover, whole-share implementation.

Functions:
  compute_rebalance      — drift table, turnover, and top 10 trades.
  compute_implementation — whole-share trade worksheet (floor + greedy cleanup).
"""
from __future__ import annotations

import math


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


def compute_implementation(
    current_weights: dict[str, float],
    target_weights: dict[str, float],
    prices: dict[str, float],
    notional_value: float,
    max_weight: float = 1.0,
) -> dict:
    """Whole-share implementation worksheet.

    Converts target weight fractions into integer share counts via:
      1. target_value_i  = target_weight_i * V
      2. raw_shares_i    = target_value_i / price_i
      3. floored_shares  = floor(raw_shares_i)
      4. residual_cash   = V - Σ(floored_i * price_i)
      5. Greedy cleanup: while residual_cash >= cheapest remaining share,
         buy 1 share of the ticker most-underweight vs target (that won't
         breach max_weight after the purchase).

    Args:
        current_weights: {ticker: fraction}  (sum ≈ 1)
        target_weights:  {ticker: fraction}  (sum ≈ 1)
        prices:          {ticker: last_price}
        notional_value:  total portfolio dollar value (V)
        max_weight:      per-asset upper bound (fraction)

    Returns:
        dict with rows list + residual_cash + total_turnover + metadata
    """
    V = float(notional_value)
    tickers = sorted(set(current_weights) | set(target_weights))

    # Step 1-3: floor to whole shares
    shares: dict[str, int] = {}
    for t in tickers:
        p = prices.get(t)
        if p is None or p <= 0:
            shares[t] = 0
            continue
        raw = (target_weights.get(t, 0.0) * V) / p
        shares[t] = int(math.floor(raw))

    # Step 4: residual cash
    allocated = sum(shares[t] * prices[t] for t in tickers if t in prices and prices[t] > 0)
    residual = V - allocated

    # Step 5: greedy cleanup — allocate leftover cash one share at a time
    eligible = [t for t in tickers if t in prices and prices[t] > 0]
    while residual > 0 and eligible:
        # Find cheapest share we can still afford
        affordable = [t for t in eligible if prices[t] <= residual]
        if not affordable:
            break
        # Of affordable tickers, pick the one most underweight vs target
        def underweight_score(t: str) -> float:
            cur_w = (shares[t] * prices[t]) / V
            tgt_w = target_weights.get(t, 0.0)
            # Would buying one more breach max_weight?
            new_w = ((shares[t] + 1) * prices[t]) / V
            if new_w > max_weight + 1e-6:
                return -999.0  # ineligible
            return tgt_w - cur_w  # most underweight gets priority

        best = max(affordable, key=underweight_score)
        if underweight_score(best) < -100:  # all would breach max_weight
            break
        shares[best] += 1
        residual -= prices[best]

    # Build result rows
    rows = []
    total_drift_abs = 0.0
    for t in sorted(tickers):
        p = prices.get(t, 0.0)
        cur_w = float(current_weights.get(t, 0.0))
        tgt_w = float(target_weights.get(t, 0.0))
        cur_val = cur_w * V
        tgt_val = tgt_w * V
        cur_shares_implied = cur_val / p if p > 0 else 0.0
        tgt_shares = shares.get(t, 0)
        tgt_shares_raw = tgt_val / p if p > 0 else 0.0
        delta_s = tgt_shares - int(round(cur_shares_implied))
        delta_v = delta_s * p
        if delta_s > 0:
            action = "BUY"
        elif delta_s < 0:
            action = "SELL"
        else:
            action = "HOLD"
        total_drift_abs += abs(tgt_w - cur_w)
        rows.append({
            "ticker": t,
            "price": round(p, 4),
            "current_weight": round(cur_w, 4),
            "target_weight": round(tgt_w, 4),
            "current_value": round(cur_val, 2),
            "target_value": round(tgt_val, 2),
            "current_shares_implied": round(cur_shares_implied, 2),
            "target_shares_raw": round(tgt_shares_raw, 2),
            "target_shares": tgt_shares,
            "delta_shares": delta_s,
            "delta_value": round(delta_v, 2),
            "action": action,
        })

    return {
        "rows": rows,
        "residual_cash": round(residual, 2),
        "total_turnover": round(0.5 * total_drift_abs, 4),
        "notional_value": round(V, 2),
    }
