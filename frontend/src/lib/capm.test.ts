import { describe, expect, it } from 'vitest'
import type { CapmResponse } from '../api/client'
import {
  DEFAULT_CAPM_SETTINGS, applyGlobalBounds, buildCapmRequest, capmRows, capmSummary,
  defaultHoldingInputs, formatBeta, formatReturn, formatView, rfLabel, sameCapmRun, statItems, varItems,
} from './capm'
import type { CapmRun } from './capm'
import type { Portfolio } from './portfolio'
import type { TradeBasis } from './optimize'

const RESPONSE: CapmResponse = {
  tickers: ['A', 'B', 'Y'],
  holdings: [
    { ticker: 'A', current_weight: 0.4, target_weight: 0.6, beta: 1.5, capm_return: 0.115, view: 0.2, expected_return: 0.125, vol: 0.286243, frozen: false, pinned: false, first_bar: '2021-01-04' },
    { ticker: 'B', current_weight: 0.4, target_weight: 0.2, beta: 0.5, capm_return: 0.065, view: 0, expected_return: 0.065, vol: 0.177594, frozen: true, pinned: false, first_bar: '2021-01-04' },
    { ticker: 'Y', current_weight: 0.2, target_weight: 0.2, beta: 0.793333, capm_return: 0.0796667, view: -0.1, expected_return: 0.0746667, vol: 0.169006, frozen: false, pinned: true, first_bar: '2024-06-03' },
  ], current_weights: { A: 0.4, B: 0.4, Y: 0.2 }, target_weights: { A: 0.6, B: 0.2, Y: 0.2 },
  metrics: { expected_return: 0.0979333, expected_vol: 0.219962, expected_sharpe: 0.263379, portfolio_beta: 1.158667 },
  var_95: { daily: -0.0224, weekly: -0.0483, monthly: -0.0963, quarterly: -0.1564, annual: -0.2639 },
  rf: 0.0427, rf_source: 'live', mrp: 0.05, market_ticker: 'SPY', lookback_days: 1825, fit_start: '2021-09-27', fit_end: '2026-09-25', score_start: '2024-06-04', warnings: [],
}
const PORTFOLIO: Portfolio = { id: 'p1', name: 'Test', cashWeight: 10, positions: [{ ticker: 'A', weight: 50 }, { ticker: 'B', weight: 40 }], updatedAt: '2026-09-26T00:00:00.000Z' }
const WEIGHTS_BASIS: TradeBasis = { kind: 'weights', reason: 'no-shares' }
const DOLLAR_BASIS: TradeBasis = { kind: 'dollar', investedValue: 900, prices: { A: 100, B: 50 }, shares: { A: 5, B: 8 } }

