import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { summariseDraft, type Portfolio } from './portfolio'
import { parsePortfolioCsv, portfolioCsvFilename, portfolioNameFromFilename, serializePortfolioCsv } from './portfolioCsv'

function entry(ticker: string): UniverseEntry {
  return {
    ticker, short_name: null, sector: null, quote_type: null,
    current_price: null, last_close: null, regular_market_price: null, prior_close: null,
    quote_fetched_at: null, market_cap: null, trailing_pe: null, dividend_yield: null,
    bar_count: 0, first_bar: null, last_bar: null, fetched_at: null, added_at: '',
  }
}

const universe = new Set(['AAPL', 'MSFT', 'GOOG', 'AMZN'])
const toDraft = (seed: { name: string; mode: 'shares' | 'weight'; cash: string; rows: Array<{ ticker: string; shares: string; weight: string }> }) => ({
  ...seed,
  rows: seed.rows.map((row, index) => ({ ...row, id: String(index) })),
})

function successful(text: string, tickers = universe) {
  const result = parsePortfolioCsv(text, tickers)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('portfolio CSV serialization', () => {
  it('round-trips an all-cash portfolio through summariseDraft', () => {
    const portfolio: Portfolio = {
      id: '1', name: 'Cash Only', cashWeight: 100, updatedAt: '2026-09-21T00:00:00Z', positions: [],
    }
    const result = successful(serializePortfolioCsv(portfolio), new Set())
    result.seed.name = portfolioNameFromFilename(portfolioCsvFilename(portfolio, new Date(2026, 8, 21)))
    const summary = summariseDraft(toDraft(result.seed), new Map())
    expect(result.seed.rows).toEqual([])
    expect(summary.cashWeight).toBe(100)
    expect(summary.canCreate).toBe(true)
  })

  it('round-trips irrational weights exactly through summariseDraft', () => {
    const weight = 100 / 3
    const portfolio: Portfolio = {
      id: '1', name: 'Thirds', cashWeight: 100 - 3 * weight, updatedAt: '2026-09-18T00:00:00Z',
      positions: ['AAPL', 'MSFT', 'GOOG'].map((ticker) => ({ ticker, weight })),
    }
    const result = successful(serializePortfolioCsv(portfolio))
    result.seed.name = portfolioNameFromFilename(portfolioCsvFilename(portfolio, new Date(2026, 8, 18)))
    const summary = summariseDraft(toDraft(result.seed), new Map())
    expect(result.seed.name).toBe(portfolio.name)
    expect(summary.cashWeight).toBe(portfolio.cashWeight)
    expect(summary.rows.map((row) => row.weight)).toEqual(portfolio.positions.map((position) => position.weight))
  })

  it('round-trips optional shares and a comma in the name', () => {
    const portfolio: Portfolio = {
      id: '1', name: 'Core, Equity', cashWeight: 50, updatedAt: '2026-09-18T00:00:00Z',
      positions: [{ ticker: 'AAPL', weight: 25, shares: 10 }, { ticker: 'MSFT', weight: 25 }],
    }
    const result = successful(serializePortfolioCsv(portfolio))
    result.seed.name = portfolioNameFromFilename(portfolioCsvFilename(portfolio, new Date(2026, 8, 18)))
    expect(result.seed).toMatchObject({
      name: 'Core, Equity', rows: [{ ticker: 'AAPL', shares: '10' }, { ticker: 'MSFT', shares: '' }],
    })

    const byTicker = new Map([['AAPL', entry('AAPL')], ['MSFT', entry('MSFT')]])
    const summary = summariseDraft(toDraft(result.seed), byTicker)
    expect(summary.rows.map((row) => row.shares)).toEqual([10, null])
  })

  it('round-trips an awkward stated cash value exactly', () => {
    const weight = 70 / 3
    const portfolio: Portfolio = {
      id: '1', name: 'Awkward Cash', cashWeight: 100 - 2 * weight, updatedAt: '2026-09-21T00:00:00Z',
      positions: [{ ticker: 'AAPL', weight }, { ticker: 'MSFT', weight }],
    }
    const result = successful(serializePortfolioCsv(portfolio))
    const summary = summariseDraft(toDraft(result.seed), new Map())
    expect(summary.cashWeight).toBe(portfolio.cashWeight)
  })

  it('strips a BOM and accepts CRLF exactly like LF', () => {
    const csv = 'ticker,weight_pct\nAAPL,25\nMSFT,75\n'
    expect(successful(`\uFEFF${csv}`)).toEqual(successful(csv))
    expect(successful(csv.replaceAll('\n', '\r\n'))).toEqual(successful(csv))
  })

  it('writes a plain CSV with a stable filename', () => {
    const portfolio: Portfolio = { id: '1', name: 'Core Equity', cashWeight: 50, updatedAt: '', positions: [{ ticker: 'AAPL', weight: 50 }] }
    expect(serializePortfolioCsv(portfolio).split('\n')[0]).toBe('ticker,weight_pct,shares')
    expect(portfolioCsvFilename(portfolio, new Date(2026, 8, 18))).toBe('Core Equity-2026-09-18.csv')
  })

  it('round-trips GunnPort’s name and exact weights through its filename', () => {
    const portfolio: Portfolio = {
      id: 'gunnport', name: 'GunnPort', cashWeight: 0, updatedAt: '',
      positions: [
        { ticker: 'MU', weight: 77.8037268463051 },
        { ticker: 'ORCL', weight: 11.152630234572266 },
        { ticker: 'VOO', weight: 11.043642919122638 },
      ],
    }
    const filename = portfolioCsvFilename(portfolio, new Date(2026, 8, 21))
    expect(filename).toBe('GunnPort-2026-09-21.csv')
    const result = successful(serializePortfolioCsv(portfolio), new Set(['MU', 'ORCL', 'VOO']))
    const seed = { ...result.seed, name: result.seed.name || portfolioNameFromFilename(filename) }
    const summary = summariseDraft(toDraft(seed), new Map())
    expect(seed.name).toBe('GunnPort')
    expect(summary.rows.map((row) => row.weight)).toEqual(portfolio.positions.map((position) => position.weight))
  })

  it('recovers names from exported filenames without stripping partial dates', () => {
    expect(portfolioNameFromFilename('GunnPort-2026-09-21.csv')).toBe('GunnPort')
    expect(portfolioNameFromFilename('GunnPort-2026-09-21 (1).csv')).toBe('GunnPort')
    expect(portfolioNameFromFilename('/Users/x/Downloads/My Core Equity-2026-09-21.csv')).toBe('My Core Equity')
    expect(portfolioNameFromFilename('holdings.csv')).toBe('holdings')
    expect(portfolioNameFromFilename('Q4-2026.csv')).toBe('Q4-2026')
    expect(portfolioNameFromFilename('.csv')).toBe('')
  })

  it('continues to read the legacy preamble and sanitizes unsafe filename characters', () => {
    const LEGACY_CSV = [
      '# Blue Eagle Portfolio v1',
      '# name: GunnPort',
      'ticker,weight_pct,shares',
      'MU,77.8037268463051,10',
      'ORCL,11.152630234572266,10',
      'VOO,11.043642919122638,2.08',
      'CASH,0,',
      '',
    ].join('\n')
    const legacy = LEGACY_CSV
    const result = parsePortfolioCsv(legacy, new Set(['MU', 'ORCL', 'VOO', 'PBR', 'SHNY', 'XIACF']))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seed.name).toBe('GunnPort')

    const unsafe: Portfolio = { id: 'unsafe', name: 'A/B:C', cashWeight: 100, updatedAt: '', positions: [] }
    expect(portfolioCsvFilename(unsafe, new Date(2026, 8, 21))).toBe('A B C-2026-09-21.csv')
  })
})

