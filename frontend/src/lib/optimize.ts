import type { OptimizeCurves, OptimizeMetrics, OptimizeRebalance, OptimizeRequest, OptimizeResponse, PinnedHolding } from '../api/client'
import { downsample } from './chart'
import type { Portfolio } from './portfolio'
import { DOLLAR_WEIGHT_TOLERANCE_PP } from './portfolioChart'
import { datePart, filenameSafeName, quote } from './portfolioCsv'
import { formatShares } from './format'

export type OptimizeMode =
  | 'equal_weight' | 'min_variance' | 'max_sharpe' | 'risk_parity'
  | 'max_sortino' | 'min_cvar' | 'max_diversification' | 'target_volatility'

// Main's dropdown order and labels, verbatim. The CAPM mode is deliberately absent until 0110.
export const OPTIMIZE_MODES: ReadonlyArray<{ value: OptimizeMode; label: string }> = [
  { value: 'equal_weight', label: 'Equal Weight (1/N)' },
  { value: 'min_variance', label: 'Min Variance' },
  { value: 'max_sharpe', label: 'Max Sharpe (Historical)' },
  { value: 'risk_parity', label: 'Risk Parity' },
  { value: 'max_sortino', label: 'Max Sortino' },
  { value: 'min_cvar', label: 'Min CVaR (95%)' },
  { value: 'max_diversification', label: 'Max Diversification' },
  { value: 'target_volatility', label: 'Target Volatility' },
]

export const LONG_ONLY_MODES: ReadonlyArray<OptimizeMode> = ['equal_weight', 'risk_parity', 'max_diversification']

export const LOOKBACK_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '1Y', days: 365 }, { label: '2Y', days: 730 }, { label: '3Y', days: 1095 }, { label: '5Y', days: 1825 },
]

export const REBALANCE_OPTIONS: ReadonlyArray<{ value: OptimizeRebalance; label: string; summary: string }> = [
  { value: 'none', label: 'None (buy and hold)', summary: 'buy and hold' },
  { value: 'monthly', label: 'Monthly', summary: 'rebalanced monthly' },
  { value: 'quarterly', label: 'Quarterly', summary: 'rebalanced quarterly' },
  { value: 'annual', label: 'Annual', summary: 'rebalanced annually' },
]

export interface OptimizeSettings {
  mode: OptimizeMode
  lookbackDays: number
  maxWeightPct: number   // slider 10–100, step 5
  minWeightPct: number   // slider 0–20, step 1
  volTargetPct: number   // slider 5–50, step 1
  allowShort: boolean
  rebalance: OptimizeRebalance
}

export const DEFAULT_SETTINGS: OptimizeSettings = {
  mode: 'min_variance', lookbackDays: 1825, maxWeightPct: 100, minWeightPct: 0,
  volTargetPct: 10, allowShort: false, rebalance: 'none',
}

export interface WeightRow { ticker: string; current: number; target: number; change: number; pinned: boolean }
export type TradeBasis =
  | { kind: 'dollar'; investedValue: number; prices: Record<string, number>; shares: Record<string, number> }
  | { kind: 'weights'; reason: 'no-shares' | 'no-price' | 'shares-mismatch' }
export interface TradeRow extends WeightRow {
  price: number
  currentShares: number
  currentValue: number
  targetShares: number
  targetValue: number
  tradeShares: number
  tradeValue: number
}
export interface CurveRow { date: string; current: number; optimized: number; benchmark: number | null }
export interface MetricItem { label: string; value: string; tooltip: string }

export function canOptimize(portfolio: Portfolio): boolean {
  return portfolio.positions.length >= 2
}

export function tradeBasis(portfolio: Portfolio, lastCloseByTicker: ReadonlyMap<string, number | null>): TradeBasis {
  if (portfolio.positions.some((position) => !Number.isFinite(position.shares) || position.shares === undefined || position.shares <= 0)) {
    return { kind: 'weights', reason: 'no-shares' }
  }
  const prices: Record<string, number> = {}
  const shares: Record<string, number> = {}
  for (const position of portfolio.positions) {
    const price = lastCloseByTicker.get(position.ticker)
    if (price === undefined || price === null || !Number.isFinite(price) || price <= 0) {
      return { kind: 'weights', reason: 'no-price' }
    }
    prices[position.ticker] = price
    shares[position.ticker] = position.shares!
  }
  const equityWeight = 100 - portfolio.cashWeight
  if (!(equityWeight > 0)) return { kind: 'weights', reason: 'no-shares' }
  const investedValue = portfolio.positions.reduce((sum, position) => sum + shares[position.ticker] * prices[position.ticker], 0)
  const total = investedValue / (equityWeight / 100)
  if (portfolio.positions.some((position) => Math.abs((shares[position.ticker] * prices[position.ticker] / total) * 100 - position.weight) > DOLLAR_WEIGHT_TOLERANCE_PP)) {
    return { kind: 'weights', reason: 'shares-mismatch' }
  }
  return { kind: 'dollar', investedValue, prices, shares }
}

