import { describe, expect, it } from 'vitest'
import type { StressResponse } from '../api/client'
import { STRESS_PRESETS, parseWindow, stressChartData, stressRows, stressSummary, stressTiles } from './stress'
const S: StressResponse = {
  tickers: ['A', 'B', 'C'],
  market_ticker: 'SPY',
  start: '2025-02-19',
  end: '2025-04-08',
  n_days: 33,
  cash_weight: 0.2,
  coverage: 0.875,
  portfolio_return: -0.123,
  max_drawdown: -0.15,
  worst_day: -0.045,
  worst_day_date: '2025-04-04',
  market_return: -0.188,
  warnings: [],
  holdings: [
    { ticker: 'A', weight: 0.5, covered: true, asset_return: -0.2, contribution: -0.1 },
    { ticker: 'B', weight: 0.2, covered: true, asset_return: -0.115, contribution: -0.023 },
    { ticker: 'C', weight: 0.1, covered: false, asset_return: null, contribution: null },
  ],
  path: [
    { date: '2025-02-19', value: 1, market: 1 },
    { date: '2025-04-08', value: 0.877, market: 0.812 },
  ],
}
describe('stress', () => {
  it('has presets', () =>
    expect(STRESS_PRESETS.every((p) => parseWindow(p.start, p.end).ok && p.start >= '2000-01-03')).toBe(true))
  it('parses', () =>
    expect(parseWindow(' 2025-02-19 ', '2025-04-08')).toEqual({ ok: true, start: '2025-02-19', end: '2025-04-08' }))
  it('rejects', () =>
    expect(parseWindow('2025-04-08', '2025-02-19')).toEqual({
      ok: false,
      message: 'Start date must be before end date.',
    }))
  it('tiles', () => expect(stressTiles(S).map((x) => x.value)).toEqual(['-12.3%', '-15.0%', '-4.5%', '-18.8%']))
  it('rows', () => expect(stressRows(S).map((x) => x.ticker)).toEqual(['A', 'B', 'C']))
  it('summary', () => expect(stressSummary(S)).toContain('87.5%'))
  it('chart', () => expect(stressChartData(S)[1].portfolio).toBeCloseTo(-12.3))
  it('null market', () => expect(stressTiles({ ...S, market_return: null }).at(-1)?.value).toBe('—'))
})
