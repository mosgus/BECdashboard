import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { tradeBasis } from './optimize'
import {
  addPositionBuying,
  addPositionDiluting,
  cashFromPositions,
  creationCashDollars,
  impliedPortfolioValue,
  isValidCurrentPortfolio,
  migrateLegacyPortfolio,
  positionPrice,
  remarkPortfolio,
  removePositionSelling,
  removePositionToCash,
  sellPositionWeight,
  sellSliderMax,
  summariseDraft,
  switchEntryMode,
  valuePortfolio,
  weightFromShares,
  withCashDollars,
} from './portfolio'
import type { DraftRow, DraftSummary, ModeSwitch, Portfolio } from './portfolio'

function portfolio(cashWeight: number, positions: Portfolio['positions']): Portfolio {
  return { id: 'portfolio', name: 'Portfolio', cashWeight, positions, updatedAt: '2026-09-21T00:00:00Z' }
}

function entry(price: number | null): UniverseEntry {
  return {
    ticker: 'unused', short_name: null, sector: null, quote_type: null,
    current_price: null, last_close: price, regular_market_price: null, prior_close: null,
    quote_fetched_at: null, market_cap: null, trailing_pe: null, dividend_yield: null,
    bar_count: 0, first_bar: null, last_bar: null, fetched_at: null, added_at: '',
  }
}

describe('valuePortfolio cash dollars', () => {
  const positions = [
    { ticker: 'AAA', weight: 45, shares: 10 },
    { ticker: 'BBB', weight: 45, shares: 30 },
  ]
  const byTicker = new Map([
    ['AAA', { ...entry(45), ticker: 'AAA', short_name: 'AAA' }],
    ['BBB', { ...entry(15), ticker: 'BBB', short_name: 'BBB' }],
  ])

  it('derives cash dollars from the implied total value', () => {
    expect(valuePortfolio(portfolio(10, positions), byTicker).cashDollars).toBeCloseTo(100, 6)
  })

  it('returns null when a position has no shares', () => {
    expect(valuePortfolio(portfolio(10, [{ ...positions[0] }, { ticker: 'BBB', weight: 45 }]), byTicker).cashDollars).toBeNull()
  })

  it('returns null when a position has no usable price', () => {
    const noPrice = new Map([...byTicker, ['BBB', { ...entry(null), ticker: 'BBB', short_name: 'BBB' }]])
    expect(valuePortfolio(portfolio(10, positions), noPrice).cashDollars).toBeNull()
  })

  it('returns zero when cash weight is zero', () => {
    expect(valuePortfolio(portfolio(0, positions.map((position) => ({ ...position, weight: 50 }))), byTicker).cashDollars).toBeCloseTo(0, 6)
  })

  it('returns null and reports a missing ticker', () => {
    const valued = valuePortfolio(portfolio(10, positions), new Map([['AAA', byTicker.get('AAA')!]]))
    expect(valued.cashDollars).toBeNull()
    expect(valued.missingTickers).toEqual(['BBB'])
  })

  it('uses fixed cash without prices', () => {
    const valued = valuePortfolio({ ...portfolio(10, positions), cashDollars: 100 }, new Map())
    expect(valued.cashDollars).toBe(100)
    expect(valued.cashFixed).toBe(true)
    expect(valuePortfolio(portfolio(10, positions), new Map()).cashFixed).toBe(false)
  })
})

