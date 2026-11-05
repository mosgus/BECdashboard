import { describe, expect, it } from 'vitest'
import type { CompareFold, CompareMetrics, CompareMode, CompareResponse, Correlation } from '../api/client'
import { buildOptimizeRequest, DEFAULT_SETTINGS, modeLabel } from './optimize'
import type { TradeBasis } from './optimize'
import type { Portfolio } from './portfolio'
import {
  beatsMostYears,
  buildCompareRequest,
  compareFrontierData,
  compareRows,
  correlationCellBackground,
  DEFAULT_COMPARE_SETTINGS,
  correlationNote,
  sortCompareRows,
  tradeCost,
  usableFolds,
  walkForward,
} from './research'
import type { CompareRow, WalkForwardSummary } from './research'

const WEIGHTS_BASIS: TradeBasis = { kind: 'weights', reason: 'no-shares' }

function metrics(sharpe: number | null, vol: number | null = 0.1): CompareMetrics {
  return { cagr: 0.05, vol, sharpe, max_dd: -0.1 }
}

function summary(mean: number | null): WalkForwardSummary {
  return { byFold: [mean], mean, worst: mean, beatEqual: null, beatCurrent: null }
}

function row(key: string, mean: number | null, error: string | null = null, isCurrent = false): CompareRow {
  return {
    key,
    label: key,
    isCurrent,
    error,
    feasible: null,
    traded: isCurrent ? 0 : 0.2,
    inSample: null,
    walkForward: summary(mean),
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
    folds: [],
    vol_target: 0.1,
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
  const rows = [row('current', 2, null, true), row('m1', 0.5), row('m2', null), row('m3', 1.2), row('m4', null, 'boom')]

  it('sorts descending with nulls after values, current first and errors last', () => {
    expect(sortCompareRows(rows, 'wf.mean', false).map((r) => r.key)).toEqual(['current', 'm3', 'm1', 'm2', 'm4'])
  })

  it('sorts ascending with the same placement rules', () => {
    expect(sortCompareRows(rows, 'wf.mean', true).map((r) => r.key)).toEqual(['current', 'm1', 'm3', 'm2', 'm4'])
  })
})

function fold(
  k: number,
  unavailable: string | null,
  sharpes: Record<string, number | null>,
  errors: Record<string, string> = {},
): CompareFold {
  const modes = Object.keys(sharpes)
    .filter((key) => key !== 'current')
    .map((key) => ({
      mode: key,
      holdout: sharpes[key] === null || key in errors ? null : metrics(sharpes[key]),
      error: errors[key] ?? null,
    }))
  return {
    fold: k,
    cut: '2023-01-01',
    score_end: '2024-01-01',
    fit_start: unavailable === null ? '2022-01-01' : null,
    fit_end: unavailable === null ? '2023-01-01' : null,
    score_start: unavailable === null ? '2023-01-01' : null,
    tickers: ['A', 'B'],
    excluded: [],
    vol_target: unavailable === null ? 0.1 : null,
    unavailable,
    current: unavailable === null && sharpes.current !== null ? metrics(sharpes.current) : null,
    modes: unavailable === null ? modes : [],
  }
}

function walkFixture(): CompareResponse {
  const base = response([mode('equal_weight', null), mode('m1', null), mode('m2', null), mode('dead', null)])
  return {
    ...base,
    folds: [
      fold(1, null, { current: 0.4, equal_weight: 0.6, m1: 0.5, m2: 0.7, dead: null }),
      fold(2, null, { current: 1.2, equal_weight: 0.9, m1: 1.0, m2: 1.0, dead: null }, { m2: 'boom' }),
      fold(3, 'no history', {}),
    ],
  }
}

describe('walkForward', () => {
  const summaries = walkForward(walkFixture())

  it('summarises a mode across folds, with unavailable folds null', () => {
    expect(summaries.m1.byFold).toEqual([0.5, 1.0, null])
    expect(summaries.m1.mean).toBeCloseTo(0.75, 10)
    expect(summaries.m1.worst).toBe(0.5)
  })

  it('has no beatEqual on equal_weight and counts wins elsewhere', () => {
    expect(summaries.equal_weight.beatEqual).toBeNull()
    expect(summaries.m1.beatEqual).toEqual({ wins: 1, of: 2 })
  })

  it('has no beatCurrent on current and counts wins elsewhere', () => {
    expect(summaries.current.beatCurrent).toBeNull()
    expect(summaries.m1.beatCurrent).toEqual({ wins: 1, of: 2 })
  })

  it('treats an errored fold-mode as null', () => {
    expect(summaries.m2.byFold).toEqual([0.7, null, null])
    expect(summaries.m2.beatEqual).toEqual({ wins: 1, of: 1 })
  })

  it('is null throughout for a mode that never ran', () => {
    expect(summaries.dead.mean).toBeNull()
    expect(summaries.dead.worst).toBeNull()
  })
})

describe('beatsMostYears', () => {
  it('needs at least two years and a strict majority', () => {
    expect(beatsMostYears({ wins: 2, of: 4 })).toBe(false)
    expect(beatsMostYears({ wins: 3, of: 4 })).toBe(true)
    expect(beatsMostYears({ wins: 1, of: 1 })).toBe(false)
    expect(beatsMostYears(null)).toBe(false)
  })
})

describe('usableFolds', () => {
  it('counts folds that are not unavailable', () => {
    expect(usableFolds(walkFixture())).toBe(2)
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
    expect(buildCompareRequest(portfolio, { ...settings, volTargetPct: null }, basis).vol_target).toBeNull()
  })

  it('matches current by default', () => {
    expect(DEFAULT_COMPARE_SETTINGS.volTargetPct).toBeNull()
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