describe('portfolio CSV seeding modes', () => {
  it('accepts three-column exports', () => {
    const result = successful('ticker,weight_pct,shares\nAAPL,60,2\nCASH,40,\n')
    expect(result.seed).toEqual({
      name: '', mode: 'weight', cash: '40', rows: [{ ticker: 'AAPL', shares: '2', weight: '60' }],
    })
  })

  it('imports a legacy export with a basis_date column and ignores it', () => {
    const legacy = successful('ticker,weight_pct,shares,basis_date\nAAPL,60,2,\nCASH,40,,2026-01-02\n')
    const current = successful('ticker,weight_pct,shares\nAAPL,60,2\nCASH,40,\n')
    expect('basisDate' in legacy.seed).toBe(false)
    expect(legacy.seed.rows).toEqual(current.seed.rows)
    expect(legacy.seed.cash).toBe(current.seed.cash)
  })

  it('imports a legacy export whose basis_date is malformed', () => {
    expect(successful('ticker,weight_pct,shares,basis_date\nAAPL,60,2,\nCASH,40,,2026-02-30\n').seed.cash).toBe('40')
  })

  it('equal-weights ticker-only files over all survivors', () => {
    const result = successful('symbol\nAAPL\nMSFT\n')
    expect(result.seed).toMatchObject({ mode: 'weight', cash: '0' })
    expect(result.seed.rows.map((row) => row.weight)).toEqual([String(100 / 2), String(100 / 2)])
  })

  it('keeps percent weights verbatim and derives cash', () => {
    const result = successful('ticker,weight,shares\nAAPL,25,10\nMSFT,25,\n')
    expect(result.seed).toEqual({ name: '', mode: 'weight', cash: '50', rows: [{ ticker: 'AAPL', weight: '25', shares: '10' }, { ticker: 'MSFT', weight: '25', shares: '' }] })
  })

  it('uses shares mode when shares are the only allocation input', () => {
    const result = successful('ticker,quantity\nAAPL,10\nMSFT,20\n')
    expect(result.seed).toEqual({ name: '', mode: 'shares', cash: '', rows: [{ ticker: 'AAPL', weight: '', shares: '10' }, { ticker: 'MSFT', weight: '', shares: '20' }] })
  })

  it('adds dropped weighted allocations to cash', () => {
    const result = successful('ticker,weight\nAAPL,25\nZZZ,75\n')
    expect(result).toEqual({ ok: true, seed: { name: '', mode: 'weight', cash: '75', rows: [{ ticker: 'AAPL', shares: '', weight: '25' }] }, dropped: [{ ticker: 'ZZZ', weightPct: 75 }] })
  })

  it('equal-weights ticker-only survivors after drops', () => {
    const result = successful('ticker\nAAPL\nZZZ\nMSFT\n')
    expect(result.seed).toMatchObject({ cash: '0', rows: [{ weight: String(100 / 2) }, { weight: String(100 / 2) }] })
  })
})