export function buildOptimizeRequest(portfolio: Portfolio, settings: OptimizeSettings, basis?: TradeBasis): OptimizeRequest {
  return {
    tickers: portfolio.positions.map((position) => position.ticker),
    weights: basis?.kind === 'dollar'
      ? portfolio.positions.map((position) => basis.shares[position.ticker] * basis.prices[position.ticker])
      : portfolio.positions.map((position) => position.weight),
    mode: settings.mode,
    lookback_days: settings.lookbackDays,
    max_weight: settings.maxWeightPct / 100,
    min_weight: settings.allowShort ? 0 : settings.minWeightPct / 100,
    vol_target: settings.volTargetPct / 100,
    allow_short: settings.allowShort,
    rebalance: settings.rebalance,
  }
}

export function sameSettings(a: OptimizeSettings, b: OptimizeSettings): boolean {
  return (
    a.mode === b.mode &&
    a.lookbackDays === b.lookbackDays &&
    a.maxWeightPct === b.maxWeightPct &&
    a.minWeightPct === b.minWeightPct &&
    a.volTargetPct === b.volTargetPct &&
    a.allowShort === b.allowShort &&
    a.rebalance === b.rebalance
  )
}

export function formatWeight(fraction: number): string {
  const r = Math.round(fraction * 1000) / 10
  if (r === 0) return '0.0%'
  return `${r.toFixed(1)}%`
}

export function formatChangePp(fraction: number): string {
  const r = Math.round(fraction * 1000) / 10
  if (r === 0) return '0.0 pp'
  return `${r > 0 ? '+' : '-'}${Math.abs(r).toFixed(1)} pp`
}

export function weightRows(response: OptimizeResponse): WeightRow[] {
  const pinnedTickers = new Set(response.pinned.map((holding) => holding.ticker))
  return response.tickers.map((ticker) => ({
    ticker,
    current: response.current_weights[ticker],
    target: response.target_weights[ticker],
    change: response.implied_trades[ticker],
    pinned: pinnedTickers.has(ticker),
  }))
}

export function tradeRows(response: OptimizeResponse, basis: Extract<TradeBasis, { kind: 'dollar' }>): TradeRow[] {
  return weightRows(response).map((row) => {
    const price = basis.prices[row.ticker]
    const currentShares = basis.shares[row.ticker]
    const currentValue = row.current * basis.investedValue
    const targetValue = row.target * basis.investedValue
    const targetShares = targetValue / price
    return { ...row, price, currentShares, currentValue, targetShares, targetValue, tradeShares: targetShares - currentShares, tradeValue: targetValue - currentValue }
  })
}

export function formatMoney(value: number): string {
  if (Math.abs(value) < 0.005) return '$0.00'
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatSignedMoney(value: number): string {
  if (Math.abs(value) < 0.005) return '$0.00'
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`
}

export function formatSignedShares(value: number): string {
  if (Math.abs(value) < 1e-6) return '0'
  return `${value > 0 ? '+' : '-'}${formatShares(Math.abs(value))}`
}

export function tradeBasisNote(basis: TradeBasis): string {
  if (basis.kind === 'dollar') return `Trades use each holding's last stored close and fractional shares, on ${formatMoney(basis.investedValue)} invested. Cash is left as it is.`
  if (basis.reason === 'no-shares') return 'Add a share count to every holding to see share and dollar trades.'
  if (basis.reason === 'no-price') return 'A holding has no stored closing price, so trades are shown as weights only.'
  return "Share counts don't match the weights within 0.5 points, so trades are shown as weights only."
}

function csvNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)))
}

