import { describe, expect, it } from 'vitest'
import type { PerformanceResponse, TickerSignals } from '../api/client'
import type { Portfolio } from './portfolio'
import {
  buildPerformanceRequest,
  parseOptionalWindow,
  performanceChartData,
  performanceCsv,
  performanceRows,
  signalGrid,
} from './performance'

const RESPONSE: PerformanceResponse = {
  market_ticker: 'SPY',
  start: '2024-01-02',
  end: '2024-01-03',
  n_days: 1,
  cash_weight: 0,
  coverage: 1,
  rf: 0.04,
  rf_source: 'live',
  metrics: { cagr: 0.3339, vol: 0.3419, sharpe: 0.98, max_dd: -0.3942, beta: 1.25, alpha: 0.087 },
  bench_metrics: { cagr: 0.1978, vol: 0.1486, sharpe: 1.33, max_dd: -0.1876 },
  path: [
    { date: '2024-01-02', value: 1, market: 1 },
    { date: '2024-01-03', value: 1.1, market: null },
  ],
  warnings: [],
}
const PORTFOLIO: Portfolio = {
  id: 'id',
  name: 'Test',
  cashWeight: 0.2,
  positions: [{ ticker: 'A', weight: 99.8 }],
  updatedAt: '2024-01-01',
}

describe('performance', () => {
  it('parses optional windows', () => {
    expect(parseOptionalWindow('', '')).toEqual({ ok: true, start: null, end: null })
    expect(parseOptionalWindow(' 2024-01-02 ', '')).toEqual({ ok: true, start: '2024-01-02', end: null })
    expect(parseOptionalWindow('2024-13-01', '')).toEqual({
      ok: false,
      message: 'Dates must be YYYY-MM-DD, or left empty.',
    })
    expect(parseOptionalWindow('2024-02-01', '2024-01-01')).toEqual({
      ok: false,
      message: 'Start date must be before end date.',
    })
  })

  it('builds a cash-aware request', () => {
    expect(
      buildPerformanceRequest(
        { ...PORTFOLIO, positions: [] },
        { start: '', end: '' },
        { kind: 'weights', reason: 'no-shares' },
      ),
    ).toEqual({ ok: false, message: 'Add at least one holding to see performance.' })
    expect(
      buildPerformanceRequest(PORTFOLIO, { start: '', end: '' }, { kind: 'weights', reason: 'no-shares' }),
    ).toEqual({
      ok: true,
      request: { tickers: ['A'], weights: [99.8], cash: 0.2, start: null, end: null, market_ticker: 'SPY' },
    })
  })

  it('formats comparison rows', () => {
    const rows = performanceRows(RESPONSE)
    expect(rows).toHaveLength(6)
    expect(
      rows.map(({ label, portfolio, benchmark, diff, diffTone }) => [label, portfolio, benchmark, diff, diffTone]),
    ).toEqual([
      ['CAGR', '33.39%', '19.78%', '+13.61%', 'positive'],
      ['Volatility', '34.19%', '14.86%', '+19.33%', 'negative'],
      ['Sharpe', '0.98', '1.33', '-0.35', 'negative'],
      ['Max Drawdown', '-39.42%', '-18.76%', '-20.66%', 'negative'],
      ['Beta', '1.25', '1.00', '+0.25', 'muted'],
      ['Alpha', '8.70%', '0.00%', '—', 'muted'],
    ])
    expect(rows.at(-1)?.portfolioTone).toBe('positive')
  })

  it('hides benchmark metrics without market coverage', () => {
    const rows = performanceRows({ ...RESPONSE, bench_metrics: null })
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.benchmark === '—' && row.diff === '—')).toBe(true)
  })

  it('shows missing sharpe as unavailable', () => {
    const sharpe = performanceRows({ ...RESPONSE, metrics: { ...RESPONSE.metrics, sharpe: null } })[2]
    expect(sharpe.portfolio).toBe('—')
    expect(sharpe.diff).toBe('—')
  })

  it('maps the chart data to percentages', () => {
    const chart = performanceChartData(RESPONSE)
    expect(chart[0]).toEqual({ date: '2024-01-02', portfolio: 0, market: 0 })
    expect(chart[1]?.portfolio).toBeCloseTo(10)
    expect(chart[1]?.market).toBeNull()
  })

  it('exports equity curves to CSV', () => {
    expect(performanceCsv(RESPONSE)).toBe('date,portfolio,SPY\n2024-01-02,1,1\n2024-01-03,1.1,')
  })

  it('keeps portfolio ticker and signal-column order', () => {
    const signals: TickerSignals[] = [
      {
        ticker: 'A',
        atr: null,
        atr_pct: null,
        signals: [
          { signal: 'macd_cross', label: 'MACD', state: 'BULLISH', last_trigger_date: '2024-01-03', value: null },
          { signal: 'sma_cross', label: 'SMA', state: 'BEARISH', last_trigger_date: '2024-01-02', value: null },
          { signal: 'rsi_threshold', label: 'RSI', state: 'NEUTRAL', last_trigger_date: null, value: null },
        ],
      },
    ]
    const rows = signalGrid(['B', 'A'], signals)
    expect(rows.map((row) => row.ticker)).toEqual(['B', 'A'])
    expect(rows[0].cells).toEqual([
      { state: null, lastTrigger: null },
      { state: null, lastTrigger: null },
      { state: null, lastTrigger: null },
    ])
    expect(rows[1].cells.map((cell) => cell.state)).toEqual(['BEARISH', 'NEUTRAL', 'BULLISH'])
  })
})