describe('shares-only CSV cash', () => {
  it('reads CASH shares as dollars', () => {
    const result = successful('ticker,shares\nAAPL,10\nCASH,5000\n')
    expect(result.seed).toEqual({
      name: '', mode: 'shares', cash: '5000', rows: [{ ticker: 'AAPL', weight: '', shares: '10' }],
    })
    expect(result.dropped).toEqual([])
  })

  it('accepts zero dollars', () => {
    const result = successful('ticker,shares\nAAPL,10\nCASH,0\n')
    expect(result.seed.cash).toBe('0')
  })

  it('keeps dollars out of percentage total checks', () => {
    const result = successful('ticker,shares\nAAPL,10\nCASH,250\n')
    expect(result.seed.cash).toBe('250')
  })

  it.each([
    'ticker,quantity\nAAPL,10\nCASH,\n',
    'ticker,shares\nAAPL,10\nCASH,-5\n',
    'ticker,shares\nAAPL,10\nCASH,abc\n',
  ])('rejects invalid CASH dollar amount in %s', (csv) => {
    expect(parsePortfolioCsv(csv, universe)).toEqual({
      ok: false,
      error: 'CASH needs a dollar amount of zero or greater in the shares column',
      line: 3,
    })
  })

  it('accepts a cash-only shares file', () => {
    expect(parsePortfolioCsv('ticker,shares\nCASH,5000\n', universe)).toEqual({
      ok: true, seed: { name: '', mode: 'shares', cash: '5000', rows: [] }, dropped: [],
    })
  })

  it('keeps cash when dropping an off-universe ticker', () => {
    const result = successful('ticker,shares\nAAPL,10\nZZZ,5\nCASH,100\n')
    expect(result.seed.cash).toBe('100')
    expect(result.seed.rows).toEqual([{ ticker: 'AAPL', weight: '', shares: '10' }])
    expect(result.dropped).toEqual([{ ticker: 'ZZZ', weightPct: null }])
  })

  it('rejects duplicate CASH rows', () => {
    expect(parsePortfolioCsv('ticker,shares\nAAPL,10\nCASH,100\nCASH,200\n', universe)).toMatchObject({
      ok: false, error: 'Duplicate ticker: CASH', line: 4,
    })
  })

  it('keeps CASH weight validation for files with a weight column', () => {
    expect(parsePortfolioCsv('ticker,weight_pct,shares\nAAPL,60,2\nCASH,,5000\n', universe)).toMatchObject({
      ok: false, error: 'CASH needs a finite weight of zero or greater', line: 3,
    })
  })

  it('uses dollar cash in the dialog summary math', () => {
    const result = successful('ticker,shares\nAAPL,10\nCASH,5000\n')
    const summary = summariseDraft(
      toDraft({ ...result.seed, name: 'X' }),
      new Map([['AAPL', { ...entry('AAPL'), current_price: 100 }]]),
    )
    expect(summary.canCreate).toBe(true)
    expect(summary.cashWeight).toBeCloseTo(83.333333, 4)
    expect(summary.rows[0].weight).toBeCloseTo(16.666667, 4)
  })
})

