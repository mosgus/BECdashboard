import { describe, expect, it } from 'vitest'
import type { CompareMetrics, CompareMode, CompareResponse, Correlation } from '../api/client'
import { buildOptimizeRequest, DEFAULT_SETTINGS, modeLabel } from './optimize'
import type { TradeBasis } from './optimize'
import type { Portfolio } from './portfolio'
import {
  bestHoldout,
  buildCompareRequest,
  compareFrontierData,
  compareRows,
  correlationCellBackground,
  correlationNote,
  sortCompareRows,
  tradeCost,
} from './research'
import type { CompareRow } from './research'

const WEIGHTS_BASIS: TradeBasis = { kind: 'weights', reason: 'no-shares' }

function metrics(sharpe: number | null, vol: number | null = 0.1): CompareMetrics {
  return { cagr: 0.05, vol, sharpe, max_dd: -0.1 }
}

function row(key: string, holdout: CompareMetrics | null, error: string | null = null, isCurrent = false): CompareRow {
  return {
    key,
    label: key,
    isCurrent,
    error,
    feasible: null,
    traded: isCurrent ? 0 : 0.2,
    inSample: null,
    holdout,
    holdoutError: null,
  }
}

function mode(name: string, holdout: CompareMetrics | null): CompareMode {
  return {
    mode: name,
    error: null,
    feasible: true,
    target_weights: { A: 0.5, B: 0.5 },
    traded: 0.2,
    in_sample: metrics(1),
    point: { vol: 0.1, ret: 0.05 },
    holdout_weights: { A: 0.5, B: 0.5 },
    holdout,
    holdout_error: null,
  }
}

function response(modes: CompareMode[]): CompareResponse {
  return {
    tickers: ['A', 'B'],
    current_weights: { A: 0.5, B: 0.5 },
    pinned: [],
    lookback_days: 365,
    rebalance: 'none',
    rf: 0.04,
    rf_source: 'fallback',
    fit_start: '2023-01-01',
    fit_end: '2024-01-01',
    score_start: '2024-01-01',
    current: { in_sample: metrics(1), holdout: metrics(2), point: null },
    modes,
    holdout: null,
    holdout_unavailable: null,
    frontier: null,
    correlation: null,
    warnings: [],
  }
}

describe('tradeCost', () => {
  it('scales the percentage by the invested share and has no dollars without a dollar basis', () => {
    const cost = tradeCost(0.5, 10, 40, WEIGHTS_BASIS)
    expect(cost.pct).toBeCloseTo(0.03, 10)
    expect(cost.dollars).toBeNull()
  })

  it('gives dollars on a dollar basis', () => {
    const cost = tradeCost(0.5, 10, 40, { kind: 'dollar', investedValue: 60000, prices: {}, shares: {} })
    expect(cost.dollars).toBeCloseTo(30, 10)
  })

  it('costs nothing when nothing is traded', () => {
    expect(tradeCost(0, 25, 0, WEIGHTS_BASIS).pct).toBe(0)
  })
})

describe('sortCompareRows', () => {
  const rows = [
    row('current', metrics(2), null, true),
    row('m1', metrics(0.5)),
    row('m2', metrics(null)),
    row('m3', metrics(1.2)),
    row('m4', null, 'boom'),
  ]

  it('sorts descending with nulls after values, current first and errors last', () => {
    expect(sortCompareRows(rows, 'holdout.sharpe', false).map((r) => r.key)).toEqual([
      'current',
      'm3',
      'm1',
      'm2',
      'm4',
    ])
  })

  it('sorts ascending with the same placement rules', () => {
    expect(sortCompareRows(rows, 'holdout.sharpe', true).map((r) => r.key)).toEqual(['current', 'm1', 'm3', 'm2', 'm4'])
  })
})

describe('bestHoldout', () => {
  it('ignores the current row and error rows', () => {
    const best = bestHoldout([
      row('current', metrics(9), null, true),
      row('m1', metrics(0.5)),
      row('m2', metrics(1.2)),
      row('m3', metrics(50), 'boom'),
    ])
    expect(best.sharpe).toBe(1.2)
  })

  it('returns the tied minimum for volatility', () => {
    const best = bestHoldout([row('m1', metrics(1, 0.08)), row('m2', metrics(1, 0.08)), row('m3', metrics(1, 0.12))])
    expect(best.vol).toBe(0.08)
  })

  it('is all null when no mode has a holdout', () => {
    const best = bestHoldout(compareRows(response([mode('m1', null), mode('m2', null)])))
    expect(best).toEqual({ cagr: null, vol: null, sharpe: null, max_dd: null })
  })
})

