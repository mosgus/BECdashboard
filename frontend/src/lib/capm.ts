import type { CapmRequest, CapmResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import { applyConfirmLines, applyPlan, csvNumber, formatMoney, lookbackLabel, tradeRows } from './optimize'
import type { ApplyPlan, TradeBasis, TradeRow, WeightSource } from './optimize'
import { datePart, filenameSafeName, quote } from './portfolioCsv'

export interface CapmSettings {
  lookbackDays: number
  rfPct: string
  mrpPct: string
  marketTicker: string
}

export interface CapmHoldingInput {
  freeze: boolean
  viewPct: number
  minPct: string
  maxPct: string
}

export type CapmInputs = Record<string, CapmHoldingInput>

export interface CapmRun {
  settings: CapmSettings
  inputs: CapmInputs
}

export interface CapmRow {
  ticker: string
  beta: number
  capmReturn: number
  view: number
  expectedReturn: number
  vol: number
  current: number
  target: number
  change: number
  frozen: boolean
  pinned: boolean
}

export interface CapmItem {
  label: string
  value: string
  tooltip: string
  detail?: string
}

export interface CapmTradeRow extends TradeRow { frozen: boolean }
export interface CalPoint { vol: number; ret: number }
export interface CalChartData { rf: CalPoint; current: CalPoint; target: CalPoint; line: CalPoint[]; assets: Array<CalPoint & { ticker: string }> }

export const DEFAULT_CAPM_SETTINGS: CapmSettings = {
  lookbackDays: 1825,
  rfPct: '',
  mrpPct: '5',
  marketTicker: 'SPY',
}

export function defaultHoldingInput(): CapmHoldingInput {
  return {
    freeze: false,
    viewPct: 0,
    minPct: '0',
    maxPct: '100',
  }
}

export function defaultHoldingInputs(portfolio: Portfolio): CapmInputs {
  return Object.fromEntries(
    portfolio.positions.map((position) => [position.ticker, defaultHoldingInput()]),
  )
}

export function applyGlobalBounds(inputs: CapmInputs, minPct: string, maxPct: string): CapmInputs {
  return Object.fromEntries(
    Object.entries(inputs).map(([ticker, input]) => [
      ticker,
      input.freeze ? { ...input } : { ...input, minPct, maxPct },
    ]),
  )
}

function parse(text: string): number | null {
  if (text.trim() === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

export function buildCapmRequest(
  portfolio: Portfolio,
  settings: CapmSettings,
  inputs: CapmInputs,
  basis: TradeBasis,
): { ok: true; request: CapmRequest } | { ok: false; message: string } {
  if (settings.marketTicker.trim() === '') {
    return { ok: false, message: 'Choose a market ticker.' }
  }

  const rf = parse(settings.rfPct)
  if (settings.rfPct.trim() !== '' && (rf === null || rf < 0 || rf >= 20)) {
    return {
      ok: false,
      message: 'Risk-free rate must be at least 0% and below 20%, or blank for the live 3-month T-bill rate.',
    }
  }

  const mrp = parse(settings.mrpPct)
  if (mrp === null || mrp <= 0 || mrp > 20) {
    return { ok: false, message: 'Market risk premium must be above 0% and at most 20%.' }
  }

  const configs: Record<string, CapmRequest['configs'][string]> = {}
  for (const position of portfolio.positions) {
    const input = inputs[position.ticker] ?? defaultHoldingInput()
    const min = parse(input.minPct)
    const max = parse(input.maxPct)
    if (min === null || max === null) {
      return { ok: false, message: `${position.ticker}: min and max weight must be numbers.` }
    }
    configs[position.ticker] = {
      freeze: input.freeze,
      view: input.viewPct / 100,
      min_weight: min / 100,
      max_weight: max / 100,
    }
  }

  return {
    ok: true,
    request: {
      tickers: portfolio.positions.map((position) => position.ticker),
      weights: basis.kind === 'dollar'
        ? portfolio.positions.map((position) => basis.shares[position.ticker] * basis.prices[position.ticker])
        : portfolio.positions.map((position) => position.weight),
      lookback_days: settings.lookbackDays,
      rf: rf === null ? null : rf / 100,
      mrp: mrp / 100,
      market_ticker: settings.marketTicker.trim(),
      configs,
    },
  }
}

export function sameCapmRun(a: CapmRun, b: CapmRun): boolean {
  if (
    a.settings.lookbackDays !== b.settings.lookbackDays ||
    a.settings.rfPct !== b.settings.rfPct ||
    a.settings.mrpPct !== b.settings.mrpPct ||
    a.settings.marketTicker !== b.settings.marketTicker
  ) {
    return false
  }

  const keys = Object.keys(a.inputs)
  if (keys.length !== Object.keys(b.inputs).length || keys.some((key) => !(key in b.inputs))) {
    return false
  }

  return keys.every((key) => {
    const x = a.inputs[key]
    const y = b.inputs[key]
    return x.freeze === y.freeze && x.viewPct === y.viewPct && x.minPct === y.minPct && x.maxPct === y.maxPct
  })
}

export function capmRows(response: CapmResponse): CapmRow[] {
  return response.holdings.map((holding) => ({
    ticker: holding.ticker,
    beta: holding.beta,
    capmReturn: holding.capm_return,
    view: holding.view,
    expectedReturn: holding.expected_return,
    vol: holding.vol,
    current: holding.current_weight,
    target: holding.target_weight,
    change: holding.target_weight - holding.current_weight,
    frozen: holding.frozen,
    pinned: holding.pinned,
  }))
}

export function formatReturn(fraction: number): string {
  if (Math.round(fraction * 10000) === 0) return '0.00%'
  return `${(fraction * 100).toFixed(2)}%`
}

export function formatView(fraction: number): string {
  const percent = Math.round(fraction * 100)
  if (percent > 0) return `+${percent}%`
  return `${percent}%`
}

export function formatBeta(beta: number): string {
  return beta.toFixed(2)
}

export function rfLabel(rf: number, source: CapmResponse['rf_source']): string {
  const value = formatReturn(rf)
  if (source === 'live') return `${value} (3-month T-bill)`
  if (source === 'fallback') return `${value} (fallback, live rate unavailable)`
  return `${value} (entered)`
}

export function capmSummary(response: CapmResponse): string {
  const label = lookbackLabel(response.lookback_days)
  return `${label} lookback · market ${response.market_ticker} · risk-free ${rfLabel(response.rf, response.rf_source)} · MRP ${formatReturn(response.mrp)} · fitted ${response.fit_start} → ${response.fit_end}`
}

export function statItems(response: CapmResponse, weights: 'current' | 'target' = 'target'): CapmItem[] {
  const metrics = weights === 'current' ? response.current_metrics : response.metrics
  return [
    {
      label: 'Expected return',
      value: formatReturn(metrics.expected_return),
      tooltip: "Weighted average of each holding's CAPM expected return, including your views",
    },
    {
      label: 'Expected volatility',
      value: formatReturn(metrics.expected_vol),
      tooltip: `Annualised volatility of the ${weights === 'current' ? 'Current' : 'Target'} weights, from the covariance of daily returns`,
    },
    {
      label: 'Expected Sharpe',
      value: metrics.expected_sharpe === null ? '—' : metrics.expected_sharpe.toFixed(2),
      tooltip: `(Expected return − risk-free rate) ÷ expected volatility. Risk-free rate: ${rfLabel(response.rf, response.rf_source)}.`,
    },
    {
      label: `Beta vs ${response.market_ticker}`,
      value: formatBeta(metrics.portfolio_beta),
      tooltip: `Weighted average of the holdings' betas against ${response.market_ticker}`,
    },
  ]
}

export function varItems(response: CapmResponse, targetValue: number | null = null): CapmItem[] {
  const items: Array<[string, keyof CapmResponse['var_95'], string]> = [
    ['Daily', 'daily', 'One day in 20, the return is expected to be below this'],
    ['Weekly', 'weekly', 'One week in 20, the return is expected to be below this'],
    ['Monthly', 'monthly', 'One month in 20, the return is expected to be below this'],
    ['Quarterly', 'quarterly', 'One quarter in 20, the return is expected to be below this'],
    ['Annual', 'annual', 'One year in 20, the return is expected to be below this'],
  ]
  return items.map(([label, key, tooltip]) => ({
    label,
    value: formatReturn(response.var_95[key]),
    tooltip,
    ...(targetValue === null ? {} : { detail: formatMoney(targetValue * response.var_95[key]) }),
  }))
}

export function capmWeightSource(response: CapmResponse): WeightSource {
  return {
    tickers: response.tickers,
    current_weights: response.current_weights,
    target_weights: response.target_weights,
    implied_trades: Object.fromEntries(response.tickers.map((ticker) => [ticker, response.target_weights[ticker] - response.current_weights[ticker]])),
    pinned: response.holdings.filter((holding) => holding.pinned).map((holding) => ({ ticker: holding.ticker })),
  }
}

export function parseTargetValue(text: string): { ok: true; value: number | null } | { ok: false; message: string } {
  const cleaned = text.trim().replaceAll(',', '').replace(/^\$/, '')
  if (cleaned === '') return { ok: true, value: null }
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0
    ? { ok: true, value }
    : { ok: false, message: 'Target value must be a dollar amount above $0, or blank.' }
}

export function defaultTargetValue(basis: TradeBasis): string {
  return basis.kind === 'dollar' ? basis.investedValue.toFixed(2) : ''
}

export function capmTradeRows(response: CapmResponse, basis: Extract<TradeBasis, { kind: 'dollar' }>, targetValue: number): CapmTradeRow[] {
  const frozen = new Set(response.holdings.filter((holding) => holding.frozen).map((holding) => holding.ticker))
  return tradeRows(capmWeightSource(response), basis, targetValue).map((row) => ({ ...row, frozen: frozen.has(row.ticker) }))
}

export function allViewsZero(response: CapmResponse): boolean {
  return response.holdings.every((holding) => holding.view === 0)
}

export function capmCsv(response: CapmResponse, basis: TradeBasis, targetValue: number | null): string {
  const header = 'ticker,beta,capm_return_pct,view_pct,expected_return_pct,vol_pct,current_pct,target_pct,change_pp,frozen,pinned'
  const weights = response.holdings.map((holding) => [
    holding.ticker, csvNumber(holding.beta, 4), csvNumber(holding.capm_return * 100, 2), csvNumber(holding.view * 100, 2),
    csvNumber(holding.expected_return * 100, 2), csvNumber(holding.vol * 100, 2), csvNumber(holding.current_weight * 100, 2),
    csvNumber(holding.target_weight * 100, 2), csvNumber((holding.target_weight - holding.current_weight) * 100, 2), String(holding.frozen), String(holding.pinned),
  ])
  if (basis.kind !== 'dollar' || targetValue === null) return [header, ...weights.map((row) => row.map(quote).join(','))].join('\n') + '\n'
  const trades = new Map(capmTradeRows(response, basis, targetValue).map((row) => [row.ticker, row]))
  const dollarHeader = `${header},price,current_shares,current_value,target_shares,target_value,trade_shares,trade_value`
  const rows = weights.map((row) => {
    const trade = trades.get(row[0])!
    return [...row, csvNumber(trade.price, 4), csvNumber(trade.currentShares, 6), csvNumber(trade.currentValue, 2), csvNumber(trade.targetShares, 6), csvNumber(trade.targetValue, 2), csvNumber(trade.tradeShares, 6), csvNumber(trade.tradeValue, 2)].map(quote).join(',')
  })
  return [dollarHeader, ...rows].join('\n') + '\n'
}

export function capmCsvFilename(portfolioName: string, now: Date): string {
  return `${filenameSafeName(portfolioName.trim()) || 'portfolio'}-capm-${datePart(now)}.csv`
}

export function capmApplyPlan(portfolio: Portfolio, response: CapmResponse, lastCloseByTicker: ReadonlyMap<string, number | null>): ApplyPlan {
  return applyPlan(portfolio, { tickers: response.tickers, target_weights: response.target_weights, feasible: true }, lastCloseByTicker)
}

export function capmApplyLines(plan: Extract<ApplyPlan, { ok: true }>, basis: TradeBasis, targetValue: number | null): string[] {
  const lines = applyConfirmLines(plan, 'Target')
  if (basis.kind === 'dollar' && targetValue !== null && plan.sharesMode === 'recomputed' && Math.abs(targetValue - basis.investedValue) >= 0.005) {
    lines.splice(-1, 0, `Share counts are sized to the current invested value (${formatMoney(basis.investedValue)}), not the ${formatMoney(targetValue)} Target value.`)
  }
  return lines
}

export function calChartData(response: CapmResponse): CalChartData {
  const rf = { vol: 0, ret: response.rf * 100 }
  const target = { vol: response.metrics.expected_vol * 100, ret: response.metrics.expected_return * 100 }
  const current = { vol: response.current_metrics.expected_vol * 100, ret: response.current_metrics.expected_return * 100 }
  const assets = response.holdings.map((holding) => ({ ticker: holding.ticker, vol: holding.vol * 100, ret: holding.expected_return * 100 }))
  const line = target.vol <= 1e-12 ? [] : [rf, (() => {
    const vol = 1.1 * Math.max(...assets.map((asset) => asset.vol), target.vol, current.vol)
    return { vol, ret: rf.ret + ((target.ret - rf.ret) / target.vol) * vol }
  })()]
  return { rf, current, target, line, assets }
}