describe('portfolio CSV whole-file rejections', () => {
  it('rejects empty and oversized input', () => {
    expect(parsePortfolioCsv('', universe)).toMatchObject({ ok: false, line: null })
    expect(parsePortfolioCsv(`ticker\n${'A'.repeat(1_000_000)}`, universe)).toMatchObject({ ok: false, line: null })
  })
  it('rejects a missing ticker header', () => expect(parsePortfolioCsv('name,weight\nAAPL,10', universe)).toMatchObject({ ok: false }))
  it('rejects zero data rows', () => expect(parsePortfolioCsv('ticker,weight\n\n', universe)).toMatchObject({ ok: false }))
  it('rejects duplicate tickers before dropping off-universe rows', () => expect(parsePortfolioCsv('ticker,weight\nZZZ,25\nzzz,25\nAAPL,50', universe)).toMatchObject({ ok: false, line: 3 }))
  it('rejects invalid weights', () => expect(parsePortfolioCsv('ticker,weight\nAAPL,nope', universe)).toMatchObject({ ok: false, line: 2 }))
  it('rejects invalid shares', () => expect(parsePortfolioCsv('ticker,shares\nAAPL,0', universe)).toMatchObject({ ok: false, line: 2 }))
  it('rejects totals over 100.01', () => expect(parsePortfolioCsv('ticker,weight\nAAPL,101', universe)).toMatchObject({ ok: false }))
  it('rejects stated CASH totals outside tolerance', () => expect(parsePortfolioCsv('ticker,weight\nAAPL,25\nCASH,25', universe)).toMatchObject({ ok: false, line: 3 }))
  it('rejects an empty ticker with another value', () => expect(parsePortfolioCsv('ticker,weight\n,25', universe)).toMatchObject({ ok: false, line: 2 }))
  it('rejects files where every position is outside the universe', () => expect(parsePortfolioCsv('ticker\nZZZ', universe)).toMatchObject({ ok: false, line: null }))
  it('rejects a file whose only named position is outside the universe', () => {
    expect(parsePortfolioCsv('ticker,weight\nZZZ,50\nCASH,50', universe)).toMatchObject({ ok: false, line: null })
  })
  it('rejects more than 5000 data rows', () => expect(parsePortfolioCsv(`ticker\n${Array.from({ length: 5001 }, () => 'AAPL').join('\n')}`, universe)).toMatchObject({ ok: false, line: 5002 }))
})

