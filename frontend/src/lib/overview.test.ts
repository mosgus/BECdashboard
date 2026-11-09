import { describe, expect, it } from 'vitest'
import type { PerformanceResponse, RiskResponse } from '../api/client'
import { overviewTiles, scoreTone } from './overview'

const performanceFixture = {
  metrics: { cagr: 0.1, vol: 0.2183, sharpe: -0.523, max_dd: -0.2152, beta: 1.234, alpha: 0.01 },
  start: '2025-11-10',
  end: '2026-11-06',
  market_ticker: 'SPY',
} as unknown as PerformanceResponse

const riskFixture = {
  effective_holdings: 7.04,
  hhi: 0.142,
  holdings: [
    { ticker: 'TSLA', invested_weight: 0.21 },
    { ticker: 'AAPL', invested_weight: 0.18 },
  ],
} as unknown as RiskResponse

describe('scoreTone', () => {
  it.each([
    [1, 'positive'],
    [0.7, 'positive'],
    [0.69, 'accent'],
    [0.45, 'accent'],
    [0.44, 'negative'],
    [0, 'negative'],
  ] as const)('maps %s to %s', (fraction, tone) => {
    expect(scoreTone(fraction)).toBe(tone)
  })
})

describe('overviewTiles', () => {
  it('formats performance and risk metrics in the specified order', () => {
    const tiles = overviewTiles(riskFixture, performanceFixture)
    expect(tiles.map((tile) => tile.value)).toEqual(['-0.52', '21.83%', '-21.52%', '7.0', '1.23', 'TSLA 21.0%'])
    expect(tiles.map((tile) => tile.sub)).toEqual([
      '2025-11-10 → 2026-11-06',
      'Annualised',
      'Peak to trough',
      'HHI 0.142',
      'vs SPY',
      'Of the invested money',
    ])
  })

  it('returns six unavailable tiles when both sources are missing', () => {
    const tiles = overviewTiles(null, null)
    expect(tiles).toHaveLength(6)
    expect(tiles.map((tile) => tile.label)).toEqual([
      'Sharpe',
      'Volatility',
      'Max drawdown',
      'Effective holdings',
      'Beta',
      'Largest holding',
    ])
    expect(tiles.every((tile) => tile.value === '—' && tile.sub === 'Unavailable')).toBe(true)
  })

  it('marks an undefined beta unavailable without changing other performance tiles', () => {
    const { beta: _beta, ...metrics } = performanceFixture.metrics
    const tiles = overviewTiles(null, { ...performanceFixture, metrics })
    expect(tiles[4]).toMatchObject({ value: '—', sub: 'Unavailable' })
    expect(tiles.slice(0, 3).map((tile) => tile.value)).toEqual(['-0.52', '21.83%', '-21.52%'])
  })
})