describe('shares-based portfolios', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const prices = new Map([['AAA', { ...entry(45), ticker: 'AAA' }], ['BBB', { ...entry(15), ticker: 'BBB' }]])

  it('re-marks saved weights without mutating the input', () => {
    const before = structuredClone(base)
    const remarked = remarkPortfolio(base, prices)
    expect(remarked).not.toBeNull()
    expect(remarked?.positions[0].weight).toBeCloseTo(45, 6)
    expect(remarked?.positions[1].weight).toBeCloseTo(45, 6)
    expect(remarked?.cashWeight).toBeCloseTo(10, 6)
    expect(remarked?.cashDollars).toBe(100)
    expect(remarked?.updatedAt).toBe(base.updatedAt)
    expect(base).toEqual(before)
  })

  it('re-marks changed prices and rejects incomplete inputs', () => {
    const changed = remarkPortfolio(base, new Map([...prices, ['AAA', { ...entry(55), ticker: 'AAA' }]]))
    expect(changed?.positions[0].weight).toBeCloseTo(50, 6)
    expect(changed?.positions[1].weight).toBeCloseTo(40.909091, 6)
    expect(changed?.cashWeight).toBeCloseTo(9.090909, 6)
    expect(remarkPortfolio({ ...base, cashDollars: undefined }, prices)).toBeNull()
    expect(remarkPortfolio({ ...base, positions: [base.positions[0], { ticker: 'BBB', weight: 45 }] }, prices)).toBeNull()
    expect(remarkPortfolio(base, new Map([...prices, ['BBB', { ...entry(null), ticker: 'BBB' }]]))).toBeNull()
    expect(remarkPortfolio({ ...base, cashWeight: 100, positions: [] }, prices)).toBeNull()
  })

  it('validates cash dollars and drops them when editing weights', () => {
    expect(isValidCurrentPortfolio({ ...base, cashDollars: -1 })).toBe(false)
    expect(isValidCurrentPortfolio({ ...base, cashDollars: Number.NaN })).toBe(false)
    expect(isValidCurrentPortfolio({ ...base, cashDollars: 0 })).toBe(true)
    const { cashDollars: _cashDollars, ...weightBased } = base
    expect(isValidCurrentPortfolio(weightBased)).toBe(true)
    expect('cashDollars' in addPositionDiluting(base, { ticker: 'CCC', weight: 5 })!).toBe(false)
    expect('cashDollars' in removePositionToCash(base, 'AAA')!).toBe(false)
  })

  it('sets creation cash only for complete shares portfolios', () => {
    expect(creationCashDollars('shares', 292406.58, base, prices)).toBe(292406.58)
    expect(creationCashDollars('shares', null, base, prices)).toBeUndefined()
    expect(creationCashDollars('weight', null, { ...base, cashDollars: undefined }, prices)).toBeCloseTo(100, 6)
    expect(creationCashDollars('weight', null, { ...base, cashDollars: undefined, positions: [base.positions[0], { ticker: 'BBB', weight: 45 }] }, prices)).toBeUndefined()
  })
})

describe('withCashDollars', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const prices = new Map([['AAA', { ...entry(45), ticker: 'AAA' }], ['BBB', { ...entry(15), ticker: 'BBB' }]])

  it('sets fixed cash and re-marks the weights', () => {
    const result = withCashDollars(base, 1100, prices)

    expect(result?.positions[0].weight).toBeCloseTo(22.5, 6)
    expect(result?.positions[1].weight).toBeCloseTo(22.5, 6)
    expect(result?.cashWeight).toBeCloseTo(55, 6)
    expect(result?.cashDollars).toBe(1100)
    expect(result?.updatedAt).toBe(base.updatedAt)
  })

  it('allows zero fixed cash', () => {
    const result = withCashDollars(base, 0, prices)

    expect(result?.positions[0].weight).toBeCloseTo(50, 6)
    expect(result?.positions[1].weight).toBeCloseTo(50, 6)
    expect(result?.cashWeight).toBeCloseTo(0, 6)
    expect(result?.cashDollars).toBe(0)
  })

  it('rejects invalid dollars, weight-based portfolios, and unusable prices', () => {
    const { cashDollars: _cashDollars, ...weightBased } = base

    expect(withCashDollars(base, -1, prices)).toBeNull()
    expect(withCashDollars(base, Number.NaN, prices)).toBeNull()
    expect(withCashDollars(base, Number.POSITIVE_INFINITY, prices)).toBeNull()
    expect(withCashDollars(weightBased, 100, prices)).toBeNull()
    expect(withCashDollars(base, 100, new Map([...prices, ['BBB', { ...entry(null), ticker: 'BBB' }]]))).toBeNull()
  })

  it('keeps an all-cash portfolio at 100% cash', () => {
    const result = withCashDollars({ ...base, cashWeight: 100, positions: [], cashDollars: 50 }, 75, prices)

    expect(result?.cashDollars).toBe(75)
    expect(result?.cashWeight).toBe(100)
    expect(result?.positions).toEqual([])
  })

  it('does not mutate the input', () => {
    const before = structuredClone(base)

    withCashDollars(base, 1100, prices)

    expect(base).toEqual(before)
  })
})

