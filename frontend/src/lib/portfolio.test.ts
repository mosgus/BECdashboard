import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { addPositionDiluting, cashFromPositions, impliedPortfolioValue, summariseDraft, weightFromShares } from './portfolio'
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

describe('cashFromPositions', () => {
  it('snaps float residues on either side of 100 to exactly zero', () => {
    expect(cashFromPositions([{ ticker: 'AAPL', weight: 100.00000000000001 }])).toBe(0)
    expect(cashFromPositions([{ ticker: 'AAPL', weight: 99.99999999999999 }])).toBe(0)
  })

  it('rejects genuinely over-allocated positions and preserves ordinary cash', () => {
    expect(cashFromPositions([{ ticker: 'AAPL', weight: 150 }])).toBeNull()
    expect(cashFromPositions([{ ticker: 'AAPL', weight: 60 }])).toBe(40)
  })

  it('preserves a user-entered cash allocation above the noise threshold', () => {
    expect(cashFromPositions([{ ticker: 'AAPL', weight: 99.995 }])).toBeCloseTo(0.005, 12)
  })

  it('avoids the preset rescaling residue that previously deleted the saved portfolio', () => {
    const weights = [
      73.40490607218531,
      10.481994524396962,
      10.4075329437956,
      3.1979752499318987,
      2.2013242930879917,
      0.30626691660223515,
    ]
    const assetWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const positions = weights.map((weight, index) => ({ ticker: String(index), weight: (weight / assetWeight) * 100 }))
    const rawCash = 100 - positions.reduce((sum, position) => sum + position.weight, 0)

    expect(rawCash).toBeGreaterThan(0)
    expect(cashFromPositions(positions)).toBe(0)
  })
})

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

describe('summariseDraft universe membership', () => {
  const validUniverse = new Map([['AAPL', entry(10)]])

  it('rejects an off-universe ticker in weight mode', () => {
    const summary = summariseDraft(
      { name: 'Draft', mode: 'weight', cash: '0', rows: [{ id: '1', ticker: 'ZZZZ', shares: '', weight: '100' }] },
      validUniverse,
    )
    expect(summary.canCreate).toBe(false)
    expect(summary.problem).toBe('Every asset must be a ticker in your Universe')
  })

  it('does not report a ticker problem when the Universe is unavailable', () => {
    const summary = summariseDraft(
      { name: 'Draft', mode: 'weight', cash: '0', rows: [{ id: '1', ticker: 'ZZZZ', shares: '', weight: '100' }] },
      new Map(),
    )
    expect(summary.problem).toBeNull()
  })

  it('keeps the empty-ticker message ahead of universe validation', () => {
    const summary = summariseDraft(
      { name: 'Draft', mode: 'weight', cash: '0', rows: [{ id: '1', ticker: '', shares: '', weight: '100' }] },
      validUniverse,
    )
    expect(summary.problem).toBe('Choose a ticker for every asset')
  })

  it('accepts a fully valid weight-mode draft', () => {
    const summary = summariseDraft(
      { name: 'Draft', mode: 'weight', cash: '0', rows: [{ id: '1', ticker: 'AAPL', shares: '', weight: '100' }] },
      validUniverse,
    )
    expect(summary.canCreate).toBe(true)
  })

  it('keeps shares mode price validation unchanged', () => {
    const summary = summariseDraft(
      { name: 'Draft', mode: 'shares', cash: '0', rows: [{ id: '1', ticker: 'ZZZZ', shares: '1', weight: '' }] },
      validUniverse,
    )
    expect(summary.problem).toBe('Every asset needs a usable current price')
  })
})
