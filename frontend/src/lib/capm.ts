import type { CapmRequest, CapmResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import { LOOKBACK_OPTIONS } from './optimize'
import type { TradeBasis } from './optimize'

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
}

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
  const label = LOOKBACK_OPTIONS.find((option) => option.days === response.lookback_days)?.label
    ?? `${response.lookback_days}d`
  return `${label} lookback · market ${response.market_ticker} · risk-free ${rfLabel(response.rf, response.rf_source)} · MRP ${formatReturn(response.mrp)} · fitted ${response.fit_start} → ${response.fit_end}`
}

export function statItems(response: CapmResponse): CapmItem[] {
  const { metrics } = response
  return [
    {
      label: 'Expected return',
      value: formatReturn(metrics.expected_return),
      tooltip: "Weighted average of each holding's CAPM expected return, including your views",
    },
    {
      label: 'Expected volatility',
      value: formatReturn(metrics.expected_vol),
      tooltip: 'Annualised volatility of the Target weights, from the covariance of daily returns',
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

export function varItems(response: CapmResponse): CapmItem[] {
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
  }))
}
