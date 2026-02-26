"""Conviction tilt engine.

Applies a multiplicative conviction overlay to a set of base weights using
a bounded tanh→exp transformation. Stable, smooth, and auditable.

  c_i     = tanh(u_i / u0)          # bounded conviction score ∈ (−1, 1)
  m_i     = exp(λ · c_i)            # multiplicative tilt factor
  w_tilt_i = (w_base_i · m_i) / Σ(w_base_j · m_j)

Parameters:
  conviction[ticker] = u_i in %  (e.g. +20 = "20% undervalued", −10 = "10% overvalued")
  lam (λ)            = aggressiveness — 1.0 = moderate, 3.0 = aggressive
  u0                 = scale at which tanh saturates (~76% conviction at u0)
                       default 20% matches the epic spec
"""
from __future__ import annotations

import math


def compute_tilt(
    base_weights: dict[str, float],
    conviction: dict[str, float],
    lam: float = 1.0,
    u0: float = 20.0,
) -> dict[str, float]:
    """Apply multiplicative conviction tilt to base_weights.

    Args:
        base_weights: {ticker: fraction}  fractions, should sum ≈ 1
        conviction:   {ticker: u_i}       in % (positive = undervalued)
        lam:          aggressiveness λ, e.g. 0.5 = mild, 2.0 = strong
        u0:           tanh scale in same units as conviction (default 20%)

    Returns:
        {ticker: tilted_weight_fraction}  sums to 1
    """
    if not base_weights:
        return {}

    u0 = max(u0, 1e-6)  # guard against division by zero

    tilted: dict[str, float] = {}
    denom = 0.0
    for ticker, w in base_weights.items():
        u = float(conviction.get(ticker, 0.0))
        c = math.tanh(u / u0)
        m = math.exp(lam * c)
        tilted[ticker] = w * m
        denom += w * m

    if denom <= 0:
        return {t: 1.0 / len(base_weights) for t in base_weights}

    return {t: v / denom for t, v in tilted.items()}