describe('removePositionSelling', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const prices = new Map([['AAA', { ...entry(45), ticker: 'AAA' }], ['BBB', { ...entry(15), ticker: 'BBB' }]])

  it('sells at the current price into fixed cash and re-marks remaining weights', () => {
    const result = removePositionSelling(base, 'AAA', prices)

    expect(result?.positions).toHaveLength(1)
    expect(result?.positions[0].ticker).toBe('BBB')
    expect(result?.cashDollars).toBeCloseTo(550, 6)
    expect(result?.positions[0].weight).toBeCloseTo(45, 6)
    expect(result?.cashWeight).toBeCloseTo(55, 6)
    expect(result?.updatedAt).toBe(base.updatedAt)
  })

  it('uses the current sale price when it differs from the saved mark', () => {
    const changed = new Map([...prices, ['AAA', { ...entry(55), ticker: 'AAA' }]])
    const result = removePositionSelling(base, 'AAA', changed)

    expect(result?.cashDollars).toBeCloseTo(650, 6)
    expect(result?.positions[0].weight).toBeCloseTo(40.909091, 6)
    expect(result?.cashWeight).toBeCloseTo(59.090909, 6)
  })

  it('keeps all proceeds in cash after removing the final holding', () => {
    const first = removePositionSelling(base, 'AAA', prices)!
    const result = removePositionSelling(first, 'BBB', prices)

    expect(result?.positions).toEqual([])
    expect(result?.cashWeight).toBe(100)
    expect(result?.cashDollars).toBeCloseTo(1000, 6)
  })

  it('returns null when the sold or remaining holding has no usable price', () => {
    expect(removePositionSelling(base, 'AAA', new Map([...prices, ['AAA', { ...entry(null), ticker: 'AAA' }]]))).toBeNull()
    expect(removePositionSelling(base, 'AAA', new Map([...prices, ['BBB', { ...entry(null), ticker: 'BBB' }]]))).toBeNull()
  })

  it('returns null for weight-based portfolios and unheld tickers', () => {
    const { cashDollars: _cashDollars, ...weightBased } = base

    expect(removePositionSelling(weightBased, 'AAA', prices)).toBeNull()
    expect(removePositionSelling(base, 'CCC', prices)).toBeNull()
  })

  it('does not mutate the input', () => {
    const before = structuredClone(base)

    removePositionSelling(base, 'AAA', prices)

    expect(base).toEqual(before)
  })
})

