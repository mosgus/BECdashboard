import { describe, expect, it } from 'vitest'
import type { RiskResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import { tradeBasis } from './optimize'
import {
  DEFAULT_RISK_SETTINGS,
  buildRiskRequest,
  formatSigned,
  parseShock,
  riskRows,
  riskSummary,
  riskTiles,
  sameRiskRequest,
  shockImpact,
} from './risk'

const R: RiskResponse = {
  tickers: ['A', 'B', 'C'],
  market_ticker: 'SPY',
  lookback_days: 365,
  start: '2025-10-06',
  end: '2026-10-02',
  n_returns: 250,
  cash_weight: 0.2,
  portfolio_vol: 0.1834,
  portfolio_beta: 0.81,
  hhi: 0.40625,
  effective_holdings: 2.4615,
  top5_weight: 1,
  warnings: [],
  holdings: [
    { ticker: 'A', weight: 0.4, invested_weight: 0.5, vol: 0.3, beta: 1.5, risk_share: 0.62 },
    { ticker: 'B', weight: 0.3, invested_weight: 0.375, vol: 0.2, beta: 0.7, risk_share: 0.3 },
    { ticker: 'C', weight: 0.1, invested_weight: 0.125, vol: 0.25, beta: 0, risk_share: 0.08 },
  ],
}
const portfolio: Portfolio = {
  id: 'p',
  name: 'P',
  cashWeight: 20,
  updatedAt: '2026-10-01T00:00:00.000Z',
  positions: [
    { ticker: 'A', weight: 40 },
    { ticker: 'B', weight: 30 },
    { ticker: 'C', weight: 10 },
  ],
}

describe('risk helpers', () => {
  it('builds the four risk tiles', () => {
    expect(riskTiles(R).map((tile) => tile.label)).toEqual([
      'Volatility',
      'Beta vs SPY',
      'Effective holdings',
      'Top 5 weight',
    ])
    expect(riskTiles(R).map((tile) => tile.value)).toEqual(['18.34%', '0.81', '2.5 of 3', '100.0%'])
  })
  it('maps and orders rows by risk contribution', () => {
    expect(riskRows(R).map((row) => row.ticker)).toEqual(['A', 'B', 'C'])
    expect(riskRows(R)[0].ratio).toBeCloseTo(1.55)
    expect(
      riskRows({ ...R, holdings: [...R.holdings.slice(0, 2), { ...R.holdings[2], risk_share: null }] }).at(-1),
    ).toMatchObject({ ticker: 'C', ratio: null })
  })
  it('parses valid market moves', () => {
    for (const [text, value] of [
      ['-20', -20],
      [' -20% ', -20],
      ['15', 15],
      ['50', 50],
    ] as const)
      expect(parseShock(text)).toEqual({ ok: true, value })
  })
  it('rejects invalid market moves', () => {
    for (const text of ['-51', 'abc', ''])
      expect(parseShock(text)).toEqual({ ok: false, message: 'Market move must be a number from -50% to +50%.' })
  })
  it('calculates beta market impacts', () => {
    const impact = shockImpact(R, -20)
    expect(impact.portfolio).toBeCloseTo(-16.2)
    expect(impact.byTicker.A).toBeCloseTo(-12)
    expect(impact.byTicker.B).toBeCloseTo(-4.2)
    expect(impact.byTicker.C).toBeCloseTo(0)
  })
  it('formats signed percentages', () => {
    expect([formatSigned(-16.2), formatSigned(3.14), formatSigned(0), formatSigned(-0.01)]).toEqual([
      '-16.2%',
      '+3.1%',
      '0.0%',
      '0.0%',
    ])
  })
  it('builds requests for weights and dollars', () => {
    const weights = buildRiskRequest(
      portfolio,
      { ...DEFAULT_RISK_SETTINGS, marketTicker: ' SPY ' },
      tradeBasis(portfolio, new Map()),
    )
    if (!weights.ok) throw new Error('expected request')
    expect(weights.request).toMatchObject({ weights: [40, 30, 10], cash: 20, market_ticker: 'SPY' })
    const dollarPortfolio = {
      ...portfolio,
      positions: [
        { ticker: 'A', weight: 40, shares: 10 },
        { ticker: 'B', weight: 40, shares: 20 },
      ],
    }
    const dollars = buildRiskRequest(
      dollarPortfolio,
      DEFAULT_RISK_SETTINGS,
      tradeBasis(
        dollarPortfolio,
        new Map([
          ['A', 100],
          ['B', 50],
        ]),
      ),
    )
    if (!dollars.ok) throw new Error('expected request')
    expect(dollars.request.weights).toEqual([1000, 1000])
    expect(
      buildRiskRequest({ ...portfolio, positions: [] }, DEFAULT_RISK_SETTINGS, tradeBasis(portfolio, new Map())),
    ).toEqual({ ok: false, message: 'Add at least one holding to measure risk.' })
    expect(
      buildRiskRequest(portfolio, { ...DEFAULT_RISK_SETTINGS, marketTicker: ' ' }, tradeBasis(portfolio, new Map())),
    ).toEqual({ ok: false, message: 'Choose a market ticker.' })
  })
  it('compares requests and summarizes the response', () => {
    const built = buildRiskRequest(portfolio, DEFAULT_RISK_SETTINGS, tradeBasis(portfolio, new Map()))
    if (!built.ok) throw new Error('expected request')
    expect(sameRiskRequest(built.request, structuredClone(built.request))).toBe(true)
    expect(sameRiskRequest(built.request, { ...built.request, lookback_days: 1095 })).toBe(false)
    expect(sameRiskRequest(built.request, { ...built.request, weights: [41, 30, 10] })).toBe(false)
    expect(riskSummary(R)).toBe('1Y lookback · market SPY · 2025-10-06 → 2026-10-02 (250 daily returns) · 20.0% cash')
    expect(riskSummary({ ...R, cash_weight: 0 })).not.toContain('cash')
  })
})
