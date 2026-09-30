import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { addPositionDiluting, cashFromPositions, creationCashDollars, impliedPortfolioValue, isValidCurrentPortfolio, migrateLegacyPortfolio, remarkPortfolio, removePositionToCash, summariseDraft, switchEntryMode, valuePortfolio, weightFromShares } from './portfolio'
import type { DraftRow, DraftSummary, ModeSwitch, Portfolio } from './portfolio'

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
    expect(summary.problem).toBe('Every asset needs a usable current price')
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
