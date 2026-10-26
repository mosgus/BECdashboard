import { describe, expect, it } from 'vitest'
import type { CompareResponse, RiskResponse } from '../api/client'
import { buildEvidence, deriveRedFlags, holdingsChanged } from './memo'
import type { DecisionMemo, MemoEvidence } from './memo'
import type { Portfolio } from './portfolio'

const WINDOW = { start: '2025-10-01', end: '2026-10-01' }

function evidence(overrides: Partial<MemoEvidence> = {}): MemoEvidence {
  return {
    effectiveHoldings: null,
    holdingsCount: null,
    largest: null,
    topRiskShare: null,
    riskWindow: null,
    holdoutSharpe: null,
    equalWeightHoldoutSharpe: null,
    holdoutWindow: null,
    maxDrawdown: null,
    drawdownWindow: null,
    untested: [],
    ...overrides,
  }
}

describe('deriveRedFlags', () => {
  it('returns [] for null evidence', () => {
    expect(deriveRedFlags(null)).toEqual([])
  })

  it('derives every flag in order with the right severity and detail', () => {
    const flags = deriveRedFlags(
      evidence({
        effectiveHoldings: 2.5,
        holdingsCount: 4,
        largest: { ticker: 'MS', investedWeight: 0.36 },
        topRiskShare: { ticker: 'MS', share: 0.5 },
        riskWindow: WINDOW,
        holdoutSharpe: -0.1,
        equalWeightHoldoutSharpe: 0.38,
        holdoutWindow: WINDOW,
        maxDrawdown: -0.25,
        drawdownWindow: WINDOW,
        untested: ['SETM'],
      }),
    )
    expect(flags.map((flag) => flag.id)).toEqual([
      'concentration',
      'largest-holding',
      'risk-share',
      'holdout-negative',
      'behind-equal-weight',
      'drawdown',
      'short-history',
    ])
    expect(flags[0].severity).toBe('high')
    expect(flags[1].severity).toBe('medium')
    expect(flags[1].detail).toBe('MS is 36.0% of the invested money.')
  })

  it('treats every threshold as strict', () => {
    expect(
      deriveRedFlags(
        evidence({
          effectiveHoldings: 5,
          holdingsCount: 6,
          largest: { ticker: 'A', investedWeight: 0.25 },
          topRiskShare: { ticker: 'A', share: 0.4 },
          holdoutSharpe: 0.38,
          equalWeightHoldoutSharpe: 0.38,
          maxDrawdown: -0.2,
          untested: [],
        }),
      ),
    ).toEqual([])
  })

  it('raises nothing when every numeric field is null', () => {
    expect(deriveRedFlags(evidence())).toEqual([])
  })
})

const RISK: RiskResponse = {
  tickers: ['A', 'B'],
  holdings: [
    { ticker: 'A', weight: 30, invested_weight: 0.3, vol: 0.2, beta: 1, risk_share: 0.2 },
    { ticker: 'B', weight: 70, invested_weight: 0.7, vol: 0.3, beta: 1.1, risk_share: null },
  ],
  market_ticker: 'SPY',
  lookback_days: 365,
  start: '2025-10-01',
  end: '2026-10-01',
  n_returns: 250,
  cash_weight: 0,
  portfolio_vol: 0.2,
  portfolio_beta: 1,
  hhi: 0.58,
  effective_holdings: 1.7,
  top5_weight: 1,
  warnings: [],
}

function compare(pinned: string[], excluded: string[]): CompareResponse {
  return {
    pinned,
    holdout: {
      fit_start: '2024-10-01',
      fit_end: '2025-10-01',
      score_start: '2025-10-01',
      score_end: '2026-10-01',
      tickers: [],
      excluded,
    },
    modes: [],
    current: { in_sample: { cagr: 0, vol: 0, sharpe: 0, max_dd: -0.1 }, holdout: null, point: null },
    fit_start: '2024-10-01',
    fit_end: '2026-10-01',
  } as unknown as CompareResponse
}

describe('buildEvidence', () => {
  it('is null when both responses are null', () => {
    expect(buildEvidence(null, null)).toBeNull()
  })

  it('draws from risk alone when compare is null', () => {
    const result = buildEvidence(RISK, null)
    expect(result?.holdoutSharpe).toBeNull()
    expect(result?.untested).toEqual([])
    expect(result?.largest?.ticker).toBe('B')
    expect(result?.topRiskShare).toEqual({ ticker: 'A', share: 0.2 })
  })

  it('unions, de-duplicates and sorts pinned and excluded tickers', () => {
    expect(buildEvidence(null, compare(['B', 'A'], ['A', 'C']))?.untested).toEqual(['A', 'B', 'C'])
  })
})

function memo(overrides: Partial<DecisionMemo>): DecisionMemo {
  return {
    id: 'm',
    portfolioId: 'p',
    createdAt: '2026-10-01T00:00:00Z',
    recommendation: 'GO',
    rationale: 'r',
    monitoringPlan: '',
    redFlags: [],
    holdings: [],
    cashWeight: 0,
    evidence: null,
    ...overrides,
  }
}

function portfolio(overrides: Partial<Portfolio>): Portfolio {
  return { id: 'p', name: 'P', cashWeight: 0, positions: [], updatedAt: '2026-10-01T00:00:00Z', ...overrides }
}

describe('holdingsChanged', () => {
  const sharesMemo = memo({
    holdings: [
      { ticker: 'A', weight: 60, shares: 10 },
      { ticker: 'B', weight: 40, shares: 5 },
    ],
    cashWeight: 0,
    cashDollars: 100,
  })

  it('ignores price drift for shares-based portfolios', () => {
    const now = portfolio({
      positions: [
        { ticker: 'A', weight: 50, shares: 10 },
        { ticker: 'B', weight: 50, shares: 5 },
      ],
      cashDollars: 100,
    })
    expect(holdingsChanged(sharesMemo, now)).toBe(false)
  })

  it('detects a one-share change', () => {
    const now = portfolio({
      positions: [
        { ticker: 'A', weight: 60, shares: 11 },
        { ticker: 'B', weight: 40, shares: 5 },
      ],
      cashDollars: 100,
    })
    expect(holdingsChanged(sharesMemo, now)).toBe(true)
  })

  it('uses a 0.5 point tolerance for weights-only portfolios', () => {
    const weightsMemo = memo({
      holdings: [
        { ticker: 'A', weight: 60 },
        { ticker: 'B', weight: 40 },
      ],
    })
    const within = portfolio({
      positions: [
        { ticker: 'A', weight: 60.4 },
        { ticker: 'B', weight: 40 },
      ],
    })
    const beyond = portfolio({
      positions: [
        { ticker: 'A', weight: 60.6 },
        { ticker: 'B', weight: 40 },
      ],
    })
    expect(holdingsChanged(weightsMemo, within)).toBe(false)
    expect(holdingsChanged(weightsMemo, beyond)).toBe(true)
  })

  it('detects an added ticker', () => {
    const weightsMemo = memo({ holdings: [{ ticker: 'A', weight: 100 }] })
    const now = portfolio({
      positions: [
        { ticker: 'A', weight: 100 },
        { ticker: 'B', weight: 0 },
      ],
    })
    expect(holdingsChanged(weightsMemo, now)).toBe(true)
  })
})
