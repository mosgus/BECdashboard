import { describe, expect, it } from 'vitest'
import type { MonteCarloResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import {
  DEFAULT_MONTE_CARLO_SETTINGS, buildMonteCarloRequest, defaultStartingValue, fanChartData,
  monteCarloCsv, monteCarloCsvFilename, monteCarloSummary, sameMonteCarloRequest, terminalRows,
} from './monteCarlo'
import { tradeBasis } from './optimize'

const dollarPortfolio: Portfolio = {
  id: 'p', name: 'My: Fund', cashWeight: 20, updatedAt: '2026-09-01T00:00:00.000Z',
  positions: [{ ticker: 'AAA', weight: 40, shares: 10 }, { ticker: 'BBB', weight: 40, shares: 20 }],
}
const closes = new Map([['AAA', 100], ['BBB', 50]])
const weightsPortfolio: Portfolio = { ...dollarPortfolio, positions: [{ ticker: 'AAA', weight: 40 }, { ticker: 'BBB', weight: 40 }] }
const RESPONSE: MonteCarloResponse = {
  tickers: ['AAA', 'BBB'], weights: { AAA: 0.4, BBB: 0.4 }, cash_weight: 0.2, model: 'bootstrap', seed: 42,
  horizon_days: 252, num_simulations: 1000, initial_value: 2500, lookback_days: 1825,
  fit_start: '2021-10-01', fit_end: '2026-09-30', n_returns: 1256, daily_mean: 0.0004, daily_vol: 0.01,
  paths: [{ day: 0, p5: 2500, p25: 2500, p50: 2500, p75: 2500, p95: 2500 }, { day: 252, p5: 2000, p25: 2400, p50: 2700, p75: 3000, p95: 3500 }],
  terminal: { mean: 2750, median: 2700, p5: 2000, p25: 2400, p75: 3000, p95: 3500, prob_loss: 0.234, mean_return: 0.1, median_return: 0.08 }, warnings: [],
}

describe('Monte Carlo helpers', () => {
  const dollarBasis = tradeBasis(dollarPortfolio, closes)
  const weightsBasis = tradeBasis(weightsPortfolio, closes)

  it('sets dollar and hypothetical defaults', () => {
    expect(dollarBasis.kind).toBe('dollar'); expect(weightsBasis.kind).toBe('weights')
    expect(defaultStartingValue(dollarPortfolio, dollarBasis)).toBe('2500.00')
    const fixed = { ...dollarPortfolio, cashDollars: 300 }
    const fixedBasis = tradeBasis(fixed, closes)
    expect(fixedBasis.kind).toBe('dollar'); expect(defaultStartingValue(fixed, fixedBasis)).toBe('2300.00')
    expect(defaultStartingValue(weightsPortfolio, weightsBasis)).toBe('10000.00')
  })

  it('builds requests in both trade bases and validates inputs', () => {
    const dollar = buildMonteCarloRequest(dollarPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, '$2,500', dollarBasis)
    const weights = buildMonteCarloRequest(weightsPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, '10000', weightsBasis)
    if (!dollar.ok || !weights.ok) throw new Error('expected requests')
    expect(dollar.request).toMatchObject({ tickers: ['AAA', 'BBB'], weights: [1000, 1000], initial_value: 2500, horizon_days: 252, num_simulations: 1000, lookback_days: 1825, model: 'bootstrap' })
    expect(dollar.request.cash).toBeCloseTo(500); expect(weights.request.weights).toEqual([40, 40]); expect(weights.request.cash).toBe(20); expect(weights.request.initial_value).toBe(10000)
    for (const simulations of ['50', '10001', '1000.5', '']) expect(buildMonteCarloRequest(dollarPortfolio, { ...DEFAULT_MONTE_CARLO_SETTINGS, simulationsText: simulations }, '2500', dollarBasis)).toEqual({ ok: false, message: 'Simulations must be a whole number from 100 to 10,000.' })
    for (const value of ['0', '-5', 'abc', '']) expect(buildMonteCarloRequest(dollarPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, value, dollarBasis)).toEqual({ ok: false, message: 'Starting value must be a number above $0.' })
    expect(buildMonteCarloRequest({ ...dollarPortfolio, positions: [] }, DEFAULT_MONTE_CARLO_SETTINGS, '2500', dollarBasis)).toEqual({ ok: false, message: 'Add at least one holding to simulate.' })
  })

  it('compares requests and maps response data', () => {
    const first = buildMonteCarloRequest(dollarPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, '2500', dollarBasis)
    const second = buildMonteCarloRequest(dollarPortfolio, DEFAULT_MONTE_CARLO_SETTINGS, '2500', dollarBasis)
    if (!first.ok || !second.ok) throw new Error('expected requests')
    expect(sameMonteCarloRequest(first.request, second.request)).toBe(true)
    expect(sameMonteCarloRequest(first.request, { ...second.request, horizon_days: 63 })).toBe(false)
    expect(sameMonteCarloRequest(first.request, { ...second.request, weights: [1000, 999] })).toBe(false)
    expect(monteCarloSummary(RESPONSE)).toBe('1,000 bootstrapped paths over 252 trading days from $2,500.00. Fitted 2021-10-01 to 2026-09-30 (1256 daily returns, 5Y lookback). Seed 42, so the same settings give the same result.')
    expect(terminalRows(RESPONSE).map((row) => row.label)).toEqual(['5th percentile', '25th percentile', 'Median', '75th percentile', '95th percentile', 'Mean'])
    expect(terminalRows(RESPONSE)[0]).toMatchObject({ value: 2000 }); expect(terminalRows(RESPONSE)[0].change).toBeCloseTo(-0.2); expect(terminalRows(RESPONSE)[5].change).toBeCloseTo(0.1)
    expect(fanChartData(RESPONSE)[1]).toEqual({ day: 252, outer: [2000, 3500], inner: [2400, 3000], median: 2700 })
    expect(monteCarloCsv(RESPONSE)).toMatch(/^day,p5,p25,p50,p75,p95\n0,2500,2500,2500,2500,2500/)
    expect(monteCarloCsvFilename('My: Fund', new Date(2026, 8, 26))).toBe('My Fund-montecarlo-2026-09-26.csv')
  })
})
