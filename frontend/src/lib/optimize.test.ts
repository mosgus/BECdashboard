import { describe, expect, it } from 'vitest'
import type { Frontier, OptimizeResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import { parsePortfolioCsv } from './portfolioCsv'
import {
  DEFAULT_SETTINGS,
  applyBlockedText,
  applyConfirmLines,
  applyPlan,
  buildOptimizeRequest,
  canOptimize,
  cashAfterDeploy,
  cashSplit,
  curveRows,
  frontierChartData,
  frontierNote,
  deployedInvestedValue,
  formatChangePp,
  formatMoney,
  formatSignedMoney,
  formatSignedShares,
  formatWeight,
  metricItems,
  modeLabel,
  pinnedBannerLines,
  runSummary,
  customLookbackDays, presetLookbackDate, customLookbackError, lookbackLabel,
  type LookbackFloor,
  sameSettings,
  scoreWindowNote,
  tradeBasis,
  tradeBasisNote,
  tradeRows,
  weightRows,
  optimizeCsv,
  optimizeCsvFilename,
  portfolioShareRows,
} from './optimize'

const RESPONSE: OptimizeResponse = {
  tickers: ['AAA', 'BBB', 'YNG'],
  current_weights: { AAA: 0.5, BBB: 0.3, YNG: 0.2 },
  target_weights: { AAA: 0.62, BBB: 0.18, YNG: 0.2 },
  implied_trades: { AAA: 0.12, BBB: -0.12, YNG: 0 },
  pinned: [{ ticker: 'YNG', first_bar: '2026-03-02', weight: 0.2, exceeds_max: true }],
  fit_start: '2021-09-27', fit_end: '2026-09-23',
  score_start: '2026-03-02', score_limited_by: 'YNG',
  curves: {
    dates: ['2026-03-02', '2026-03-03', '2026-03-04'],
    current: [100, 101.5, 99.8], optimized: [100, 102.25, 100.4], benchmark: [100, 100.9, 99.1],
  },
  metrics: {
    current: { cagr: 0.1234, vol: 0.2071, sharpe: 0.5958, max_dd: -0.1826, beta: 1.1, alpha: -0.0123 },
    optimized: { cagr: 0.15, vol: 0.19, sharpe: null, max_dd: -0.1 },
  },
  feasible: true, mode: 'min_variance', rebalance: 'none',
  lookback_days: 1825,
  rf: 0.0427,
  rf_source: 'live',
  warnings: ['In-sample: the optimized weights were chosen using the same prices they are scored on.'],
  frontier: null,
}
const PORTFOLIO: Portfolio = {
  id: 'p1', name: 'Test', cashWeight: 10, updatedAt: '2026-09-24T00:00:00Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 3 }, { ticker: 'BBB', weight: 27 }, { ticker: 'YNG', weight: 18 }],
}
const DOLLAR_PORTFOLIO: Portfolio = {
  id: 'p2', name: 'Dollar / Test', cashWeight: 10, updatedAt: '2026-09-24T00:00:00Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 27, shares: 20 }, { ticker: 'YNG', weight: 18, shares: 4 }],
}
const CLOSES = new Map<string, number | null>([['AAA', 45], ['BBB', 13.5], ['YNG', 45]])
const DOLLAR_BASIS = { kind: 'dollar', investedValue: 900, prices: { AAA: 45, BBB: 13.5, YNG: 45 }, shares: { AAA: 10, BBB: 20, YNG: 4 } } as const
const SHARES_BASED: Portfolio = {
  id: 'sb', name: 'Shares', cashWeight: 10, cashDollars: 100, updatedAt: '2026-09-30T00:00:00.000Z',
  positions: [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }],
}
const SB_CLOSES = new Map<string, number | null>([['AAA', 45], ['BBB', 15]])
const SB_RESPONSE = { tickers: ['AAA', 'BBB'], target_weights: { AAA: 0.6, BBB: 0.4 }, feasible: true }
const FRONTIER: Frontier = {
  points: [{ vol: 0.1, ret: 0.05 }, { vol: 0.2, ret: 0.1 }],
  cloud: [{ vol: 0.12, ret: 0.06 }],
  current: { vol: 0.18, ret: 0.06 },
  optimized: { vol: 0.1, ret: 0.05 },
  min_variance: { vol: 0.1, ret: 0.05 },
  max_sharpe: null,
  tickers: ['AAA', 'BBB'],
  excluded: [],
}

