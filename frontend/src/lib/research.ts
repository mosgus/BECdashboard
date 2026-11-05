import type { CompareFrontier, CompareMetrics, CompareRequest, CompareResponse, Correlation } from '../api/client'
import { buildOptimizeRequest, DEFAULT_SETTINGS, modeLabel } from './optimize'
import type { OptimizeMode, TradeBasis } from './optimize'
import type { Portfolio } from './portfolio'

export interface CompareSettings {
  lookbackDays: number
  maxWeightPct: number
  volTargetPct: number | null // null = match current
}

export const DEFAULT_COMPARE_SETTINGS: CompareSettings = { lookbackDays: 365, maxWeightPct: 100, volTargetPct: null }
export const DEFAULT_COST_BPS = 10

export function buildCompareRequest(
  portfolio: Portfolio,
  settings: CompareSettings,
  basis?: TradeBasis,
): CompareRequest {
  const base = buildOptimizeRequest(portfolio, { ...DEFAULT_SETTINGS, lookbackDays: settings.lookbackDays }, basis)
  return {
    tickers: base.tickers,
    weights: base.weights,
    lookback_days: settings.lookbackDays,
    max_weight: settings.maxWeightPct / 100,
    min_weight: 0,
    vol_target: settings.volTargetPct === null ? null : settings.volTargetPct / 100,
    rebalance: 'none',
  }
}

export function sameCompareRequest(a: CompareRequest, b: CompareRequest): boolean {
  return (
    a.lookback_days === b.lookback_days &&
    a.max_weight === b.max_weight &&
    a.min_weight === b.min_weight &&
    a.vol_target === b.vol_target &&
    a.rebalance === b.rebalance &&
    a.tickers.length === b.tickers.length &&
    a.tickers.every((ticker, index) => ticker === b.tickers[index] && a.weights[index] === b.weights[index])
  )
}

export type CompareSortKey =
  | 'mode'
  | 'wf.mean'
  | 'wf.worst'
  | 'wf.beat_equal'
  | 'wf.beat_current'
  | 'in_sample.cagr'
  | 'in_sample.vol'
  | 'in_sample.sharpe'
  | 'in_sample.max_dd'
  | 'traded'

export interface WalkForwardStat {
  wins: number
  of: number
}

export interface WalkForwardSummary {
  byFold: (number | null)[] // holdout Sharpe per response.folds entry, same order
  mean: number | null
  worst: number | null
  beatEqual: WalkForwardStat | null // null on the equal_weight row
  beatCurrent: WalkForwardStat | null // null on the current row
}

function foldSharpe(response: CompareResponse, key: string): (number | null)[] {
  return response.folds.map((fold) =>
    key === 'current'
      ? (fold.current?.sharpe ?? null)
      : (fold.modes.find((m) => m.mode === key)?.holdout?.sharpe ?? null),
  )
}

function winCount(row: (number | null)[], comparator: (number | null)[]): WalkForwardStat {
  let wins = 0
  let of = 0
  row.forEach((value, index) => {
    const other = comparator[index]
    if (value === null || other === null) return
    of += 1
    if (value > other) wins += 1
  })
  return { wins, of }
}

export function walkForward(response: CompareResponse): Record<string, WalkForwardSummary> {
  const keys = ['current', ...response.modes.map((mode) => mode.mode)]
  const sharpes: Record<string, (number | null)[]> = {}
  for (const key of keys) sharpes[key] = foldSharpe(response, key)
  const out: Record<string, WalkForwardSummary> = {}
  for (const key of keys) {
    const byFold = sharpes[key]
    const values = byFold.filter((value): value is number => value !== null)
    out[key] = {
      byFold,
      mean: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length,
      worst: values.length === 0 ? null : Math.min(...values),
      beatEqual: key === 'equal_weight' ? null : winCount(byFold, sharpes['equal_weight'] ?? byFold.map(() => null)),
      beatCurrent: key === 'current' ? null : winCount(byFold, sharpes['current']),
    }
  }
  return out
}

export function beatsMostYears(stat: WalkForwardStat | null): boolean {
  return stat !== null && stat.of >= 2 && stat.wins * 2 > stat.of
}

export function usableFolds(response: CompareResponse): number {
  return response.folds.filter((fold) => fold.unavailable === null).length
}

export interface CompareRow {
  key: string
  label: string
  isCurrent: boolean
  error: string | null
  feasible: boolean | null
  traded: number | null
  inSample: CompareMetrics | null
  walkForward: WalkForwardSummary
}

export function compareRows(response: CompareResponse): CompareRow[] {
  const summaries = walkForward(response)
  const current: CompareRow = {
    key: 'current',
    label: 'Current portfolio',
    isCurrent: true,
    error: null,
    feasible: null,
    traded: 0,
    inSample: response.current.in_sample,
    walkForward: summaries['current'],
  }
  return [
    current,
    ...response.modes.map((mode) => ({
      key: mode.mode,
      label: modeLabel(mode.mode),
      isCurrent: false,
      error: mode.error,
      feasible: mode.feasible,
      traded: mode.traded,
      inSample: mode.in_sample,
      walkForward: summaries[mode.mode],
    })),
  ]
}

