import type { IndicatorSeries, PortfolioHolding } from '../api/client'
import type { ShadedRange } from './chart'
import type { Portfolio } from './portfolio'

export const DOLLAR_WEIGHT_TOLERANCE_PP = 0.5
export const PORTFOLIO_INDICATOR_KEYS = ['ema', 'bollinger'] as const
export const PORTFOLIO_ALWAYS_ON = ['sma', 'rsi', 'macd'] as const

export type ChartMode =
  | { kind: 'dollar'; value: number }
  | { kind: 'index'; reason: 'no-shares' | 'shares-mismatch' }

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function chartMode(portfolio: Portfolio, holdings: PortfolioHolding[]): ChartMode {
  const holdingsByTicker = new Map(holdings.map((holding) => [holding.ticker, holding]))
  const equityWeight = 100 - portfolio.cashWeight
  if (!(equityWeight > 0)) return { kind: 'index', reason: 'no-shares' }

  const positions = portfolio.positions.map((position) => {
    const holding = holdingsByTicker.get(position.ticker)
    if (!isFinitePositive(position.shares) || holding === undefined || !isFinitePositive(holding.last_close)) return null
    return { shares: position.shares, weight: position.weight, lastClose: holding.last_close }
  })
  if (positions.some((position) => position === null)) return { kind: 'index', reason: 'no-shares' }

  const value = positions.reduce((sum, position) => sum + position!.shares * position!.lastClose, 0) / (equityWeight / 100)
  if (positions.some((position) => Math.abs((position!.shares * position!.lastClose / value) * 100 - position!.weight) > DOLLAR_WEIGHT_TOLERANCE_PP)) {
    return { kind: 'index', reason: 'shares-mismatch' }
  }
  return { kind: 'dollar', value }
}

export function visibleStartIndex(dates: string[], start: string): number {
  return dates.findIndex((date) => date >= start)
}

export function scaleFactor(mode: ChartMode, values: number[], startIndex: number): number {
  return mode.kind === 'index' ? 100 / values[startIndex] : mode.value / values[values.length - 1]
}

export function scaleSeries(series: IndicatorSeries[], k: number): IndicatorSeries[] {
  return series.map((indicator) => ({
    ...indicator,
    points: indicator.key === 'rsi' ? [...indicator.points] : indicator.points.map((point) => point === null ? null : point * k),
  }))
}

export function flatFillRange(holdings: PortfolioHolding[], visibleStart: string, visibleEnd: string): ShadedRange | null {
  const late = holdings.filter((holding) => holding.first_bar > visibleStart).sort((left, right) =>
    left.first_bar.localeCompare(right.first_bar) || left.ticker.localeCompare(right.ticker),
  )
  if (late.length === 0) return null
  return {
    from: visibleStart,
    to: late.at(-1)!.first_bar < visibleEnd ? late.at(-1)!.first_bar : visibleEnd,
    label: `${late.map((holding) => `${holding.ticker} listed ${holding.first_bar}`).join(', ')}; flat before then`,
  }
}

export function defaultStart(today: Date): string {
  const start = new Date(today)
  start.setFullYear(start.getFullYear() - 1)
  const year = start.getFullYear()
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const day = String(start.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDollars(value: number): string {
  const sign = value < 0 ? '-' : ''
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000_000) return `${sign}$${(magnitude / 1_000_000).toFixed(2)}M`
  if (magnitude >= 1_000) return `${sign}$${(magnitude / 1_000).toFixed(1)}K`
  return `${sign}$${magnitude.toFixed(2)}`
}
