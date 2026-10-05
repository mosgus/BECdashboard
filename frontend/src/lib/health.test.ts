import { describe, expect, it } from 'vitest'
import type { RiskResponse } from '../api/client'
import { healthCards, healthChartData, healthRows, mitigations } from './health'

const R: RiskResponse = {
  tickers: ['A', 'B'],
  holdings: [
    { ticker: 'A', weight: 0.4, invested_weight: 0.5, vol: 0.3, beta: 1.2, risk_share: 0.7 },
    { ticker: 'B', weight: 0.4, invested_weight: 0.5, vol: 0.15, beta: 0.6, risk_share: 0.3 },
  ],
  market_ticker: 'SPY',
  lookback_days: 365,
  start: '2025-01-02',
  end: '2026-01-02',
  n_returns: 250,
  cash_weight: 0.2,
  portfolio_vol: 0.2,
  portfolio_beta: 0.72,
  hhi: 0.5,
  effective_holdings: 2,
  top5_weight: 1,
  warnings: [],
}

describe('health helpers', () => {
  it('builds the five health cards', () => {
    expect(healthCards(R).map((card) => card.label)).toEqual(['HHI', 'N_eff', 'Top 5', 'Beta', 'Ann. Vol'])
    expect(healthCards(R).map((card) => card.value)).toEqual(['0.5000', '2.00', '100.0%', '0.720', '20.00%'])
  })
  it('maps rows and derives MCTR from total portfolio weight', () => {
    const rows = healthRows(R)
    expect(rows.map((row) => row.ticker)).toEqual(['A', 'B'])
    expect(rows[0]).toMatchObject({ weight: 0.5, rc: 0.7 })
    expect(rows[0].mctr).toBeCloseTo(0.35)
    expect(rows[1].mctr).toBeCloseTo(0.15)
  })
  it('keeps unavailable risk contributions last', () => {
    const rows = healthRows({ ...R, holdings: [...R.holdings, { ...R.holdings[0], ticker: 'C', risk_share: null }] })
    expect(rows.at(-1)).toMatchObject({ ticker: 'C', rc: null, mctr: null })
  })
  it('charts non-null contributions, capped at twenty', () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      ticker: `${index}`,
      weight: 0.5,
      rc: index === 24 ? null : 0.7,
      mctr: 0.35,
      vol: 0.2,
      beta: 1,
    }))
    const data = healthChartData(rows)
    expect(data).toHaveLength(20)
    expect(healthChartData(healthRows(R))[0]).toMatchObject({
      ticker: 'A',
      weightPct: expect.closeTo(50),
      rcPct: expect.closeTo(70),
    })
  })
  it('creates high-severity recommendations in category order', () => {
    const items = mitigations({ ...R, hhi: 0.2, portfolio_beta: 1.4, portfolio_vol: 0.3 }, 'p1')
    expect(items.map((item) => item.severity)).toEqual(['high', 'high', 'high'])
    expect(items.map((item) => item.title)).toEqual([
      'High concentration risk',
      'High market sensitivity',
      'Elevated volatility',
    ])
    expect(items[0].link?.to).toBe('/portfolios/p1/optimize')
    expect(items[1].link?.to).toBe('/portfolios/p1/outlook')
  })
  it('uses strict thresholds for medium recommendations', () => {
    expect(
      mitigations({ ...R, hhi: 0.1, portfolio_beta: 1.2, portfolio_vol: 0.22 }, 'p1').map((item) => item.severity),
    ).toEqual(['medium', 'medium', 'medium'])
    expect(
      mitigations({ ...R, hhi: 0.15, portfolio_beta: 1.3, portfolio_vol: 0.25 }, 'p1').map((item) => item.severity),
    ).toEqual(['medium', 'medium', 'medium'])
  })
  it('reports a healthy portfolio when nothing triggers', () => {
    expect(mitigations({ ...R, hhi: 0.05, portfolio_beta: 0.9, portfolio_vol: 0.12 }, 'p1')).toMatchObject([
      { severity: 'low', title: 'Portfolio health looks good' },
    ])
  })
})