describe('sellPositionWeight', () => {
  const base: Portfolio = {
    ...portfolio(10, [
      { ticker: 'AAA', weight: 45, shares: 10 },
      { ticker: 'BBB', weight: 45, shares: 30 },
    ]),
    cashDollars: 100,
  }
  const prices = new Map([
    ['AAA', { ...entry(45), ticker: 'AAA' }],
    ['BBB', { ...entry(15), ticker: 'BBB' }],
  ])

  it('sells portfolio weight and re-marks the shares portfolio', () => {
    const before = structuredClone(base)
    const result = sellPositionWeight(base, 'AAA', 15, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.soldAll).toBe(false)
    expect(result.holdingWeight).toBeCloseTo(45, 6)
    expect(result.sharesSold).toBeCloseTo(10 / 3, 6)
    expect(result.proceeds).toBeCloseTo(150, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(250, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.shares).toBeCloseTo(20 / 3, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.weight).toBeCloseTo(30, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'BBB')?.weight).toBeCloseTo(45, 6)
    expect(result.portfolio.cashWeight).toBeCloseTo(25, 6)
    expect(result.portfolio.updatedAt).toBe(base.updatedAt)
    expect(base).toEqual(before)
  })

  it.each([45, 45.5, Number.POSITIVE_INFINITY])('sells all at weight %s', (weight) => {
    const result = sellPositionWeight(base, 'AAA', weight, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.soldAll).toBe(true)
    expect(result.sharesSold).toBe(10)
    expect(result.holdingWeight).toBeCloseTo(45, 6)
    expect(result.portfolio.positions.some((position) => position.ticker === 'AAA')).toBe(false)
    expect(result.portfolio.cashDollars).toBeCloseTo(550, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'BBB')?.weight).toBeCloseTo(45, 6)
    expect(result.portfolio.cashWeight).toBeCloseTo(55, 6)
  })

  it('uses the remarked holding weight when stored weights are stale', () => {
    const stalePrices = new Map([
      ['AAA', { ...entry(90), ticker: 'AAA' }],
      ['BBB', { ...entry(15), ticker: 'BBB' }],
    ])
    const result = sellPositionWeight(base, 'AAA', 10, stalePrices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.holdingWeight).toBeCloseTo(900 / 1450 * 100, 6)
    expect(result.proceeds).toBeCloseTo(145, 6)
    expect(result.sharesSold).toBeCloseTo(145 / 90, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.weight).toBeCloseTo(755 / 1450 * 100, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(245, 6)
  })

  it('sells the only holding entirely', () => {
    const only: Portfolio = {
      ...portfolio(10, [{ ticker: 'AAA', weight: 90, shares: 10 }]),
      cashDollars: 50,
    }
    const result = sellPositionWeight(only, 'AAA', 90, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.portfolio.positions).toEqual([])
    expect(result.portfolio.cashWeight).toBeCloseTo(100, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(500, 6)
  })

  it('rejects invalid requests and distinguishes missing prices', () => {
    for (const weight of [0, -1, Number.NaN]) {
      expect(sellPositionWeight(base, 'AAA', weight, prices)).toEqual({ ok: false, reason: 'invalid' })
    }
    expect(sellPositionWeight(base, 'ZZZ', 1, prices)).toEqual({ ok: false, reason: 'invalid' })
    const noCash = { ...base }
    delete noCash.cashDollars
    expect(sellPositionWeight(noCash, 'AAA', 1, prices)).toEqual({ ok: false, reason: 'invalid' })
    expect(sellPositionWeight(base, 'AAA', 1, new Map([
      ['AAA', { ...entry(null), ticker: 'AAA' }], ['BBB', prices.get('BBB')!],
    ]))).toEqual({ ok: false, reason: 'no-price' })
    expect(sellPositionWeight(base, 'AAA', 1, new Map([
      ['AAA', prices.get('AAA')!], ['BBB', { ...entry(null), ticker: 'BBB' }],
    ]))).toEqual({ ok: false, reason: 'unpriced-holding' })
  })

  it('rounds slider maxima up to the next hundredth point', () => {
    expect(sellSliderMax(5.07)).toBe(5.07)
    expect(sellSliderMax(5.071)).toBe(5.08)
    expect(sellSliderMax(45)).toBe(45)
    expect(sellSliderMax(0.002)).toBe(0.01)
    expect(sellSliderMax(45.0000000001)).toBe(45)
  })
})

describe('addPositionBuying', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const prices = new Map([
    ['AAA', { ...entry(45), ticker: 'AAA' }],
    ['BBB', { ...entry(15), ticker: 'BBB' }],
    ['CCC', { ...entry(20), ticker: 'CCC' }],
  ])

  it('buys shares from cash and re-marks the portfolio', () => {
    const result = addPositionBuying(base, 'CCC', 4, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cost).toBeCloseTo(80, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(20, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.weight).toBeCloseTo(45, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'BBB')?.weight).toBeCloseTo(45, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'CCC')?.weight).toBeCloseTo(8, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'CCC')?.shares).toBe(4)
    expect(result.portfolio.cashWeight).toBeCloseTo(2, 6)
    expect(result.portfolio.updatedAt).toBe(base.updatedAt)
  })

  it('spends all cash when the purchase costs exactly the cash balance', () => {
    const result = addPositionBuying(base, 'CCC', 5, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.portfolio.cashDollars).toBeCloseTo(0, 6)
    expect(result.portfolio.cashWeight).toBeCloseTo(0, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'CCC')?.weight).toBeCloseTo(10, 6)
  })

  it('clamps cash to zero for a purchase within the half-cent tolerance', () => {
    const result = addPositionBuying(base, 'CCC', 5.0002, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.portfolio.cashDollars).toBe(0)
  })

  it('rejects purchases that exceed available cash', () => {
    expect(addPositionBuying(base, 'CCC', 6, prices)).toEqual({ ok: false, reason: 'insufficient-cash' })
  })

  it('rejects a new ticker without a usable price', () => {
    const noCccPrice = new Map([...prices, ['CCC', { ...entry(null), ticker: 'CCC' }]])
    expect(addPositionBuying(base, 'CCC', 1, noCccPrice)).toEqual({ ok: false, reason: 'no-price' })
  })

  it('rejects a buy when an existing holding cannot be re-marked', () => {
    const noBbbPrice = new Map([...prices, ['BBB', { ...entry(null), ticker: 'BBB' }]])
    expect(addPositionBuying(base, 'CCC', 1, noBbbPrice)).toEqual({ ok: false, reason: 'unpriced-holding' })
  })

  it('buys more shares of an existing holding without adding a duplicate', () => {
    const result = addPositionBuying(base, 'AAA', 2, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cost).toBeCloseTo(90, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(10, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.shares).toBe(12)
    expect(result.portfolio.positions.find((position) => position.ticker === 'BBB')?.shares).toBe(30)
    expect(result.portfolio.positions.find((position) => position.ticker === 'AAA')?.weight).toBeCloseTo(54, 6)
    expect(result.portfolio.positions.find((position) => position.ticker === 'BBB')?.weight).toBeCloseTo(45, 6)
    expect(result.portfolio.cashWeight).toBeCloseTo(1, 6)
    expect(result.portfolio.positions).toHaveLength(2)
    expect(result.portfolio.updatedAt).toBe(base.updatedAt)
  })

  it('rejects a held-ticker purchase that exceeds available cash', () => {
    expect(addPositionBuying(base, 'AAA', 3, prices)).toEqual({ ok: false, reason: 'insufficient-cash' })
  })

  it('rejects a top-up when another holding cannot be re-marked', () => {
    const noBbbPrice = new Map([...prices, ['BBB', { ...entry(null), ticker: 'BBB' }]])
    expect(addPositionBuying(base, 'AAA', 1, noBbbPrice)).toEqual({ ok: false, reason: 'unpriced-holding' })
  })

  it('rejects a top-up when the held ticker has no usable price', () => {
    const noAaaPrice = new Map([...prices, ['AAA', { ...entry(null), ticker: 'AAA' }]])
    expect(addPositionBuying(base, 'AAA', 1, noAaaPrice)).toEqual({ ok: false, reason: 'no-price' })
  })

  it.each([0, -1, Number.NaN])('rejects invalid share count %s', (shares) => {
    expect(addPositionBuying(base, 'CCC', shares, prices)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a weight-based portfolio', () => {
    const { cashDollars: _cashDollars, ...weightBased } = base
    expect(addPositionBuying(weightBased, 'CCC', 1, prices)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('buys from an all-cash shares-based portfolio', () => {
    const allCash: Portfolio = { ...base, cashWeight: 100, cashDollars: 100, positions: [] }
    const result = addPositionBuying(allCash, 'CCC', 4, prices)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.portfolio.positions[0].weight).toBeCloseTo(80, 6)
    expect(result.portfolio.cashWeight).toBeCloseTo(20, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(20, 6)
  })

  it('does not mutate the input portfolio', () => {
    const before = structuredClone(base)
    addPositionBuying(base, 'CCC', 4, prices)
    expect(base).toEqual(before)
  })

  it('does not mutate the input when topping up a held ticker', () => {
    const before = structuredClone(base)
    addPositionBuying(base, 'AAA', 2, prices)
    expect(base).toEqual(before)
  })
})

describe('summariseDraft cash dollars', () => {
  const rows: DraftRow[] = [{ id: 'AAA', ticker: 'AAA', shares: '10', weight: '' }]
  const prices = new Map([['AAA', { ...entry(25), ticker: 'AAA' }]])

  it('reports parsed shares cash and null for weight mode', () => {
    expect(summariseDraft({ name: 'Shares', mode: 'shares', cash: '250', rows }, prices).cashDollars).toBe(250)
    expect(summariseDraft({ name: 'Weight', mode: 'weight', cash: '50', rows: [{ ...rows[0], shares: '', weight: '50' }] }, prices).cashDollars).toBeNull()
  })
})

describe('switchEntryMode', () => {
  const weightRows: DraftRow[] = [
    { id: 'first', ticker: 'AAPL', shares: '', weight: '60' },
    { id: 'second', ticker: 'MSFT', shares: '', weight: '40' },
  ]
  const weightSummary: DraftSummary = {
    rows: [
      { id: 'first', ticker: 'AAPL', shares: null, weight: 55 },
      { id: 'second', ticker: 'MSFT', shares: null, weight: 45 },
    ],
    cashWeight: 5,
    cashDollars: null,
    allocatedPercent: 100,
    remainderPercent: 0,
    canCreate: true,
    problem: null,
  }
  const sharesSummary: DraftSummary = {
    rows: [
      { id: 'first', ticker: 'AAPL', shares: 12, weight: 60 },
      { id: 'second', ticker: 'MSFT', shares: 8, weight: 40 },
    ],
    cashWeight: 0,
    cashDollars: null,
    allocatedPercent: 100,
    remainderPercent: 0,
    canCreate: true,
    problem: null,
  }

  it('keeps blank shares and clears cash when switching weights to shares', () => {
    const original = { cash: '0', rows: structuredClone(weightRows) }
    const result = switchEntryMode({ mode: 'weight', ...original }, 'shares', weightSummary, null, new Map())

    expect(result.fields).toEqual({
      cash: '',
      rows: [
        { id: 'first', ticker: 'AAPL', shares: '', weight: '60' },
        { id: 'second', ticker: 'MSFT', shares: '', weight: '40' },
      ],
    })
    expect(result.lastSwitch?.from).toBe('weight')
  })

  it('restores the exact weight draft after switching back without edits', () => {
    const original = { cash: '0', rows: structuredClone(weightRows) }
    const toShares = switchEntryMode({ mode: 'weight', ...original }, 'shares', weightSummary, null, new Map())
    const result = switchEntryMode(
      { mode: 'shares', ...toShares.fields },
      'weight',
      sharesSummary,
      toShares.lastSwitch,
      new Map(),
    )

    expect(result.fields).toEqual(original)
    expect(result.lastSwitch).toBeNull()
  })

  it('converts from the current summary when shares-mode fields were edited', () => {
    const toShares = switchEntryMode(
      { mode: 'weight', cash: '0', rows: structuredClone(weightRows) },
      'shares',
      weightSummary,
      null,
      new Map(),
    )
    const editedRows = toShares.fields.rows.map((row, index) =>
      index === 0 ? { ...row, ticker: 'NVDA' } : row,
    )
    const result = switchEntryMode(
      { mode: 'shares', cash: toShares.fields.cash, rows: editedRows },
      'weight',
      weightSummary,
      toShares.lastSwitch,
      new Map(),
    )

    expect(result.fields).toEqual({
      cash: '5',
      rows: [
        { id: 'first', ticker: 'NVDA', shares: '', weight: '55' },
        { id: 'second', ticker: 'MSFT', shares: '', weight: '45' },
      ],
    })
    expect(result.lastSwitch).not.toBeNull()
  })

  it('restores shares and cash dollars after switching modes without edits', () => {
    const original = {
      cash: '125.50',
      rows: [
        { id: 'first', ticker: 'AAPL', shares: '12.250', weight: '' },
        { id: 'second', ticker: 'MSFT', shares: '8', weight: '' },
      ],
    }
    const toWeight = switchEntryMode({ mode: 'shares', ...original }, 'weight', sharesSummary, null, new Map())
    const result = switchEntryMode(
      { mode: 'weight', ...toWeight.fields },
      'shares',
      weightSummary,
      toWeight.lastSwitch,
      new Map(),
    )

    expect(result.fields).toEqual(original)
    expect(result.lastSwitch).toBeNull()
  })

  it('returns the same-mode fields and last switch unchanged', () => {
    const fields = { cash: '0', rows: structuredClone(weightRows) }
    const lastSwitch: ModeSwitch = {
      from: 'shares',
      before: { cash: '0', rows: structuredClone(weightRows) },
      after: structuredClone(fields),
    }
    const result = switchEntryMode(
      { mode: 'weight', ...fields },
      'weight',
      weightSummary,
      lastSwitch,
      new Map(),
    )

    expect(result.fields).toEqual(fields)
    expect(result.lastSwitch).toBe(lastSwitch)
  })

  it('does not restore when the recorded source mode differs from the target mode', () => {
    const current = { cash: '', rows: structuredClone(weightRows) }
    const lastSwitch: ModeSwitch = {
      from: 'shares',
      before: { cash: '0', rows: structuredClone(weightRows) },
      after: structuredClone(current),
    }
    const result = switchEntryMode(
      { mode: 'shares', ...current },
      'weight',
      weightSummary,
      lastSwitch,
      new Map(),
    )

    expect(result.fields).toEqual({
      cash: '5',
      rows: [
        { id: 'first', ticker: 'AAPL', shares: '', weight: '55' },
        { id: 'second', ticker: 'MSFT', shares: '', weight: '45' },
      ],
    })
  })

  it('does not mutate the draft rows or their row objects', () => {
    const rows = structuredClone(weightRows)
    const before = structuredClone(rows)
    switchEntryMode({ mode: 'weight', cash: '0', rows }, 'shares', weightSummary, null, new Map())

    expect(rows).toEqual(before)
  })

  it('keeps imported shares and derives zero cash when cash weight is zero', () => {
    const rows = [
      { id: 'first', ticker: 'AAPL', shares: '1', weight: '60' },
      { id: 'second', ticker: 'MSFT', shares: '2', weight: '40' },
    ]
    const result = switchEntryMode(
      { mode: 'weight', cash: '0', rows },
      'shares',
      { ...weightSummary, cashWeight: 0 },
      null,
      new Map([['AAPL', { ...entry(300), ticker: 'AAPL' }], ['MSFT', { ...entry(100), ticker: 'MSFT' }]]),
    )

    expect(result.fields).toEqual({ cash: '0', rows })
  })

  it('derives cash dollars from imported shares and the cash weight', () => {
    const rows = [
      { id: 'first', ticker: 'AAPL', shares: '1', weight: '48' },
      { id: 'second', ticker: 'MSFT', shares: '2', weight: '32' },
    ]
    const result = switchEntryMode(
      { mode: 'weight', cash: '20', rows },
      'shares',
      { ...weightSummary, cashWeight: 20 },
      null,
      new Map([['AAPL', { ...entry(300), ticker: 'AAPL' }], ['MSFT', { ...entry(100), ticker: 'MSFT' }]]),
    )

    expect(result.fields).toEqual({ cash: '125', rows })
  })

  it('keeps available shares and leaves cash blank when one row has no shares', () => {
    const rows = [
      { id: 'first', ticker: 'AAPL', shares: '', weight: '60' },
      { id: 'second', ticker: 'MSFT', shares: '2', weight: '40' },
    ]
    const result = switchEntryMode(
      { mode: 'weight', cash: '20', rows },
      'shares',
      { ...weightSummary, cashWeight: 20 },
      null,
      new Map([['AAPL', { ...entry(300), ticker: 'AAPL' }], ['MSFT', { ...entry(100), ticker: 'MSFT' }]]),
    )

    expect(result.fields).toEqual({ cash: '', rows })
  })

  it('keeps imported shares and leaves cash blank when a row has no price', () => {
    const rows = [
      { id: 'first', ticker: 'AAPL', shares: '1', weight: '60' },
      { id: 'second', ticker: 'MSFT', shares: '2', weight: '40' },
    ]
    const result = switchEntryMode(
      { mode: 'weight', cash: '20', rows },
      'shares',
      { ...weightSummary, cashWeight: 20 },
      null,
      new Map([['AAPL', { ...entry(300), ticker: 'AAPL' }], ['MSFT', { ...entry(null), ticker: 'MSFT' }]]),
    )

    expect(result.fields).toEqual({ cash: '', rows })
  })

  it('restores the original weight draft after the imported shares switch is untouched', () => {
    const original = {
      cash: '0',
      rows: [
        { id: 'first', ticker: 'AAPL', shares: '1', weight: '60' },
        { id: 'second', ticker: 'MSFT', shares: '2', weight: '40' },
      ],
    }
    const byTicker = new Map([
      ['AAPL', { ...entry(300), ticker: 'AAPL' }],
      ['MSFT', { ...entry(100), ticker: 'MSFT' }],
    ])
    const toShares = switchEntryMode(
      { mode: 'weight', ...original },
      'shares',
      { ...weightSummary, cashWeight: 0 },
      null,
      byTicker,
    )
    const result = switchEntryMode(
      { mode: 'shares', ...toShares.fields },
      'weight',
      sharesSummary,
      toShares.lastSwitch,
      byTicker,
    )

    expect(result.fields).toEqual(original)
    expect(result.lastSwitch).toBeNull()
  })
})

const GUNNAR_WEIGHTS = [
  73.40490607218531,
  10.481994524396962,
  10.4075329437956,
  3.1979752499318987,
  2.2013242930879917,
  0.30626691660223515,
]

function rescaledPositionsForCash(cashWeight: number): Portfolio['positions'] {
  const assetWeight = GUNNAR_WEIGHTS.reduce((sum, weight) => sum + weight, 0)
  const targetAssetWeight = 100 - cashWeight
  return GUNNAR_WEIGHTS.map((weight, index) => ({
    ticker: String(index),
    weight: (weight / assetWeight) * targetAssetWeight,
  }))
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
    const positions = rescaledPositionsForCash(0)
    const rawCash = 100 - positions.reduce((sum, position) => sum + position.weight, 0)

    expect(rawCash).toBeGreaterThan(0)
    expect(cashFromPositions(positions)).toBe(0)
  })
})

