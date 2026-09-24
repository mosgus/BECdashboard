import { describe, expect, it } from 'vitest'
import type { PortfolioHolding } from '../api/client'
import type { Portfolio } from './portfolio'
import { chartMode, defaultStart, flatFillRange, formatDollars, scaleFactor, scaleSeries, visibleStartIndex } from './portfolioChart'

const portfolio: Portfolio = {
  id: 'portfolio', name: 'Portfolio', cashWeight: 10, updatedAt: '2026-09-24',
  positions: [{ ticker: 'A', weight: 60, shares: 10 }, { ticker: 'B', weight: 30, shares: 5 }],
}
const holdings: PortfolioHolding[] = [
  { ticker: 'A', weight: 60, first_bar: '2020-01-02', last_close: 54 },
  { ticker: 'B', weight: 30, first_bar: '2020-01-02', last_close: 54 },
]
const flatHoldings: PortfolioHolding[] = [
  { ticker: 'AAA', weight: 1, first_bar: '2020-01-02', last_close: 1 },
  { ticker: 'NEWB', weight: 1, first_bar: '2023-04-12', last_close: 1 },
  { ticker: 'NEWC', weight: 1, first_bar: '2022-01-05', last_close: 1 },
]

describe('portfolio chart calculations', () => {
  it('uses dollars when shares and weights agree', () => {
    const mode = chartMode(portfolio, holdings)
    expect(mode.kind).toBe('dollar')
    if (mode.kind === 'dollar') expect(mode.value).toBeCloseTo(900, 2)
  })

  it('uses an index when shares mismatch weights', () => {
    expect(chartMode({ ...portfolio, positions: [portfolio.positions[0], { ...portfolio.positions[1], shares: 6 }] }, holdings)).toEqual({ kind: 'index', reason: 'shares-mismatch' })
  })

  it('allows a weight mismatch within tolerance', () => {
    const mode = chartMode(portfolio, [{ ...holdings[0], last_close: 54.4 }, holdings[1]])
    expect(mode.kind).toBe('dollar')
    if (mode.kind === 'dollar') expect(mode.value).toBeCloseTo(904.44, 2)
  })

  it('uses an index when a position has no shares', () => {
    expect(chartMode({ ...portfolio, positions: [{ ...portfolio.positions[0], shares: undefined }, portfolio.positions[1]] }, holdings)).toEqual({ kind: 'index', reason: 'no-shares' })
  })

  it('calculates index and dollar scale factors', () => {
    expect(scaleFactor({ kind: 'index', reason: 'no-shares' }, [80, 90, 100], 1)).toBeCloseTo(1.11, 2)
    expect(scaleFactor({ kind: 'dollar', value: 900 }, [80, 90, 100], 1)).toBe(9)
  })

  it('scales non-RSI series without mutating input', () => {
    const source = [{ key: 'sma_fast', label: 'SMA', points: [null, 2] }, { key: 'rsi', label: 'RSI', points: [50] }]
    expect(scaleSeries(source, 3)).toEqual([{ key: 'sma_fast', label: 'SMA', points: [null, 6] }, { key: 'rsi', label: 'RSI', points: [50] }])
    expect(source).toEqual([{ key: 'sma_fast', label: 'SMA', points: [null, 2] }, { key: 'rsi', label: 'RSI', points: [50] }])
  })

  it('describes late holdings in date and ticker order', () => {
    expect(flatFillRange(flatHoldings, '2021-06-01', '2026-09-24')).toEqual({ from: '2021-06-01', to: '2023-04-12', label: 'NEWC listed 2022-01-05, NEWB listed 2023-04-12; flat before then' })
  })

  it('does not shade when every holding has started', () => {
    expect(flatFillRange(flatHoldings, '2023-05-01', '2026-09-24')).toBeNull()
  })

  it('stops flat fill at the visible end', () => {
    expect(flatFillRange(flatHoldings, '2021-06-01', '2022-06-30')?.to).toBe('2022-06-30')
  })

  it('defaults to one year before today', () => {
    expect(defaultStart(new Date(2026, 8, 24))).toBe('2025-09-24')
  })

  it('finds the first visible date or no date', () => {
    expect(visibleStartIndex(['2024-01-02', '2024-01-05'], '2024-01-03')).toBe(1)
    expect(visibleStartIndex(['2024-01-02', '2024-01-05'], '2024-02-01')).toBe(-1)
  })

  it('formats dollar values with the sign first', () => {
    expect(formatDollars(1234567)).toBe('$1.23M')
    expect(formatDollars(51234)).toBe('$51.2K')
    expect(formatDollars(904.44)).toBe('$904.44')
    expect(formatDollars(-1500)).toBe('-$1.5K')
  })
})