describe('capm helpers', () => {
  it('creates default holding inputs in position order', () => { const inputs = defaultHoldingInputs(PORTFOLIO); expect(inputs).toEqual({ A: { freeze: false, viewPct: 0, minPct: '0', maxPct: '100' }, B: { freeze: false, viewPct: 0, minPct: '0', maxPct: '100' } }); expect(Object.keys(inputs)).toEqual(['A', 'B']) })
  it('applies global bounds without changing frozen or source values', () => { const inputs = defaultHoldingInputs(PORTFOLIO); inputs.B = { ...inputs.B, freeze: true }; const next = applyGlobalBounds(inputs, '5', '50'); expect(next.A).toEqual({ freeze: false, viewPct: 0, minPct: '5', maxPct: '50' }); expect(next.B).toEqual(inputs.B); expect(inputs.A.minPct).toBe('0') })
  it('builds a weights-basis request', () => { const inputs = defaultHoldingInputs(PORTFOLIO); inputs.A = { freeze: false, viewPct: -20, minPct: '10', maxPct: '60' }; expect(buildCapmRequest(PORTFOLIO, DEFAULT_CAPM_SETTINGS, inputs, WEIGHTS_BASIS)).toEqual({ ok: true, request: { tickers: ['A', 'B'], weights: [50, 40], lookback_days: 1825, rf: null, mrp: 0.05, market_ticker: 'SPY', configs: { A: { freeze: false, view: -0.2, min_weight: 0.1, max_weight: 0.6 }, B: { freeze: false, view: 0, min_weight: 0, max_weight: 1 } } } }) })
  it('builds dollar-basis weights', () => { const result = buildCapmRequest(PORTFOLIO, DEFAULT_CAPM_SETTINGS, defaultHoldingInputs(PORTFOLIO), DOLLAR_BASIS); expect(result.ok && result.request.weights).toEqual([500, 400]) })
  it('keeps explicit risk-free zero manual', () => { const manual = buildCapmRequest(PORTFOLIO, { ...DEFAULT_CAPM_SETTINGS, rfPct: '4.5' }, defaultHoldingInputs(PORTFOLIO), WEIGHTS_BASIS); expect(manual.ok && manual.request.rf).toBeCloseTo(.045, 12); const zero = buildCapmRequest(PORTFOLIO, { ...DEFAULT_CAPM_SETTINGS, rfPct: '0' }, defaultHoldingInputs(PORTFOLIO), WEIGHTS_BASIS); expect(zero.ok && zero.request.rf).toBe(0) })
  it.each([
    [{ marketTicker: '  ' }, 'Choose a market ticker.'], [{ rfPct: '20' }, 'Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.'], [{ rfPct: '-0.5' }, 'Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.'], [{ rfPct: 'abc' }, 'Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.'], [{ mrpPct: '0' }, 'Market risk premium must be above 0% and at most 20%.'], [{ mrpPct: '' }, 'Market risk premium must be above 0% and at most 20%.'], [{ mrpPct: '25' }, 'Market risk premium must be above 0% and at most 20%.'], [{ input: ['A', 'minPct', ''] }, 'A: min and max weight must be numbers.'], [{ input: ['B', 'maxPct', 'x'] }, 'B: min and max weight must be numbers.'],
  ] as Array<[{ marketTicker?: string; rfPct?: string; mrpPct?: string; input?: [string, 'minPct' | 'maxPct', string] }, string]>)('validates %o', (change, message) => { const settings = { ...DEFAULT_CAPM_SETTINGS, ...change }; const inputs = defaultHoldingInputs(PORTFOLIO); if (change.input) inputs[change.input[0]] = { ...inputs[change.input[0]], [change.input[1]]: change.input[2] }; expect(buildCapmRequest(PORTFOLIO, settings, inputs, WEIGHTS_BASIS)).toEqual({ ok: false, message }) })
  it('compares recorded runs', () => { const run: CapmRun = { settings: DEFAULT_CAPM_SETTINGS, inputs: defaultHoldingInputs(PORTFOLIO) }; expect(sameCapmRun(run, structuredClone(run))).toBe(true); expect(sameCapmRun(run, { ...run, inputs: { ...run.inputs, A: { ...run.inputs.A, viewPct: 5 } } })).toBe(false); expect(sameCapmRun(run, { ...run, settings: { ...run.settings, mrpPct: '4' } })).toBe(false); expect(sameCapmRun(run, { ...run, inputs: { ...run.inputs, Z: run.inputs.A } })).toBe(false) })
  it('maps result rows', () => { const rows = capmRows(RESPONSE); expect(rows.map((row) => row.ticker)).toEqual(['A', 'B', 'Y']); expect(rows[0].change).toBeCloseTo(.2, 12); expect(rows[1].change).toBeCloseTo(-.2, 12); expect(rows[2].change).toBe(0); expect(rows[1].frozen).toBe(true); expect(rows[2].pinned).toBe(true); expect(rows[0]).toMatchObject({ beta: 1.5, expectedReturn: .125 }) })
  it('formats values', () => { expect([formatReturn(.115), formatReturn(.0746667), formatReturn(-.0224), formatReturn(-.00001)]).toEqual(['11.50%', '7.47%', '-2.24%', '0.00%']); expect([formatView(.2), formatView(0), formatView(-.1), formatView(-.05)]).toEqual(['+20%', '0%', '-10%', '-5%']); expect([formatBeta(.793333), formatBeta(1.5)]).toEqual(['0.79', '1.50']) })
  it('labels risk-free sources', () => { expect(rfLabel(.0427, 'live')).toBe('4.27% (3-month T-bill)'); expect(rfLabel(.0427, 'fallback')).toBe('4.27% (fallback, live rate unavailable)'); expect(rfLabel(.0427, 'manual')).toBe('4.27% (entered)') })
  it('summarises the run', () => expect(capmSummary(RESPONSE)).toBe('5Y lookback · market SPY · risk-free 4.27% (3-month T-bill) · MRP 5.00% · fitted 2021-09-27 → 2026-09-25'))
  it('builds statistic tiles', () => { expect(statItems(RESPONSE).map(({ label, value }) => [label, value])).toEqual([['Expected return', '9.79%'], ['Expected volatility', '22.00%'], ['Expected Sharpe', '0.26'], ['Beta vs SPY', '1.16']]); expect(statItems({ ...RESPONSE, metrics: { ...RESPONSE.metrics, expected_sharpe: null } })[2].value).toBe('—'); expect(statItems(RESPONSE)[2].tooltip).toContain('4.27% (3-month T-bill)') })
  it('builds value-at-risk tiles', () => expect(varItems(RESPONSE).map(({ label, value }) => [label, value])).toEqual([['Daily', '-2.24%'], ['Weekly', '-4.83%'], ['Monthly', '-9.63%'], ['Quarterly', '-15.64%'], ['Annual', '-26.39%']]))
})