describe('stated cash rescaling', () => {
  it('stores a typed cash value of 5 exactly while keeping the allocation valid', () => {
    const parsed = 5
    const positions = rescaledPositionsForCash(parsed)
    const stored = { cashWeight: parsed, positions }

    expect(stored.cashWeight).toBe(5)
    expect(Math.abs(stored.cashWeight + stored.positions.reduce((sum, position) => sum + position.weight, 0) - 100)).toBeLessThanOrEqual(0.01)
  })

  it.each([0, 0.005, 99.9])('stores typed cash %s exactly', (parsed) => {
    const positions = rescaledPositionsForCash(parsed)
    const stored = { cashWeight: parsed, positions }

    expect(stored.cashWeight).toBe(parsed)
    expect(Math.abs(stored.cashWeight + stored.positions.reduce((sum, position) => sum + position.weight, 0) - 100)).toBeLessThanOrEqual(0.01)
  })
})

describe('migrateLegacyPortfolio', () => {
  it('accepts a negative float residue from derived legacy weights', () => {
    const rawCash = 100 - [1, 1, 9].reduce((sum, value) => sum + (value / 11) * 100, 0)
    const result = migrateLegacyPortfolio(
      {
        id: 'legacy',
        name: 'Legacy',
        cash: 0,
        positions: [{ ticker: 'AAPL', shares: 1 }, { ticker: 'MSFT', shares: 1 }, { ticker: 'NVDA', shares: 9 }],
        updatedAt: '2026-09-21T00:00:00Z',
      },
      new Map([['AAPL', entry(1)], ['MSFT', entry(1)], ['NVDA', entry(1)]]),
    )

    expect(rawCash).toBe(-1.4210854715202004e-14)
    expect(result?.cashWeight).toBe(0)
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
    expect(summary.problem).toBe('Every asset needs a usable last close')
  })
})