function ratio(stat: WalkForwardStat | null): number | null {
  return stat === null || stat.of === 0 ? null : stat.wins / stat.of
}

function sortValue(row: CompareRow, key: Exclude<CompareSortKey, 'mode'>): number | null {
  if (key === 'traded') return row.traded
  if (key === 'wf.mean') return row.walkForward.mean
  if (key === 'wf.worst') return row.walkForward.worst
  if (key === 'wf.beat_equal') return ratio(row.walkForward.beatEqual)
  if (key === 'wf.beat_current') return ratio(row.walkForward.beatCurrent)
  const metric = key.split('.')[1] as keyof CompareMetrics
  return row.inSample?.[metric] ?? null
}

export function sortCompareRows(rows: CompareRow[], key: CompareSortKey, ascending: boolean): CompareRow[] {
  const current = rows.filter((row) => row.isCurrent)
  const errors = rows.filter((row) => !row.isCurrent && row.error !== null)
  const rest = rows.filter((row) => !row.isCurrent && row.error === null)
  const direction = ascending ? 1 : -1
  const sorted = [...rest].sort((a, b) => {
    if (key === 'mode') return direction * a.label.localeCompare(b.label)
    const left = sortValue(a, key)
    const right = sortValue(b, key)
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1
    return direction * (left - right)
  })
  return [...current, ...sorted, ...errors]
}

// `traded` is a fraction of the invested sleeve: 0171 sends weights without cash. That is why `pct`
// scales by (1 − cash): it is shown as a share of the whole portfolio, cash included.
export function tradeCost(
  traded: number,
  bps: number,
  cashWeightPct: number,
  basis: TradeBasis,
): { pct: number; dollars: number | null } {
  return {
    pct: ((traded * bps) / 10000) * (1 - cashWeightPct / 100) * 100,
    dollars: basis.kind === 'dollar' ? ((traded * bps) / 10000) * basis.investedValue : null,
  }
}

export const SHORT_MODE_LABELS: Record<OptimizeMode, string> = {
  equal_weight: 'Equal',
  min_variance: 'Min Var',
  max_sharpe: 'Max Sharpe',
  risk_parity: 'Risk Parity',
  max_sortino: 'Max Sortino',
  min_cvar: 'Min CVaR',
  max_diversification: 'Max Div',
  target_volatility: 'Target Vol',
}

export interface CompareFrontierPoint {
  vol: number
  ret: number
  label: string
  name: string
}

export interface CompareFrontierData {
  curve: { vol: number; ret: number }[]
  cloud: { vol: number; ret: number }[]
  current: CompareFrontierPoint | null
  modes: CompareFrontierPoint[]
}

function scaled(point: { vol: number; ret: number }): { vol: number; ret: number } {
  return { vol: point.vol * 100, ret: point.ret * 100 }
}

export function compareFrontierData(response: CompareResponse): CompareFrontierData | null {
  const frontier = response.frontier
  if (frontier === null) return null
  const modes: CompareFrontierPoint[] = []
  for (const mode of response.modes) {
    if (mode.point === null) continue
    const label = mode.mode in SHORT_MODE_LABELS ? SHORT_MODE_LABELS[mode.mode as OptimizeMode] : mode.mode
    modes.push({ ...scaled(mode.point), label, name: modeLabel(mode.mode) })
  }
  const currentPoint = response.current.point
  return {
    curve: frontier.points.map(scaled),
    cloud: frontier.cloud.map(scaled),
    current: currentPoint === null ? null : { ...scaled(currentPoint), label: 'Current', name: 'Current portfolio' },
    modes,
  }
}

export function compareFrontierNote(frontier: CompareFrontier): string | null {
  if (frontier.excluded.length === 0) return null
  return `Covers ${frontier.tickers.join(', ')} only. ${frontier.excluded.join(', ')} ${frontier.excluded.length === 1 ? 'is' : 'are'} left out for short history, so these points show the other holdings' mix, scaled to 100%.`
}

// Capped at 60% so text stays readable on the darkest cell in both themes.
export function correlationCellBackground(rho: number): string {
  const color = rho >= 0 ? 'var(--color-primary)' : 'var(--color-accent)'
  return `color-mix(in srgb, ${color} ${Math.round(Math.abs(rho) * 60)}%, transparent)`
}

export function correlationNote(correlation: Correlation): string {
  return (
    `Daily returns ${correlation.start} → ${correlation.end} (${correlation.n_returns} days).` +
    (correlation.limited_by ? ` Starts when ${correlation.limited_by} first has prices.` : '') +
    (correlation.excluded.length ? ` Left out (no price movement): ${correlation.excluded.join(', ')}.` : '')
  )
}