describe('efficient frontier helpers', () => {
  it('maps annualized fractions to percent chart data and omits a missing Max Sharpe marker', () => {
    const data = frontierChartData(FRONTIER, 'Min Variance')
    expect(data.curve).toEqual([{ vol: 10, ret: 5 }, { vol: 20, ret: 10 }])
    expect(data.cloud).toEqual([{ vol: 12, ret: 6 }])
    expect(data.markers.map((marker) => marker.name)).toEqual([
      'Current', 'Optimized (Min Variance)', 'Min Variance',
    ])
  })

  it('includes Max Sharpe and describes excluded short-history holdings', () => {
    const withSharpe = { ...FRONTIER, max_sharpe: { vol: 0.15, ret: 0.08 } }
    expect(frontierChartData(withSharpe, 'Min Variance').markers.at(-1)).toEqual({
      name: 'Max Sharpe', vol: 15, ret: 8,
    })
    expect(frontierNote(FRONTIER)).toBeNull()
    expect(frontierNote({ ...FRONTIER, excluded: ['YYY'] })).toBe(
      'Covers AAA, BBB only. YYY is left out for short history, so these points show the other holdings\' mix, scaled to 100%.',
    )
  })
})

describe('cashSplit', () => {
  it('uses fixed cash dollars to size deployed holdings', () => {
    const split = cashSplit(900, 10, 5, 100)
    expect(split.cashBeforeDollars).toBeCloseTo(100, 6)
    expect(split.cashAfterDollars).toBeCloseTo(50, 6)
    expect(split.sizedValue).toBeCloseTo(950, 6)
  })

  it('uses cash dollars when the percentage snapshot has drifted', () => {
    const split = cashSplit(900, 12, 6, 100)
    expect(split.cashBeforeDollars).toBeCloseTo(100, 6)
    expect(split.cashAfterDollars).toBeCloseTo(50, 6)
    expect(split.sizedValue).toBeCloseTo(950, 6)
    expect(split.sizedValue).not.toBeCloseTo(961.363636, 6)
  })

  it('infers cash from percentages when fixed dollars are absent', () => {
    const split = cashSplit(900, 10, 5)
    expect(split.cashBeforeDollars).toBeCloseTo(100, 6)
    expect(split.cashAfterDollars).toBeCloseTo(50, 6)
    expect(split.sizedValue).toBeCloseTo(950, 6)
    expect(split.sizedValue).toBeCloseTo(deployedInvestedValue(900, 10, 5), 6)
  })

  it('handles zero cash and zero cash weight', () => {
    const split = cashSplit(900, 0, 0, 0)
    expect(split.cashBeforeDollars).toBe(0)
    expect(split.cashAfterDollars).toBe(0)
    expect(split.sizedValue).toBeCloseTo(900, 6)
  })
})

describe('custom lookback floors', () => {
  const today = new Date(2026, 9, 1)
  const mc: LookbackFloor = { days: 89, label: '3 months' }

  it('uses the supplied floor while retaining the default', () => {
    expect(customLookbackError('2026-07-05', today, mc)).toBe('Choose a date at least 3 months ago.')
    expect(customLookbackError('2026-07-04', today, mc)).toBeNull()
    expect(customLookbackError('2026-09-04', today)).toBe('Choose a date at least 4 weeks ago.')
  })

  it('always permits 3M and blocks 1M at the Monte Carlo floor', () => {
    for (const year of [2027, 2028]) {
      const days = year === 2028 ? 366 : 365
      for (let index = 0; index < days; index += 1) {
        const date = new Date(year, 0, 1 + index)
        expect(customLookbackDays(presetLookbackDate('3M', date), date)).toBeGreaterThanOrEqual(89)
        expect(customLookbackDays(presetLookbackDate('1M', date), date)).toBeLessThan(89)
      }
    }
  })
})

describe('buildOptimizeRequest', () => {
  it('builds the default request from a portfolio', () => {
    const req = buildOptimizeRequest(PORTFOLIO, DEFAULT_SETTINGS)
    expect(req).toEqual({
      tickers: ['AAA', 'BBB', 'YNG'], weights: [45, 27, 18], mode: 'min_variance',
      lookback_days: 365, max_weight: 1, min_weight: 0, vol_target: 0.1,
      allow_short: false, max_short: 0.3, rebalance: 'none',
    })
  })

  it('scales percentages and honours allow_short for min_weight', () => {
    const settings = {
      ...DEFAULT_SETTINGS, mode: 'target_volatility' as const, lookbackDays: 730,
      maxWeightPct: 40, minWeightPct: 5, volTargetPct: 15, allowShort: true, rebalance: 'monthly' as const,
    }
    const req = buildOptimizeRequest(PORTFOLIO, settings)
    expect(req.max_weight).toBe(0.4)
    expect(req.min_weight).toBe(0)
    expect(req.vol_target).toBe(0.15)
    expect(req.allow_short).toBe(true)
    expect(req.max_short).toBe(0.3)
    expect(req.lookback_days).toBe(730)
    expect(req.rebalance).toBe('monthly')

    const reqLong = buildOptimizeRequest(PORTFOLIO, { ...settings, allowShort: false })
    expect(reqLong.min_weight).toBe(0.05)
    expect(buildOptimizeRequest(PORTFOLIO, { ...settings, maxShortPct: 50 }).max_short).toBe(.5)
    expect(buildOptimizeRequest(PORTFOLIO, { ...settings, allowShort: false, maxShortPct: 50 }).max_short).toBe(.5)
  })

  it('uses share-implied weights for a dollar basis and stored weights otherwise', () => {
    expect(buildOptimizeRequest(DOLLAR_PORTFOLIO, DEFAULT_SETTINGS, DOLLAR_BASIS).weights).toEqual([450, 270, 180])
    expect(buildOptimizeRequest(DOLLAR_PORTFOLIO, DEFAULT_SETTINGS, { kind: 'weights', reason: 'no-shares' }).weights).toEqual([45, 27, 18])
  })
})