describe('optimization-result CSV imports', () => {
  it('uses target values from a dollar export', () => {
    const csv = 'ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned\nAAPL,200,10,2000,50,5,1000,25,-5,-1000,-25,false\nMSFT,400,5,2000,50,7.5,3000,75,2.5,1000,25,true\n'
    expect(parsePortfolioCsv(csv, universe)).toEqual({ ok: true, seed: { name: '', mode: 'weight', cash: '0', rows: [{ ticker: 'AAPL', weight: '25', shares: '5' }, { ticker: 'MSFT', weight: '75', shares: '7.5' }] }, dropped: [] })
  })

  it('imports weights-only exports', () => {
    const result = successful('ticker,current_pct,target_pct,change_pp,pinned\nAAPL,50,40,-10,false\nMSFT,50,60,10,true\n')
    expect(result.seed).toEqual({ name: '', mode: 'weight', cash: '0', rows: [{ ticker: 'AAPL', weight: '40', shares: '' }, { ticker: 'MSFT', weight: '60', shares: '' }] })
  })

  it('prefers target columns over canonical columns', () => {
    const result = successful('ticker,weight_pct,shares,target_pct,target_shares\nAAPL,50,10,20,4\nMSFT,50,10,80,16\n')
    expect(result.seed.rows).toEqual([{ ticker: 'AAPL', weight: '20', shares: '4' }, { ticker: 'MSFT', weight: '80', shares: '16' }])
  })

  it('rejects short target weights before negative share validation', () => {
    const csv = 'ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned\nMU,1080.53,10,10805.3,74.18,-0.657262,-710.19,-4.88,-10.657262,-11515.49,-79.06,false\nVOO,707.6,2.08,1471.81,10.1,20.261565,14337.08,98.43,18.181565,12865.27,88.33,false\nPBR,21.14,47,993.58,6.82,89.303,1887.87,12.96,42.303,894.29,6.14,false\nORCL,144.56,4.46,644.74,4.43,-4.189537,-605.64,-4.16,-8.649537,-1250.38,-8.58,false\nSHNY,8.81,68.84,606.48,4.16,-30.619489,-269.76,-1.85,-99.459489,-876.24,-6.02,false\nXIACF,3.345,13,43.49,0.3,-22.113077,-73.97,-0.51,-35.113077,-117.45,-0.81,false\n'
    expect(parsePortfolioCsv(csv, new Set(['MU', 'VOO', 'PBR', 'ORCL', 'SHNY', 'XIACF']))).toEqual({ ok: false, line: 2, error: "Short target weights can't be imported: MU (-4.88%), ORCL (-4.16%), SHNY (-1.85%), XIACF (-0.51%). Portfolios hold long positions only; re-run the optimizer with shorting turned off." })
  })

  it('leaves zero targets out without validating their shares', () => {
    const weights = successful('ticker,current_pct,target_pct,change_pp,pinned\nAAPL,30,0,-30,false\nMSFT,30,40,10,false\nGOOG,40,60,20,false\n')
    expect(weights.seed).toMatchObject({ cash: '0', rows: [{ ticker: 'MSFT', weight: '40' }, { ticker: 'GOOG', weight: '60' }] })
    expect(weights.dropped).toEqual([])
    expect(weights.zeroTargets).toEqual(['AAPL'])
    const dollars = successful('ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned\nAAPL,100,3,300,30,0,0,0,-3,-300,-30,false\nMSFT,100,7,700,70,10,1000,100,3,300,30,false\n')
    expect(dollars.seed.rows).toEqual([{ ticker: 'MSFT', weight: '100', shares: '10' }])
  })

  it('trims a rounding-sized target overshoot from the largest survivor', () => {
    const csv = 'ticker,current_pct,target_pct,change_pp,pinned\nAAPL,20,40.01,20.01,false\nMSFT,20,30.01,10.01,false\nGOOG,20,20,0,false\nAMZN,20,5,-15,false\nNVDA,20,5,-15,false\n'
    const result = successful(csv, new Set(['AAPL', 'MSFT', 'GOOG', 'AMZN', 'NVDA']))
    expect(result.seed.cash).toBe('0')
    expect(result.seed.rows[0].weight).toBe('39.99')
    expect(result.adjustment).toMatchObject({ ticker: 'AAPL', fromPct: 40.01, toPct: 39.99 })
    expect(result.adjustment?.fileTotalPct).toBeCloseTo(100.02, 9)
  })

  it('rejects target overshoot beyond export rounding', () => {
    expect(parsePortfolioCsv('ticker,target_pct\nAAPL,60.02\nMSFT,40.02\n', universe)).toEqual({ ok: false, line: null, error: 'Target weights add up to 100.04%, which is more than export rounding can explain.' })
  })

  it('rejects non-finite target weights', () => {
    expect(parsePortfolioCsv('ticker,target_pct\nAAPL,abc\nMSFT,100\n', universe)).toEqual({ ok: false, line: 2, error: 'Target weight for AAPL must be a number' })
  })
})
