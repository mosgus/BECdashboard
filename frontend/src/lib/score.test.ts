import { describe, it, expect } from 'vitest'
import type { CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import {
  computeScore,
  diversificationSubscore,
  riskConcentrationSubscore,
  volatilitySubscore,
  SCORE_KEYS,
} from './score'

describe('diversificationSubscore', () => {
  it('returns 0 for non-positive values', () => {
    expect(diversificationSubscore(0)).toBe(0)
    expect(diversificationSubscore(-1)).toBe(0)
  })

  it('scales linearly up to DIVERSIFICATION_FULL', () => {
    expect(diversificationSubscore(5)).toBeCloseTo(0.25, 6)
  })

  it('caps at 1', () => {
    expect(diversificationSubscore(20)).toBe(1)
    expect(diversificationSubscore(25)).toBe(1)
  })
})

describe('riskConcentrationSubscore', () => {
  it('returns 1 at or below RISK_SHARE_FULL', () => {
    expect(riskConcentrationSubscore(0.05)).toBe(1)
    expect(riskConcentrationSubscore(0.1)).toBe(1)
  })

  it('returns 0 at or above RISK_SHARE_ZERO', () => {
    expect(riskConcentrationSubscore(0.5)).toBe(0)
    expect(riskConcentrationSubscore(0.6)).toBe(0)
  })

  it('interpolates linearly in between', () => {
    expect(riskConcentrationSubscore(0.3)).toBeCloseTo(0.5, 6)
    expect(riskConcentrationSubscore(0.45)).toBeCloseTo(0.125, 6)
  })
})

describe('volatilitySubscore', () => {
  it('returns 1 at or below VOL_RATIO_FULL', () => {
    expect(volatilitySubscore(0.8)).toBe(1)
    expect(volatilitySubscore(1.0)).toBe(1)
  })

  it('returns 0 at or above VOL_RATIO_ZERO', () => {
    expect(volatilitySubscore(2.0)).toBe(0)
    expect(volatilitySubscore(2.5)).toBe(0)
  })

  it('interpolates linearly in between', () => {
    expect(volatilitySubscore(1.2)).toBeCloseTo(0.8, 6)
    expect(volatilitySubscore(1.5)).toBeCloseTo(0.5, 6)
  })
})

function makeRiskResponse(): RiskResponse {
  return {
    tickers: ['A', 'B', 'C'],
    holdings: [
      { ticker: 'A', weight: 0.3, invested_weight: 0.3, vol: 0.2, beta: 1.1, risk_share: 0.3 },
      { ticker: 'B', weight: 0.25, invested_weight: 0.25, vol: 0.15, beta: 0.9, risk_share: 0.25 },
      { ticker: 'C', weight: 0.45, invested_weight: 0.45, vol: 0.25, beta: 1.2, risk_share: 0.45 },
    ],
    market_ticker: 'SPY',
    lookback_days: 365,
    start: '2025-11-07',
    end: '2026-11-06',
    n_returns: 252,
    cash_weight: 0,
    portfolio_vol: 0.2,
    portfolio_beta: 1.05,
    hhi: 0.3,
    effective_holdings: 5,
    top5_weight: 1,
    warnings: [],
  }
}

function makePerformanceResponse(): PerformanceResponse {
  return {
    market_ticker: 'SPY',
    start: '2025-11-08',
    end: '2026-11-06',
    n_days: 252,
    cash_weight: 0,
    coverage: 1,
    rf: 0.04,
    rf_source: 'live',
    metrics: { cagr: 0.12, vol: 0.18, sharpe: 0.5, max_dd: 0.15 },
    bench_metrics: { cagr: 0.1, vol: 0.15, sharpe: 0.4, max_dd: 0.18 },
    path: [],
    warnings: [],
  }
}

function makeCompareResponse(): CompareResponse {
  return {
    tickers: ['A', 'B', 'C'],
    current_weights: { A: 0.3, B: 0.25, C: 0.45 },
    pinned: [],
    lookback_days: 365,
    rebalance: 'none',
    rf: 0.04,
    rf_source: 'live',
    fit_start: '2025-11-07',
    fit_end: '2026-11-06',
    score_start: '2023-01-01',
    current: {
      in_sample: { cagr: 0.12, vol: 0.18, sharpe: 0.5, max_dd: 0.15 },
      holdout: { cagr: 0.11, vol: 0.17, sharpe: 0.48, max_dd: 0.16 },
      point: { vol: 0.18, ret: 0.12 },
    },
    modes: [
      {
        mode: 'equal_weight',
        error: null,
        feasible: true,
        target_weights: { A: 0.333, B: 0.333, C: 0.333 },
        traded: 0.5,
        in_sample: { cagr: 0.1, vol: 0.16, sharpe: 0.4, max_dd: 0.18 },
        point: { vol: 0.16, ret: 0.1 },
        holdout_weights: { A: 0.333, B: 0.333, C: 0.333 },
        holdout: { cagr: 0.09, vol: 0.15, sharpe: 0.3, max_dd: 0.2 },
        holdout_error: null,
      },
    ],
    folds: [
      {
        fold: 1,
        cut: '2026-01-01',
        score_end: '2026-01-01',
        fit_start: '2025-01-01',
        fit_end: '2026-01-01',
        score_start: '2025-01-01',
        tickers: ['A', 'B', 'C'],
        excluded: [],
        vol_target: null,
        unavailable: null,
        current: { cagr: 0.5, vol: 0.18, sharpe: 0.5, max_dd: 0.15 },
        modes: [
          {
            mode: 'equal_weight',
            holdout: { cagr: 0.05, vol: 0.15, sharpe: 0.4, max_dd: 0.2 },
            error: null,
          },
        ],
      },
      {
        fold: 2,
        cut: '2025-01-01',
        score_end: '2025-01-01',
        fit_start: '2024-01-01',
        fit_end: '2025-01-01',
        score_start: '2024-01-01',
        tickers: ['A', 'B', 'C'],
        excluded: [],
        vol_target: null,
        unavailable: null,
        current: { cagr: 0.1, vol: 0.17, sharpe: 0.1, max_dd: 0.16 },
        modes: [
          {
            mode: 'equal_weight',
            holdout: { cagr: 0.02, vol: 0.16, sharpe: 0.3, max_dd: 0.18 },
            error: null,
          },
        ],
      },
      {
        fold: 3,
        cut: '2024-01-01',
        score_end: '2024-01-01',
        fit_start: '2023-01-01',
        fit_end: '2024-01-01',
        score_start: '2023-01-01',
        tickers: ['A', 'B', 'C'],
        excluded: [],
        vol_target: null,
        unavailable: null,
        current: { cagr: 0.8, vol: 0.19, sharpe: 0.8, max_dd: 0.14 },
        modes: [
          {
            mode: 'equal_weight',
            holdout: { cagr: 0.03, vol: 0.14, sharpe: 0.2, max_dd: 0.22 },
            error: null,
          },
        ],
      },
      {
        fold: 4,
        cut: '2023-01-01',
        score_end: '2023-01-01',
        fit_start: null,
        fit_end: null,
        score_start: null,
        tickers: [],
        excluded: [],
        vol_target: null,
        unavailable: 'Too little history',
        current: null,
        modes: [
          {
            mode: 'equal_weight',
            holdout: null,
            error: null,
          },
        ],
      },
    ],
    vol_target: 0.15,
    holdout: null,
    holdout_unavailable: null,
    frontier: null,
    correlation: null,
    warnings: [],
  }
}

describe('computeScore - full fixture', () => {
  it('computes correct score for full fixture', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.total).toBeCloseTo(41.208333, 6)
    expect(score.missing).toEqual([])
    expect(score.components.map((c) => c.key)).toEqual(SCORE_KEYS)

    // Diversification: 5 / 20 * 35 = 8.75
    expect(score.components[0].subscore).toBeCloseTo(0.25, 6)
    expect(score.components[0].points).toBeCloseTo(8.75, 6)

    // Risk concentration: C carries 45% → (0.5 - 0.45) / (0.5 - 0.1) = 0.125 → 0.125 * 25 = 3.125
    expect(score.components[1].subscore).toBeCloseTo(0.125, 6)
    expect(score.components[1].points).toBeCloseTo(3.125, 6)
    expect(score.components[1].measured).toBe('C drives 45.0% of portfolio volatility')

    // Volatility: 0.18 / 0.15 = 1.2 → (2.0 - 1.2) / (2.0 - 1.0) = 0.8 → 0.8 * 20 = 16
    expect(score.components[2].subscore).toBeCloseTo(0.8, 6)
    expect(score.components[2].points).toBeCloseTo(16, 6)
    expect(score.components[2].measured).toBe('18.0% vs 15.0% for SPY (1.20×)')

    // Robustness: 2 of 3 folds beat equal_weight → 2/3 → 2/3 * 20 = 13.333333
    expect(score.components[3].subscore).toBeCloseTo(2 / 3, 6)
    expect(score.components[3].points).toBeCloseTo(13.333333, 6)
    expect(score.components[3].measured).toBe('Beat equal weight in 2 of 3 years')
    expect(score.components[3].window).toBe('2023-01-01 → 2026-01-01')
  })

  it('handles singular year in robustness when only one fold available', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    const compare = makeCompareResponse()

    compare.folds = [
      compare.folds[0]!,
      {
        ...compare.folds[1]!,
        unavailable: 'Too little history',
        current: null,
        score_start: null,
      },
      {
        ...compare.folds[2]!,
        unavailable: 'Too little history',
        current: null,
        score_start: null,
      },
      compare.folds[3]!,
    ]
    compare.modes[0]!.holdout = null

    const score = computeScore(risk, performance, compare)

    expect(score.components[3].measured).toBe('Beat equal weight in 1 of 1 year')
    expect(score.components[3].points).toBeCloseTo(20, 6)
  })
})