describe('tradeBasis', () => {
  it('returns a dollar basis for matching shares, prices and weights', () => {
    expect(tradeBasis(DOLLAR_PORTFOLIO, CLOSES)).toEqual(DOLLAR_BASIS)
  })

  it('returns each weights fallback in its required order', () => {
    expect(tradeBasis(PORTFOLIO, CLOSES)).toEqual({ kind: 'weights', reason: 'no-shares' })
    expect(tradeBasis(DOLLAR_PORTFOLIO, new Map([['AAA', 45], ['BBB', 13.5]]))).toEqual({ kind: 'weights', reason: 'no-price' })
    expect(tradeBasis(DOLLAR_PORTFOLIO, new Map([...CLOSES, ['YNG', null]]))).toEqual({ kind: 'weights', reason: 'no-price' })
    expect(tradeBasis({ ...DOLLAR_PORTFOLIO, positions: DOLLAR_PORTFOLIO.positions.map((position) => position.ticker === 'BBB' ? { ...position, shares: 21 } : position) }, CLOSES)).toEqual({ kind: 'weights', reason: 'shares-mismatch' })
  })
})

describe('applyPlan', () => {
  it('clears mixed share counts while applying weights', () => {
    const plan = applyPlan(PORTFOLIO, RESPONSE, CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('cleared')
    expect(plan.removed).toEqual([])
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([55.8, 16.2, 18])
    expect(plan.portfolio.positions.every((position) => !('shares' in position))).toBe(true)
    expect(plan.portfolio).toMatchObject({ id: PORTFOLIO.id, name: PORTFOLIO.name, cashWeight: 10, updatedAt: PORTFOLIO.updatedAt })
  })

  it('applies weights without creating shares when none exist', () => {
    const noShares = { ...PORTFOLIO, positions: PORTFOLIO.positions.map(({ ticker, weight }) => ({ ticker, weight })) }
    const plan = applyPlan(noShares, RESPONSE, CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('none')
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([55.8, 16.2, 18])
    expect(plan.portfolio.positions.every((position) => !('shares' in position))).toBe(true)
  })

  it('recomputes all shares from invested value', () => {
    const plan = applyPlan(DOLLAR_PORTFOLIO, RESPONSE, CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('recomputed')
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([55.8, 16.2, 18])
    plan.portfolio.positions.forEach((position, index) => expect(position.shares).toBeCloseTo([12.4, 12, 4][index], 6))
  })

  it('recomputes mismatched shares from their actual invested value', () => {
    const mismatched = { ...DOLLAR_PORTFOLIO, positions: DOLLAR_PORTFOLIO.positions.map((position) => position.ticker === 'BBB' ? { ...position, shares: 21 } : position) }
    const plan = applyPlan(mismatched, RESPONSE, CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('recomputed')
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([55.8, 16.2, 18])
    plan.portfolio.positions.forEach((position, index) => expect(position.shares).toBeCloseTo([12.586, 12.18, 4.06][index], 6))
  })

  it('removes zero and solver-noise target holdings', () => {
    const mixedPlan = applyPlan(PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.8, BBB: -1e-12, YNG: 0.2 } }, CLOSES)
    if (!mixedPlan.ok) throw new Error(mixedPlan.reason)
    expect(mixedPlan).toMatchObject({ sharesMode: 'cleared', removed: ['BBB'] })
    expect(mixedPlan.portfolio.positions.map((position) => [position.ticker, position.weight])).toEqual([['AAA', 72], ['YNG', 18]])
    const dollarPlan = applyPlan(DOLLAR_PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.8, BBB: 0.0004, YNG: 0.2 } }, CLOSES)
    if (!dollarPlan.ok) throw new Error(dollarPlan.reason)
    expect(dollarPlan.removed).toEqual(['BBB'])
    expect(dollarPlan.portfolio.positions.map((position) => position.weight)).toEqual([72, 18])
    dollarPlan.portfolio.positions.forEach((position, index) => expect(position.shares).toBeCloseTo([16, 4][index], 6))
  })

  it('reports each blocked reason', () => {
    expect(applyPlan(PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.9, BBB: -0.1, YNG: 0.2 } }, CLOSES)).toEqual({ ok: false, reason: 'short' })
    expect(applyPlan(PORTFOLIO, { ...RESPONSE, feasible: false }, CLOSES)).toEqual({ ok: false, reason: 'infeasible' })
    expect(applyPlan({ ...PORTFOLIO, positions: PORTFOLIO.positions.slice(0, 2) }, RESPONSE, CLOSES)).toEqual({ ok: false, reason: 'tickers-changed' })
    expect(applyPlan(DOLLAR_PORTFOLIO, RESPONSE, new Map([['AAA', 45], ['BBB', 13.5]]))).toEqual({ ok: false, reason: 'no-price' })
  })

  it('does not require prices for weights-only modes', () => {
    const plan = applyPlan(PORTFOLIO, RESPONSE, new Map())
    expect(plan.ok && plan.sharesMode).toBe('cleared')
  })

  it('explains every block reason', () => {
    expect(applyBlockedText('tickers-changed')).toBe("This portfolio's holdings changed after the run. Run the optimizer again.")
    expect(applyBlockedText('infeasible')).toBe('The optimizer did not converge, so there is nothing to apply.')
    expect(applyBlockedText('short')).toBe("Short positions can't be saved to a portfolio. Turn off Allow short and run again.")
    expect(applyBlockedText('no-price')).toBe("A holding has no stored closing price, so its new share count can't be worked out.")
    expect(applyBlockedText('invalid')).toBe("These weights don't make a valid portfolio, so they can't be applied.")
  })

  it('describes every apply confirmation shape', () => {
    const cleared = applyPlan(PORTFOLIO, RESPONSE, CLOSES)
    const recomputed = applyPlan(DOLLAR_PORTFOLIO, RESPONSE, CLOSES)
    const none = applyPlan({ ...PORTFOLIO, positions: PORTFOLIO.positions.map(({ ticker, weight }) => ({ ticker, weight })) }, RESPONSE, CLOSES)
    const removed = applyPlan(PORTFOLIO, { ...RESPONSE, target_weights: { AAA: 0.8, BBB: -1e-12, YNG: 0.2 } }, CLOSES)
    if (!cleared.ok || !recomputed.ok || !none.ok || !removed.ok) throw new Error('expected plans')
    expect(applyConfirmLines(cleared)).toEqual(['Holdings weights will be replaced by the Optimized column. Cash stays at 10.0%.', 'Only some holdings have share counts, so all share counts will be removed.', 'There is no undo.'])
    expect(applyConfirmLines(recomputed)[1]).toBe("Share counts will be recalculated from each holding's last stored close, as fractional shares.")
    expect(applyConfirmLines(none)).toHaveLength(2)
    expect(applyConfirmLines(removed)[2]).toBe('BBB has a 0.0% target and will be removed from the portfolio.')
    expect(applyConfirmLines({ ...cleared, removed: ['AAA', 'BBB', 'CCC'] })[2]).toBe('AAA, BBB and CCC have a 0.0% target and will be removed from the portfolio.')
  })
})