describe('summariseDraft weight mode carries imported shares', () => {
  const byTicker = new Map([['AAPL', entry(10)], ['MSFT', entry(10)]])

  it('populates shares from the row and leaves an empty row null, without affecting canCreate or weights', () => {
    const summary = summariseDraft(
      {
        name: 'Draft', mode: 'weight', cash: '0',
        rows: [
          { id: 'a', ticker: 'AAPL', weight: '60', shares: '2' },
          { id: 'b', ticker: 'MSFT', weight: '40', shares: '' },
        ],
      },
      byTicker,
    )
    expect(summary.rows[0].shares).toBe(2)
    expect(summary.rows[1].shares).toBeNull()
    expect(summary.canCreate).toBe(true)
    expect(summary.rows.map((row) => row.weight)).toEqual([60, 40])
  })

  it('never lets unparseable share text block a weight-mode draft', () => {
    const summary = summariseDraft(
      {
        name: 'Draft', mode: 'weight', cash: '0',
        rows: [
          { id: 'a', ticker: 'AAPL', weight: '60', shares: 'abc' },
          { id: 'b', ticker: 'MSFT', weight: '40', shares: '' },
        ],
      },
      byTicker,
    )
    expect(summary.canCreate).toBe(true)
    expect(summary.rows.map((row) => row.weight)).toEqual([60, 40])
    expect(summary.rows[0].shares).toBeNull()
  })
})

