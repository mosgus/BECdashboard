import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { addPositionDiluting, impliedPortfolioValue, weightFromShares } from './portfolio'
import type { Portfolio } from './portfolio'

function portfolio(cashWeight: number, positions: Portfolio['positions']): Portfolio {
  return { id: 'portfolio', name: 'Portfolio', cashWeight, positions, updatedAt: '2026-09-21T00:00:00Z' }
}

function entry(price: number | null): UniverseEntry {
  return {
    ticker: 'unused', short_name: null, sector: null, quote_type: null,
    current_price: price, last_close: null, regular_market_price: null, prior_close: null,
    quote_fetched_at: null, market_cap: null, trailing_pe: null, dividend_yield: null,
    bar_count: 0, first_bar: null, last_bar: null, fetched_at: null, added_at: '',
  }
}

describe('addPositionDiluting', () => {
  it('dilutes Gunnar’s fully invested portfolio while preserving its relative weights', () => {
    const current = portfolio(0, [
      { ticker: 'MU', weight: 77.8037268463051 },
      { ticker: 'ORCL', weight: 11.152630234572266 },
      { ticker: 'VOO', weight: 11.043642919122638 },
    ])
    const result = addPositionDiluting(current, { ticker: 'AAPL', weight: 10 })
    expect(result).not.toBeNull()
    if (result === null) return
    expect(result.positions.reduce((sum, position) => sum + position.weight, result.cashWeight)).toBeCloseTo(100, 9)
    expect(result.cashWeight).toBeCloseTo(0, 9)
    for (const original of current.positions) {
      const updated = result.positions.find((position) => position.ticker === original.ticker)
      expect(updated).toBeDefined()
      expect(original.weight / (updated?.weight ?? 0)).toBeCloseTo(1 / 0.9, 9)
    }
  })

  it('uses cash without moving any existing position', () => {
    const current = portfolio(40, [{ ticker: 'AAPL', weight: 60 }])
    const result = addPositionDiluting(current, { ticker: 'MSFT', weight: 10 })
    expect(result).not.toBeNull()
    expect(result?.positions[0].weight).toBe(current.positions[0].weight)
    expect(result?.cashWeight).toBe(30)
  })

  it('uses all cash before diluting a partial shortfall', () => {
    const current = portfolio(5, [{ ticker: 'AAPL', weight: 95 }])
    const result = addPositionDiluting(current, { ticker: 'MSFT', weight: 20 })
    expect(result?.cashWeight).toBeCloseTo(0, 9)
    expect(result?.positions.find((position) => position.ticker === 'AAPL')?.weight).toBeCloseTo(80, 9)
  })

  it('rejects duplicate, total, and impossible dilution requests', () => {
    const current = portfolio(0, [{ ticker: 'AAPL', weight: 100 }])
    expect(addPositionDiluting(current, { ticker: 'AAPL', weight: 10 })).toBeNull()
    expect(addPositionDiluting(current, { ticker: 'MSFT', weight: 100 })).toBeNull()
    expect(addPositionDiluting(portfolio(95, [{ ticker: 'AAPL', weight: 4.99 }]), { ticker: 'MSFT', weight: 99.999 })).toBeNull()
  })

  it('returns a portfolio with finite, positive positions, non-negative cash, and a 100% total', () => {
    const result = addPositionDiluting(portfolio(0, [{ ticker: 'AAPL', weight: 100 }]), { ticker: 'MSFT', weight: 20 })
    expect(result).not.toBeNull()
    if (result === null) return
    expect(result.cashWeight).toBeGreaterThanOrEqual(0)
    expect(result.positions.every((position) => Number.isFinite(position.weight) && position.weight > 0)).toBe(true)
    expect(Math.abs(result.cashWeight + result.positions.reduce((sum, position) => sum + position.weight, 0) - 100)).toBeLessThanOrEqual(0.01)
  })
})

describe('shares-derived allocation', () => {
  it('requires every existing position to have shares and a usable price', () => {
    const current = portfolio(0, [{ ticker: 'AAPL', weight: 50, shares: 10 }, { ticker: 'MSFT', weight: 50 }])
    expect(impliedPortfolioValue(current, new Map([['AAPL', entry(10)], ['MSFT', entry(10)]]))).toBeNull()
    const complete = portfolio(0, [{ ticker: 'AAPL', weight: 50, shares: 10 }, { ticker: 'MSFT', weight: 50, shares: 10 }])
    expect(impliedPortfolioValue(complete, new Map([['AAPL', entry(10)], ['MSFT', entry(null)]]))).toBeNull()
  })

  it('calculates usable share weights and rejects invalid inputs', () => {
    expect(weightFromShares(5, 180, 220.8)).toBeGreaterThan(0)
    expect(weightFromShares(5, 180, 220.8)).toBeLessThan(100)
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(weightFromShares(value, 1, 1)).toBeNull()
      expect(weightFromShares(1, value, 1)).toBeNull()
      expect(weightFromShares(1, 1, value)).toBeNull()
    }
  })
})