describe('applyPlan for shares-based portfolios', () => {
  it('uses stored cash dollars rather than the drifted cash percentage snapshot', () => {
    const portfolio: Portfolio = { ...SHARES_BASED, cashWeight: 12, positions: SHARES_BASED.positions.map((position) => ({ ...position, weight: 44 })) }
    const plan = applyPlan(portfolio, SB_RESPONSE, SB_CLOSES, 6)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.portfolio.cashDollars).toBeCloseTo(50, 6)
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(12.666667, 6)
    expect(plan.portfolio.positions[1].shares).toBeCloseTo(25.333333, 6)
  })

  it('keeps cash dollars and sizes shares from dollars when no cash is deployed', () => {
    const plan = applyPlan(SHARES_BASED, SB_RESPONSE, SB_CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('recomputed')
    expect(plan.portfolio.cashDollars).toBeCloseTo(100, 6)
    expect(plan.portfolio.cashWeight).toBe(10)
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(12, 6)
    expect(plan.portfolio.positions[1].shares).toBeCloseTo(24, 6)
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([54, 36])
  })

  it('reduces cash dollars and adds the deployed amount to the holdings', () => {
    const plan = applyPlan(SHARES_BASED, SB_RESPONSE, SB_CLOSES, 5)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.portfolio.cashDollars).toBeCloseTo(50, 6)
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(12.666667, 6)
    expect(plan.portfolio.positions[1].shares).toBeCloseTo(25.333333, 6)
    expect(plan.portfolio.positions.map((position) => position.weight)).toEqual([57, 38])
    expect(applyConfirmLines(plan)).toContain('Cash will be $50.00 and stays fixed; weights are re-marked from share counts at the next price load.')
    expect(applyConfirmLines(plan).at(-1)).toBe('There is no undo.')
  })

  it('keeps a present zero cashDollars value when all cash is deployed', () => {
    const plan = applyPlan(SHARES_BASED, SB_RESPONSE, SB_CLOSES, 0)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.portfolio.cashDollars).toBeCloseTo(0, 6)
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(13.333333, 6)
    expect(plan.portfolio.positions[1].shares).toBeCloseTo(26.666667, 6)
  })

  it('sizes only retained holdings and preserves cash when a target is zero', () => {
    const plan = applyPlan(SHARES_BASED, { ...SB_RESPONSE, target_weights: { AAA: 1, BBB: 0 } }, SB_CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.portfolio.positions.map((position) => position.ticker)).toEqual(['AAA'])
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(20, 6)
    expect(plan.portfolio.cashDollars).toBeCloseTo(100, 6)
    expect(plan.removed).toEqual(['BBB'])
  })

  it('keeps weight-based portfolios on the existing deployment path', () => {
    const { cashDollars: _cashDollars, ...weightBased } = SHARES_BASED
    const plan = applyPlan(weightBased, SB_RESPONSE, SB_CLOSES, 5)
    if (!plan.ok) throw new Error(plan.reason)
    expect('cashDollars' in plan.portfolio).toBe(false)
    expect(plan.portfolio.positions[0].shares).toBeCloseTo(12.666667, 6)
  })

  it('drops cashDollars when incomplete shares cause share counts to be cleared', () => {
    const portfolio = { ...SHARES_BASED, positions: [SHARES_BASED.positions[0], { ticker: 'BBB', weight: 45 }] }
    const plan = applyPlan(portfolio, SB_RESPONSE, SB_CLOSES)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.sharesMode).toBe('cleared')
    expect('cashDollars' in plan.portfolio).toBe(false)
  })
})

