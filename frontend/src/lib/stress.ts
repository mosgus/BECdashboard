import type { StressRequest, StressResponse } from '../api/client'
import { formatSigned, portfolioAmounts } from './risk'
import type { MetricItem, TradeBasis } from './optimize'
import type { Portfolio } from './portfolio'

export interface StressPreset {
  id: string
  name: string
  description: string
  start: string
  end: string
}
export const STRESS_PRESETS: StressPreset[] = [
  {
    id: 'covid-crash',
    name: 'COVID crash',
    start: '2020-02-19',
    end: '2020-03-23',
    description: 'February 2020 high to the March low.',
  },
  {
    id: 'covid-rebound',
    name: 'COVID rebound',
    start: '2020-03-23',
    end: '2020-08-18',
    description: 'March 2020 low back to the February high.',
  },
  {
    id: 'rate-shock-2022',
    name: '2022 rate shock',
    start: '2022-01-03',
    end: '2022-10-12',
    description: 'Fed tightening: stocks and bonds fell together.',
  },
  {
    id: 'carry-unwind-2024',
    name: 'Aug 2024 carry unwind',
    start: '2024-07-16',
    end: '2024-08-05',
    description: 'Yen carry-trade unwind and a sharp volatility spike.',
  },
  {
    id: 'tariffs-2025',
    name: '2025 tariff sell-off',
    start: '2025-02-19',
    end: '2025-04-08',
    description: 'February 2025 high to the April tariff low.',
  },
]

export function parseWindow(
  startText: string,
  endText: string,
): { ok: true; start: string; end: string } | { ok: false; message: string } {
  const start = startText.trim(),
    end = endText.trim()
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!valid(start) || !valid(end)) return { ok: false, message: 'Enter a start and end date (YYYY-MM-DD).' }
  return start >= end ? { ok: false, message: 'Start date must be before end date.' } : { ok: true, start, end }
}

export function buildStressRequest(
  portfolio: Portfolio,
  window: { start: string; end: string },
  marketTicker: string,
  basis: TradeBasis,
): { ok: true; request: StressRequest } | { ok: false; message: string } {
  if (portfolio.positions.length === 0) return { ok: false, message: 'Add at least one holding to run a stress test.' }
  const market_ticker = marketTicker.trim()
  if (!market_ticker) return { ok: false, message: 'Choose a market ticker.' }
  return { ok: true, request: { ...portfolioAmounts(portfolio, basis), ...window, market_ticker } }
}

export function sameStressRequest(a: StressRequest, b: StressRequest): boolean {
  return (
    a.cash === b.cash &&
    a.start === b.start &&
    a.end === b.end &&
    a.market_ticker === b.market_ticker &&
    a.tickers.length === b.tickers.length &&
    a.weights.length === b.weights.length &&
    a.tickers.every((ticker, i) => ticker === b.tickers[i]) &&
    a.weights.every((weight, i) => weight === b.weights[i])
  )
}
export function stressTiles(r: StressResponse): MetricItem[] {
  return [
    {
      label: 'Portfolio return',
      value: formatSigned(r.portfolio_return * 100),
      tooltip: "Return of today's holdings, bought at the start of the window and held to the end. Cash stays flat.",
    },
    {
      label: 'Max drawdown',
      value: formatSigned(r.max_drawdown * 100),
      tooltip: 'Largest fall from a high point during the window.',
    },
    {
      label: 'Worst day',
      value: formatSigned(r.worst_day * 100),
      tooltip: `Worst single-day move, on ${r.worst_day_date}.`,
    },
    {
      label: `${r.market_ticker} over the window`,
      value: r.market_return === null ? '—' : formatSigned(r.market_return * 100),
      tooltip: `What ${r.market_ticker} returned over the same window, for comparison.`,
    },
  ]
}
export function stressRows(r: StressResponse) {
  return r.holdings
    .map((h) => ({
      ticker: h.ticker,
      weight: h.weight,
      covered: h.covered,
      assetReturn: h.asset_return,
      contribution: h.contribution,
    }))
    .sort((a, b) => (a.contribution ?? Infinity) - (b.contribution ?? Infinity))
}
export function stressSummary(r: StressResponse): string {
  return `${r.start} → ${r.end} (${r.n_days} trading days) · ${(r.coverage * 100).toFixed(1)}% of invested money has prices${r.cash_weight > 0 ? ` · ${(r.cash_weight * 100).toFixed(1)}% cash` : ''}`
}
export function stressChartData(r: StressResponse) {
  return r.path.map((p) => ({
    date: p.date,
    portfolio: (p.value - 1) * 100,
    market: p.market === null ? null : (p.market - 1) * 100,
  }))
}