export function optimizeCsv(response: OptimizeResponse, basis: TradeBasis): string {
  if (basis.kind === 'dollar') {
    const header = 'ticker,price,current_shares,current_value,current_pct,target_shares,target_value,target_pct,trade_shares,trade_value,change_pp,pinned'
    const rows = tradeRows(response, basis).map((row) => [row.ticker, csvNumber(row.price, 4), csvNumber(row.currentShares, 6), csvNumber(row.currentValue, 2), csvNumber(row.current * 100, 2), csvNumber(row.targetShares, 6), csvNumber(row.targetValue, 2), csvNumber(row.target * 100, 2), csvNumber(row.tradeShares, 6), csvNumber(row.tradeValue, 2), csvNumber(row.change * 100, 2), String(row.pinned)].map(quote).join(','))
    return [header, ...rows].join('\n') + '\n'
  }
  const header = 'ticker,current_pct,target_pct,change_pp,pinned'
  const rows = weightRows(response).map((row) => [row.ticker, csvNumber(row.current * 100, 2), csvNumber(row.target * 100, 2), csvNumber(row.change * 100, 2), String(row.pinned)].map(quote).join(','))
  return [header, ...rows].join('\n') + '\n'
}

export function optimizeCsvFilename(portfolioName: string, mode: string, now: Date): string {
  return `${filenameSafeName(portfolioName.trim()) || 'portfolio'}-optimize-${mode}-${datePart(now)}.csv`
}

export function curveRows(curves: OptimizeCurves): CurveRow[] {
  const rows = curves.dates.map((date, index) => ({
    date,
    current: (curves.current[index] / curves.current[0] - 1) * 100,
    optimized: (curves.optimized[index] / curves.optimized[0] - 1) * 100,
    benchmark: curves.benchmark === null ? null : (curves.benchmark[index] / curves.benchmark[0] - 1) * 100,
  }))
  return downsample(rows)
}

export function metricItems(metrics: OptimizeMetrics | null): MetricItem[] {
  const m = metrics ?? {}

  function pct(key: string): string {
    const value = m[key]
    return value === null || value === undefined ? '—' : formatWeight(value)
  }

  function ratio(key: string): string {
    const value = m[key]
    return value === null || value === undefined ? '—' : value.toFixed(2)
  }

  const items: MetricItem[] = [
    { label: 'CAGR', value: pct('cagr'), tooltip: 'Compound annual growth rate of the curve over the scored window' },
    { label: 'Volatility', value: pct('vol'), tooltip: 'Annualised volatility: daily standard deviation of returns × √252' },
    { label: 'Sharpe', value: ratio('sharpe'), tooltip: 'CAGR ÷ volatility, with the risk-free rate taken as 0. Above 1 is broadly acceptable; above 2 is excellent.' },
    { label: 'Max drawdown', value: pct('max_dd'), tooltip: 'Largest peak-to-trough fall in the curve' },
  ]

  if ('beta' in m) {
    items.push({ label: 'Beta vs SPY', value: ratio('beta'), tooltip: 'How much the curve moves with SPY: 1 moves in step, above 1 amplifies, below 1 dampens' })
  }
  if ('alpha' in m) {
    items.push({ label: 'Alpha', value: pct('alpha'), tooltip: 'Annualised return above what beta to SPY predicts, with the risk-free rate taken as 0' })
  }

  return items
}

export function pinnedBannerLines(pinned: PinnedHolding[], maxWeightPct: number): string[] {
  return pinned.map((holding) => {
    let line = `${holding.ticker}: prices start ${holding.first_bar}, so it is held at its current ${formatWeight(holding.weight)} and not optimized.`
    if (holding.exceeds_max) line += ` That is above the ${maxWeightPct}% max weight.`
    return line
  })
}

export function scoreWindowNote(response: OptimizeResponse): string | null {
  if (response.score_limited_by === null) return null
  return `The curves start ${response.score_start}, when ${response.score_limited_by}'s price history begins. The weights were fitted on ${response.fit_start} → ${response.fit_end}.`
}

export function modeLabel(mode: string): string {
  return OPTIMIZE_MODES.find((option) => option.value === mode)?.label ?? mode
}

export function runSummary(response: OptimizeResponse): string {
  const lookback = LOOKBACK_OPTIONS.find((option) => option.days === response.lookback_days)?.label ?? `${response.lookback_days}d`
  const rebalance = REBALANCE_OPTIONS.find((option) => option.value === response.rebalance)?.summary ?? response.rebalance
  return `${modeLabel(response.mode)} · ${lookback} lookback · ${rebalance} · fitted ${response.fit_start} → ${response.fit_end}`
}