describe('trades and exports', () => {
  it('calculates share and dollar trades from the response', () => {
    const rows = tradeRows(RESPONSE, DOLLAR_BASIS)
    expect(rows.map((row) => row.ticker)).toEqual(['AAA', 'BBB', 'YNG'])
    expect(rows.map((row) => row.pinned)).toEqual([false, false, true])
    expect(rows[0]).toMatchObject({ price: 45, currentShares: 10, currentValue: 450, targetValue: 558 })
    expect(rows[1]).toMatchObject({ price: 13.5, currentShares: 20, currentValue: 270, targetValue: 162 })
    expect(rows[2]).toMatchObject({ price: 45, currentShares: 4, currentValue: 180, targetValue: 180 })
    expect(rows.map((row) => row.targetShares)).toEqual([12.4, 12, 4])
    expect(rows.map((row) => row.tradeShares)).toEqual([expect.closeTo(2.4, 6), expect.closeTo(-8, 6), expect.closeTo(0, 6)])
    expect(rows.map((row) => row.tradeValue)).toEqual([108, -108, 0])
  })

  it('formats money and signed shares', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(formatMoney(-108)).toBe('-$108.00')
    expect(formatMoney(0.004)).toBe('$0.00')
    expect(formatSignedMoney(108)).toBe('+$108.00')
    expect(formatSignedMoney(-108)).toBe('-$108.00')
    expect(formatSignedMoney(0.004)).toBe('$0.00')
    expect(formatSignedShares(2.4)).toBe('+2.4')
    expect(formatSignedShares(-8)).toBe('-8')
    expect(formatSignedShares(1e-9)).toBe('0')
    expect(formatSignedShares(1234.5678901)).toBe('+1,234.56789')
  })

  it('explains the trade basis', () => {
    expect(tradeBasisNote(DOLLAR_BASIS)).toBe("Trades use each holding's last stored close and fractional shares, on $900.00 invested. Cash is left as it is.")
    expect(tradeBasisNote({ kind: 'weights', reason: 'no-shares' })).toBe('Add a share count to every holding to see share and dollar trades.')
    expect(tradeBasisNote({ kind: 'weights', reason: 'no-price' })).toBe('A holding has no stored closing price, so trades are shown as weights only.')
    expect(tradeBasisNote({ kind: 'weights', reason: 'shares-mismatch' })).toBe("Share counts don't match the weights within 0.5 points, so trades are shown as weights only.")
  })

  it('exports the dollar table shape', () => {
    expect(optimizeCsv(RESPONSE, DOLLAR_BASIS)).toBe(
      'ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned\nAAA,45,10,450,50,12.4,558,62,2.4,108,12,false\nBBB,13.5,20,270,30,12,162,18,-8,-108,-12,false\nYNG,45,4,180,20,4,180,20,0,0,0,true\n',
    )
  })

  it('exports target shares using the same fixed cash dollars as Apply', () => {
    const response: OptimizeResponse = {
      ...RESPONSE,
      tickers: ['AAA', 'BBB'],
      current_weights: { AAA: 0.5, BBB: 0.5 },
      target_weights: { AAA: 0.6, BBB: 0.4 },
      implied_trades: { AAA: 0.1, BBB: -0.1 },
      pinned: [],
    }
    const basis = { kind: 'dollar', investedValue: 900, prices: { AAA: 45, BBB: 15 }, shares: { AAA: 10, BBB: 30 } } as const
    const portfolio: Portfolio = { ...SHARES_BASED, cashWeight: 12, positions: SHARES_BASED.positions.map((position) => ({ ...position, weight: 44 })) }
    const applied = applyPlan(portfolio, response, SB_CLOSES, 6)
    if (!applied.ok) throw new Error(applied.reason)
    const csv = optimizeCsv(response, basis, 12, 6, 100)
    const aaaCsv = csv.split('\n').find((row) => row.startsWith('AAA,'))?.split(',')
    expect(Number(aaaCsv?.[5])).toBeCloseTo(applied.portfolio.positions[0].shares!, 6)
  })

  it('exports the weights table shape', () => {
    expect(optimizeCsv(RESPONSE, { kind: 'weights', reason: 'no-shares' })).toBe('ticker,current_pct,target_pct,change_pp,pinned\nAAA,50,62,12,false\nBBB,30,18,-12,false\nYNG,20,20,0,true\n')
  })

  it('names exported optimization tables', () => {
    expect(optimizeCsvFilename('Dollar / Test', 'min_variance', new Date(2026, 8, 24))).toBe('Dollar Test-optimize-min_variance-2026-09-24.csv')
    expect(optimizeCsvFilename('   ', 'max_sharpe', new Date(2026, 8, 24))).toBe('portfolio-optimize-max_sharpe-2026-09-24.csv')
  })
})