describe('Portfolios price at the last close (decision 2026-10-01)', () => {
  const base: Portfolio = {
    ...portfolio(10, [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }]),
    cashDollars: 100,
  }
  const byTicker = new Map([
    ['AAA', { ...entry(45), ticker: 'AAA', current_price: 60, regular_market_price: 61 }],
    ['BBB', { ...entry(15), ticker: 'BBB', current_price: 20, regular_market_price: 21 }],
  ])

  it('positionPrice returns last_close even when a live quote differs', () => {
    expect(positionPrice(byTicker.get('AAA'))).toBe(45)
  })

  it('positionPrice does not fall back to a live quote when last_close is missing', () => {
    expect(positionPrice({ ...entry(null), current_price: 60, regular_market_price: 61 })).toBeNull()
  })

  it('re-marks at the last close, so the trade table keeps its dollar basis intraday', () => {
    const remarked = remarkPortfolio(base, byTicker)
    expect(remarked?.positions[0].weight).toBeCloseTo(45, 6)
    expect(remarked?.positions[1].weight).toBeCloseTo(45, 6)
    expect(remarked?.cashWeight).toBeCloseTo(10, 6)
    expect(tradeBasis(remarked!, new Map([['AAA', 45], ['BBB', 15]])).kind).toBe('dollar')
  })

  it('sells at the last close, not the live quote', () => {
    expect(removePositionSelling(base, 'AAA', byTicker)?.cashDollars).toBeCloseTo(550, 6)
  })

  it('buys at the last close, not the live quote', () => {
    const result = addPositionBuying(base, 'BBB', 2, byTicker)
    if (!result.ok) throw new Error(result.reason)
    expect(result.cost).toBeCloseTo(30, 6)
    expect(result.portfolio.cashDollars).toBeCloseTo(70, 6)
  })
})