describe('compareRows', () => {
  it('puts the current row first with zero traded and keeps mode order', () => {
    const rows = compareRows(response([mode('min_variance', null), mode('equal_weight', null)]))
    expect(rows.map((r) => r.key)).toEqual(['current', 'min_variance', 'equal_weight'])
    expect(rows[0].traded).toBe(0)
    expect(rows[0].isCurrent).toBe(true)
  })
})

describe('buildCompareRequest', () => {
  it('reuses the optimize request weights on a dollar basis', () => {
    const portfolio: Portfolio = {
      id: 'p',
      name: 'P',
      cashWeight: 0,
      positions: [
        { ticker: 'A', weight: 25, shares: 10 },
        { ticker: 'B', weight: 75, shares: 30 },
      ],
      updatedAt: '2026-01-01',
    }
    const basis: TradeBasis = { kind: 'dollar', investedValue: 400, prices: { A: 10, B: 10 }, shares: { A: 10, B: 30 } }
    const settings = { lookbackDays: 730, maxWeightPct: 40, volTargetPct: 12 }
    const compare = buildCompareRequest(portfolio, settings, basis)
    const optimize = buildOptimizeRequest(portfolio, { ...DEFAULT_SETTINGS, lookbackDays: 730 }, basis)
    expect(compare.weights).toEqual(optimize.weights)
    expect(compare.tickers).toEqual(optimize.tickers)
    expect(compare.min_weight).toBe(0)
    expect(compare.rebalance).toBe('none')
    expect(compare.max_weight).toBe(0.4)
    expect(compare.vol_target).toBe(0.12)
    expect(compare.lookback_days).toBe(730)
  })
})

describe('compareFrontierData', () => {
  it('scales to percent, skips modes without a point, and labels current and modes', () => {
    const base = response([
      { ...mode('equal_weight', null), point: { vol: 0.15, ret: 0.06 } },
      { ...mode('min_variance', null), point: null },
    ])
    const data = compareFrontierData({
      ...base,
      current: { ...base.current, point: { vol: 0.2, ret: 0.08 } },
      frontier: { points: [{ vol: 0.1, ret: 0.05 }], cloud: [], tickers: ['A', 'B'], excluded: [] },
    })
    expect(data).not.toBeNull()
    expect(data!.curve).toHaveLength(1)
    expect(data!.curve[0].vol).toBeCloseTo(10, 10)
    expect(data!.curve[0].ret).toBeCloseTo(5, 10)
    expect(data!.current?.label).toBe('Current')
    expect(data!.current?.vol).toBeCloseTo(20, 10)
    expect(data!.modes).toHaveLength(1)
    expect(data!.modes[0].label).toBe('Equal')
    expect(data!.modes[0].name).toBe(modeLabel('equal_weight'))
  })

  it('is null when the frontier is null', () => {
    expect(compareFrontierData(response([]))).toBeNull()
  })
})

describe('correlationCellBackground', () => {
  it('uses primary for positive, accent for negative, capped at 60%', () => {
    expect(correlationCellBackground(1)).toContain('var(--color-primary) 60%')
    expect(correlationCellBackground(-0.5)).toContain('var(--color-accent) 30%')
    expect(correlationCellBackground(0)).toContain(' 0%')
  })
})

describe('correlationNote', () => {
  const base: Correlation = {
    tickers: ['A', 'B'],
    matrix: [
      [1, 0.5],
      [0.5, 1],
    ],
    start: '2024-01-01',
    end: '2025-01-01',
    n_returns: 250,
    limited_by: null,
    excluded: [],
  }

  it('mentions the limiting ticker and the left-out tickers when present', () => {
    const note = correlationNote({ ...base, limited_by: 'F', excluded: ['Y'] })
    expect(note).toContain('Starts when F first has prices.')
    expect(note).toContain('Left out (no price movement): Y.')
  })

  it('mentions neither when absent', () => {
    const note = correlationNote(base)
    expect(note).not.toContain('Starts when')
    expect(note).not.toContain('Left out')
  })
})