describe('canOptimize', () => {
  it('requires at least 2 positions', () => {
    expect(canOptimize(PORTFOLIO)).toBe(true)
    expect(canOptimize({ ...PORTFOLIO, positions: PORTFOLIO.positions.slice(0, 1) })).toBe(false)
  })
})

describe('sameSettings', () => {
  it('compares all 8 fields', () => {
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(true)
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, rebalance: 'monthly' })).toBe(false)
    expect(sameSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, maxShortPct: 50 })).toBe(false)
  })
})

describe('formatWeight', () => {
  it('formats fractions as percent strings', () => {
    expect(formatWeight(0.62)).toBe('62.0%')
    expect(formatWeight(0.1234)).toBe('12.3%')
    expect(formatWeight(-0.05)).toBe('-5.0%')
    expect(formatWeight(-0.0004)).toBe('0.0%')
    expect(formatWeight(0)).toBe('0.0%')
  })
})

describe('formatChangePp', () => {
  it('formats fractions as signed percentage-point strings', () => {
    expect(formatChangePp(0.12)).toBe('+12.0 pp')
    expect(formatChangePp(-0.12)).toBe('-12.0 pp')
    expect(formatChangePp(0)).toBe('0.0 pp')
    expect(formatChangePp(0.0004)).toBe('0.0 pp')
    expect(formatChangePp(-0.0004)).toBe('0.0 pp')
  })
})

describe('weightRows', () => {
  it('zips tickers with current, target, change and pinned', () => {
    expect(weightRows(RESPONSE)).toEqual([
      { ticker: 'AAA', current: 0.5, target: 0.62, change: 0.12, pinned: false },
      { ticker: 'BBB', current: 0.3, target: 0.18, change: -0.12, pinned: false },
      { ticker: 'YNG', current: 0.2, target: 0.2, change: 0, pinned: true },
    ])
  })
})

