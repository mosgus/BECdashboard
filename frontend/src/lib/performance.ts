import type { PerformanceRequest, PerformanceResponse, TickerSignals } from '../api/client'
import type { TradeBasis } from './optimize'
import type { Portfolio } from './portfolio'
import { portfolioAmounts } from './risk'

export function parseOptionalWindow(
  startText: string,
  endText: string,
): { ok: true; start: string | null; end: string | null } | { ok: false; message: string } {
  const start = startText.trim() || null
  const end = endText.trim() || null
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if ((start !== null && !valid(start)) || (end !== null && !valid(end))) {
    return { ok: false, message: 'Dates must be YYYY-MM-DD, or left empty.' }
  }
  return start !== null && end !== null && start >= end
    ? { ok: false, message: 'Start date must be before end date.' }
    : { ok: true, start, end }
}

export function buildPerformanceRequest(
  portfolio: Portfolio,
  window: { start: string; end: string },
  basis: TradeBasis,
): { ok: true; request: PerformanceRequest } | { ok: false; message: string } {
  if (portfolio.positions.length === 0) return { ok: false, message: 'Add at least one holding to see performance.' }
  const parsed = parseOptionalWindow(window.start, window.end)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    request: { ...portfolioAmounts(portfolio, basis), start: parsed.start, end: parsed.end, market_ticker: 'SPY' },
  }
}

export function samePerformanceRequest(a: PerformanceRequest, b: PerformanceRequest): boolean {
  return (
    a.cash === b.cash &&
    a.start === b.start &&
    a.end === b.end &&
    a.market_ticker === b.market_ticker &&
    a.tickers.length === b.tickers.length &&
    a.weights.length === b.weights.length &&
    a.tickers.every((ticker, index) => ticker === b.tickers[index]) &&
    a.weights.every((weight, index) => weight === b.weights[index])
  )
}

export interface PerformanceRow {
  label: string
  tooltip: string
  portfolio: string
  benchmark: string
  diff: string
  portfolioTone: 'positive' | 'negative' | 'default'
  diffTone: 'positive' | 'negative' | 'muted'
}

const pct = (value: number) => `${(value * 100).toFixed(2)}%`
const signed = (value: number, format: (number: number) => string) => `${value > 0 ? '+' : ''}${format(value)}`
const number = (value: number) => value.toFixed(2)
const missing = (value: number | null | undefined) => value === null || value === undefined

function row(
  label: string,
  tooltip: string,
  portfolioValue: number | null | undefined,
  benchmarkValue: number | null | undefined,
  format: (value: number) => string,
  direction: 'normal' | 'inverse' = 'normal',
): PerformanceRow {
  const unavailable = missing(portfolioValue) || missing(benchmarkValue)
  const difference = unavailable ? null : portfolioValue - benchmarkValue
  const diffTone =
    difference === null || difference === 0
      ? 'muted'
      : difference > 0 === (direction === 'normal')
        ? 'positive'
        : 'negative'
  return {
    label,
    tooltip,
    portfolio: missing(portfolioValue) ? '—' : format(portfolioValue),
    benchmark: missing(benchmarkValue) ? '—' : format(benchmarkValue),
    diff: difference === null ? '—' : signed(difference, format),
    portfolioTone: 'default',
    diffTone,
  }
}

export function performanceRows(response: PerformanceResponse): PerformanceRow[] {
  const benchmark = response.bench_metrics
  const market = response.market_ticker
  const rows = [
    row('CAGR', 'Compound annual growth rate over the window.', response.metrics.cagr, benchmark?.cagr, pct),
    row(
      'Volatility',
      `Annualised standard deviation of daily returns. Higher than ${market} shows red.`,
      response.metrics.vol,
      benchmark?.vol,
      pct,
      'inverse',
    ),
    row(
      'Sharpe',
      'Return above the risk-free rate per unit of volatility: (CAGR − risk-free) ÷ volatility.',
      response.metrics.sharpe,
      benchmark?.sharpe,
      number,
    ),
    row(
      'Max Drawdown',
      'Largest fall from a high point during the window.',
      response.metrics.max_dd,
      benchmark?.max_dd,
      pct,
    ),
  ]
  if (benchmark !== null && !missing(response.metrics.beta)) {
    rows.push({
      label: 'Beta',
      tooltip: `How much the portfolio moved per 1% move in ${market}, from daily returns over the window. ${market} is 1.00 by definition.`,
      portfolio: number(response.metrics.beta),
      benchmark: '1.00',
      diff: signed(response.metrics.beta - 1, number),
      portfolioTone: 'default',
      diffTone: 'muted',
    })
  }
  if (benchmark !== null && !missing(response.metrics.alpha)) {
    rows.push({
      label: 'Alpha',
      tooltip: `Annual return beyond what beta to ${market} explains: CAGR − rf − β × (${market} CAGR − rf). ${market} is 0 by definition.`,
      portfolio: pct(response.metrics.alpha),
      benchmark: '0.00%',
      diff: '—',
      portfolioTone: response.metrics.alpha > 0 ? 'positive' : response.metrics.alpha < 0 ? 'negative' : 'default',
      diffTone: 'muted',
    })
  }
  return rows
}

export function performanceSummary(response: PerformanceResponse): string {
  return `${response.start} → ${response.end} (${response.n_days} trading days) · risk-free ${(response.rf * 100).toFixed(2)}%${response.rf_source === 'live' ? '' : ' (fallback)'}${response.cash_weight > 0 ? ` · ${(response.cash_weight * 100).toFixed(1)}% cash` : ''}`
}

export function performanceChartData(response: PerformanceResponse) {
  return response.path.map((point) => ({
    date: point.date,
    portfolio: (point.value - 1) * 100,
    market: point.market === null ? null : (point.market - 1) * 100,
  }))
}

export function performanceCsv(response: PerformanceResponse): string {
  return [
    `date,portfolio,${response.market_ticker}`,
    ...response.path.map((point) => `${point.date},${point.value},${point.market ?? ''}`),
  ].join('\n')
}

export const SIGNAL_COLUMNS = [
  ['sma_cross', 'SMA 20/50'],
  ['rsi_threshold', 'RSI 14'],
  ['macd_cross', 'MACD (12,26,9)'],
] as const

export function signalGrid(tickers: string[], signals: TickerSignals[]) {
  const byTicker = new Map(signals.map((tickerSignals) => [tickerSignals.ticker, tickerSignals.signals]))
  return tickers.map((ticker) => {
    const bySignal = new Map((byTicker.get(ticker) ?? []).map((signal) => [signal.signal, signal]))
    return {
      ticker,
      cells: SIGNAL_COLUMNS.map(([signal]) => {
        const item = bySignal.get(signal)
        return { state: item?.state ?? null, lastTrigger: item?.last_trigger_date ?? null }
      }),
    }
  })
}