describe('computeScore - null inputs', () => {
  it('returns null total with all inputs null', () => {
    const score = computeScore(null, null, null)

    expect(score.total).toBeNull()
    expect(score.components).toHaveLength(4)
    expect(score.components.every((c) => c.points === null)).toBe(true)
    expect(score.missing).toEqual([
      'Diversification',
      'Risk concentration',
      'Volatility vs market',
      'Holdout robustness',
    ])
  })

  it('computes partial score when compare is null', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()

    const score = computeScore(risk, performance, null)

    expect(score.total).toBeNull()
    expect(score.missing).toEqual(['Holdout robustness'])
    expect(score.components[0].points).toBeCloseTo(8.75, 6)
    expect(score.components[1].points).toBeCloseTo(3.125, 6)
    expect(score.components[2].points).toBeCloseTo(16, 6)
    expect(score.components[3].points).toBeNull()
  })

  it('marks volatility missing when bench_metrics is null', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    performance.bench_metrics = null
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Volatility vs market')
  })

  it('marks volatility missing when bench_metrics.vol is 0', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    performance.bench_metrics!.vol = 0
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Volatility vs market')
  })

  it('marks risk concentration missing when all risk_share are null', () => {
    const risk = makeRiskResponse()
    risk.holdings.forEach((h) => {
      h.risk_share = null
    })
    const performance = makePerformanceResponse()
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Risk concentration')
    expect(score.components[0].points).toBeCloseTo(8.75, 6)
  })

  it('marks robustness missing when all folds are unavailable', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    const compare = makeCompareResponse()

    compare.folds = compare.folds.map((f) => ({
      ...f,
      unavailable: 'unavailable',
      current: null,
    }))
    compare.modes[0].holdout = null

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Holdout robustness')
  })
})

describe('computeScore - edge cases', () => {
  it('handles performance.metrics.vol being undefined', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    ;(performance.metrics as any).vol = undefined
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Volatility vs market')
  })

  it('handles bench_metrics.vol being undefined', () => {
    const risk = makeRiskResponse()
    const performance = makePerformanceResponse()
    ;(performance.bench_metrics! as any).vol = undefined
    const compare = makeCompareResponse()

    const score = computeScore(risk, performance, compare)

    expect(score.missing).toContain('Volatility vs market')
  })
})