describe('curveRows', () => {
  it('zips curves by index, with benchmark null when absent', () => {
    const rows = curveRows(RESPONSE.curves)
    expect(rows.map((row) => row.date)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04'])
    rows.forEach((row, index) => {
      expect(row.current).toBeCloseTo([0, 1.5, -0.2][index], 6)
      expect(row.optimized).toBeCloseTo([0, 2.25, 0.4][index], 6)
      expect(row.benchmark).toBeCloseTo([0, 0.9, -0.9][index], 6)
    })
    const noBenchmark = curveRows({ ...RESPONSE.curves, benchmark: null })
    expect(noBenchmark.every((row) => row.benchmark === null)).toBe(true)
  })

  it('downsamples using the default maximum', () => {
    const dates = Array.from({ length: 1000 }, (_, i) => `d${i}`)
    const values = Array.from({ length: 1000 }, (_, i) => 100 + i)
    const rows = curveRows({ dates, current: values, optimized: values, benchmark: null })
    expect(rows.length).toBe(334)
    expect(rows.at(-1)?.date).toBe('d999')
  })
})

describe('metricItems', () => {
  it('includes beta and alpha when present', () => {
    const items = metricItems(RESPONSE.metrics.current, .0427, 'live')
    expect(items.map((item) => item.label)).toEqual(['CAGR', 'Volatility', 'Sharpe', 'Max drawdown', 'Beta vs SPY', 'Alpha'])
    expect(items.map((item) => item.value)).toEqual(['12.3%', '20.7%', '0.60', '-18.3%', '1.10', '-1.2%'])
  })

  it('omits beta and alpha when absent, and renders — for null/missing/empty', () => {
    const optimized = metricItems(RESPONSE.metrics.optimized, .0427, 'live')
    expect(optimized.map((item) => item.value)).toEqual(['15.0%', '19.0%', '—', '-10.0%'])

    expect(metricItems(null, .0427, 'live').map((item) => item.value)).toEqual(['—', '—', '—', '—'])
    expect(metricItems({}, .0427, 'live').map((item) => item.value)).toEqual(['—', '—', '—', '—'])

    const withNullBeta = metricItems({ cagr: 0.1, vol: 0.2, sharpe: 0.5, max_dd: -0.1, beta: null }, .0427, 'live')
    expect(withNullBeta.length).toBe(5)
    expect(withNullBeta.at(-1)).toEqual({ label: 'Beta vs SPY', value: '—', tooltip: expect.any(String) })
  })

  it('describes the risk-free rate as live, with the 3-month T-bill wording', () => {
    const items = metricItems(RESPONSE.metrics.current, 0.0407, 'live')
    expect(items.find((item) => item.label === 'Sharpe')?.tooltip).toContain('3-month Treasury bill yield, 4.07% for this run')
  })

  it('describes the risk-free rate as a fallback in both Sharpe and Alpha tooltips', () => {
    const items = metricItems(RESPONSE.metrics.current, 0.0427, 'fallback')
    expect(items.find((item) => item.label === 'Sharpe')?.tooltip).toContain('live rate unavailable, so the 4.27% fallback was used')
    expect(items.find((item) => item.label === 'Alpha')?.tooltip).toContain('live rate unavailable, so the 4.27% fallback was used')
  })
})

describe('pinnedBannerLines', () => {
  it('names the pinned holding and its exceeds_max status', () => {
    expect(pinnedBannerLines(RESPONSE.pinned, 15)).toEqual([
      'YNG: prices start 2026-03-02, so it is held at its current 20.0% and not optimized. That is above the 15% max weight.',
    ])
    expect(pinnedBannerLines([{ ...RESPONSE.pinned[0], exceeds_max: false }], 15)).toEqual([
      'YNG: prices start 2026-03-02, so it is held at its current 20.0% and not optimized.',
    ])
    expect(pinnedBannerLines([], 15)).toEqual([])
  })
})

describe('scoreWindowNote', () => {
  it('describes the score window when limited, else null', () => {
    expect(scoreWindowNote(RESPONSE)).toBe(
      "The curves start 2026-03-02, when YNG's price history begins. The weights were fitted on 2021-09-27 → 2026-09-23.",
    )
    expect(scoreWindowNote({ ...RESPONSE, score_limited_by: null })).toBe(null)
  })
})

describe('runSummary', () => {
  it('summarises mode, lookback, rebalance and fit window', () => {
    expect(runSummary(RESPONSE)).toBe('Min Variance · 5Y lookback · buy and hold · fitted 2021-09-27 → 2026-09-23')
    expect(runSummary({ ...RESPONSE, lookback_days: 365, rebalance: 'quarterly' })).toBe(
      'Min Variance · 1Y lookback · rebalanced quarterly · fitted 2021-09-27 → 2026-09-23',
    )
  })

  it('falls back to the raw mode string when unlisted', () => {
    expect(modeLabel('not_a_mode')).toBe('not_a_mode')
  })

  it('labels a custom lookback', () => expect(runSummary({ ...RESPONSE, lookback_days: 183 })).toContain('183-day lookback'))
})

describe('custom lookback helpers', () => {
  const today = new Date(2026, 9, 1)
  it('handles calendar presets and validation', () => {
    expect(customLookbackDays('2026-07-01', today)).toBe(92)
    expect(presetLookbackDate('1M', today)).toBe('2026-09-01'); expect(presetLookbackDate('3M', today)).toBe('2026-07-01'); expect(presetLookbackDate('6M', today)).toBe('2026-04-01'); expect(presetLookbackDate('YTD', today)).toBe('2026-01-01')
    expect(presetLookbackDate('3M', new Date(2026, 4, 31))).toBe('2026-02-28'); expect(presetLookbackDate('1M', new Date(2026, 2, 31))).toBe('2026-02-28')
    expect(customLookbackError('2026-09-03', today)).toBeNull(); expect(customLookbackError('2026-09-04', today)).toBe('Choose a date at least 4 weeks ago.'); expect(customLookbackError('2026-12-01', today)).toBe('Choose a date at least 4 weeks ago.'); expect(customLookbackError('2015-01-01', today)).toBe('Choose a date within the last 10 years.'); expect(customLookbackError('', today)).toBe('Choose a start date.')
    expect(customLookbackError(presetLookbackDate('1M', new Date(2026, 2, 1)), new Date(2026, 2, 1))).toBeNull(); expect(customLookbackError(presetLookbackDate('YTD', new Date(2026, 0, 20)), new Date(2026, 0, 20))).toBe('Choose a date at least 4 weeks ago.')
    expect([lookbackLabel(1825), lookbackLabel(730), lookbackLabel(183)]).toEqual(['5Y', '2Y', '183-day'])
  })
})

describe('cash deployment', () => {
  it('clamps cash deployment and scales invested value', () => {
    expect(cashAfterDeploy(10, 0)).toBe(10)
    expect(cashAfterDeploy(10, 50)).toBeCloseTo(5, 6)
    expect(cashAfterDeploy(10, 100)).toBe(0)
    expect(cashAfterDeploy(10, 150)).toBe(0)
    expect(cashAfterDeploy(10, -5)).toBe(10)
    expect(deployedInvestedValue(900, 10, 0)).toBeCloseTo(1000, 6)
    expect(deployedInvestedValue(900, 10, 5)).toBeCloseTo(950, 6)
    expect(deployedInvestedValue(900, 10, 10)).toBe(900)
  })

  it('applies deployed cash to weights and shares', () => {
    const allCash = applyPlan(PORTFOLIO, RESPONSE, CLOSES, 0)
    if (!allCash.ok) throw new Error(allCash.reason)
    allCash.portfolio.positions.forEach((position, index) => expect(position.weight).toBeCloseTo([62, 18, 20][index], 6))
    expect(allCash.portfolio.cashWeight).toBe(0)

    const dollarAllCash = applyPlan(DOLLAR_PORTFOLIO, RESPONSE, CLOSES, 0)
    if (!dollarAllCash.ok) throw new Error(dollarAllCash.reason)
    dollarAllCash.portfolio.positions.forEach((position, index) => expect(position.shares).toBeCloseTo([12.4, 12, 4][index] * 1000 / 900, 6))

    const halfCash = applyPlan(PORTFOLIO, RESPONSE, CLOSES, 5)
    if (!halfCash.ok) throw new Error(halfCash.reason)
    halfCash.portfolio.positions.forEach((position, index) => expect(position.weight).toBeCloseTo([0.62, 0.18, 0.2][index] * 95, 6))
    expect(halfCash.portfolio.cashWeight).toBe(5)

    expect(applyPlan(PORTFOLIO, RESPONSE, CLOSES, 11)).toEqual({ ok: false, reason: 'invalid' })
    expect(applyPlan(PORTFOLIO, RESPONSE, CLOSES, -1)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('explains cash deployment in the confirmation and trade note', () => {
    const plan = applyPlan(PORTFOLIO, RESPONSE, CLOSES, 0)
    if (!plan.ok) throw new Error(plan.reason)
    expect(applyConfirmLines(plan, 'Optimized', 10)[0]).toBe('Holdings weights will be replaced by the Optimized column, scaled up to use cash. Cash goes from 10.0% to 0.0%.')
    expect(applyConfirmLines(plan, 'Optimized', 0)[0]).toBe('Holdings weights will be replaced by the Optimized column. Cash stays at 0.0%.')
    expect(tradeBasisNote(DOLLAR_BASIS, 100)).toBe('Trades use each holding\'s last stored close and fractional shares, on $900.00 invested plus $100.00 of cash.')
  })

  it('exports whole-portfolio shares and preserves cash on import', () => {
    const weightsCsv = optimizeCsv(RESPONSE, { kind: 'weights', reason: 'no-shares' }, 10, 10)
    expect(weightsCsv.split('\n')[1]).toBe('AAA,45,55.8,10.8,false')
    const dollarCsv = optimizeCsv(RESPONSE, DOLLAR_BASIS, 10, 0)
    expect(dollarCsv.split('\n')[1]).toBe('AAA,45,10,450,45,13.777778,620,62,3.777778,170,17,false')

    const universe = new Set(['AAA', 'BBB', 'YNG'])
    const weightsImport = parsePortfolioCsv(weightsCsv, universe)
    const dollarImport = parsePortfolioCsv(dollarCsv, universe)
    if (!weightsImport.ok || !dollarImport.ok) throw new Error('expected imports')
    expect(Number(weightsImport.seed.cash)).toBeCloseTo(10, 6)
    expect(Number(dollarImport.seed.cash)).toBeCloseTo(0, 6)
  })

  it('returns new whole-portfolio rows without mutating inputs', () => {
    const input = weightRows(RESPONSE)
    const before = structuredClone(input)
    const output = portfolioShareRows(input, 10, 5)
    expect(input).toEqual(before)
    expect(output).not.toBe(input)
    expect(output[0].current).toBeCloseTo(0.45, 6)
    expect(output[0].target).toBeCloseTo(0.589, 6)
    expect(output[0].change).toBeCloseTo(0.139, 6)
  })
})
