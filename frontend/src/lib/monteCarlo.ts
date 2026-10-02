import type { MonteCarloRequest, MonteCarloResponse } from '../api/client'
import type { Portfolio } from './portfolio'
import { datePart, filenameSafeName } from './portfolioCsv'
import { csvNumber, formatMoney, lookbackLabel } from './optimize'
import type { LookbackFloor, TradeBasis } from './optimize'

export type MonteCarloModel = 'bootstrap' | 'normal'
export interface MonteCarloSettings {
  lookbackDays: number
  model: MonteCarloModel
  horizonDays: number
  simulationsText: string
}
export const DEFAULT_MONTE_CARLO_SETTINGS: MonteCarloSettings = {
  lookbackDays: 1825, model: 'bootstrap', horizonDays: 252, simulationsText: '1000',
}
export const MONTE_CARLO_LOOKBACK_FLOOR: LookbackFloor = { days: 89, label: '3 months' }
export const HORIZON_OPTIONS: ReadonlyArray<{ label: string; days: number }> = [
  { label: '3 Mo', days: 63 }, { label: '6 Mo', days: 126 },
  { label: '1 Yr', days: 252 }, { label: '2 Yr', days: 504 },
]
export const HYPOTHETICAL_START = 10000

export function cashDollars(portfolio: Portfolio, basis: Extract<TradeBasis, { kind: 'dollar' }>): number {
  return portfolio.cashDollars ?? basis.investedValue * portfolio.cashWeight / (100 - portfolio.cashWeight)
}

export function defaultStartingValue(portfolio: Portfolio, basis: TradeBasis): string {
  return basis.kind === 'dollar'
    ? (basis.investedValue + cashDollars(portfolio, basis)).toFixed(2)
    : HYPOTHETICAL_START.toFixed(2)
}

export function buildMonteCarloRequest(
  portfolio: Portfolio, settings: MonteCarloSettings, startingText: string, basis: TradeBasis,
): { ok: true; request: MonteCarloRequest } | { ok: false; message: string } {
  if (portfolio.positions.length === 0) return { ok: false, message: 'Add at least one holding to simulate.' }
  const simulations = settings.simulationsText.trim()
  if (!/^\d+$/.test(simulations) || Number(simulations) < 100 || Number(simulations) > 10000) {
    return { ok: false, message: 'Simulations must be a whole number from 100 to 10,000.' }
  }
  const cleaned = startingText.replace(/[\s$,]/g, '')
  const initialValue = Number(cleaned)
  if (cleaned === '' || !Number.isFinite(initialValue) || initialValue <= 0) {
    return { ok: false, message: 'Starting value must be a number above $0.' }
  }
  return {
    ok: true,
    request: {
      tickers: portfolio.positions.map((position) => position.ticker),
      weights: basis.kind === 'dollar'
        ? portfolio.positions.map((position) => basis.shares[position.ticker] * basis.prices[position.ticker])
        : portfolio.positions.map((position) => position.weight),
      cash: basis.kind === 'dollar' ? cashDollars(portfolio, basis) : portfolio.cashWeight,
      initial_value: initialValue,
      horizon_days: settings.horizonDays,
      num_simulations: Number(simulations),
      lookback_days: settings.lookbackDays,
      model: settings.model,
    },
  }
}

export function sameMonteCarloRequest(a: MonteCarloRequest, b: MonteCarloRequest): boolean {
  return a.cash === b.cash && a.initial_value === b.initial_value && a.horizon_days === b.horizon_days
    && a.num_simulations === b.num_simulations && a.lookback_days === b.lookback_days && a.model === b.model
    && a.tickers.length === b.tickers.length && a.weights.length === b.weights.length
    && a.tickers.every((ticker, index) => ticker === b.tickers[index])
    && a.weights.every((weight, index) => weight === b.weights[index])
}

export function monteCarloSummary(response: MonteCarloResponse): string {
  const model = response.model === 'bootstrap' ? 'bootstrapped' : 'normal-model'
  const prefix = `${response.num_simulations.toLocaleString('en-US')} ${model} paths over ${response.horizon_days} trading days from ${formatMoney(response.initial_value)}.`
  const fitted = ` Fitted ${response.fit_start} to ${response.fit_end} (${response.n_returns} daily returns, ${lookbackLabel(response.lookback_days)} lookback).`
  return `${prefix}${fitted} Seed ${response.seed}, so the same settings give the same result.`
}

export interface TerminalRow { label: string; value: number; change: number }
export function terminalRows(response: MonteCarloResponse): TerminalRow[] {
  const values = [
    ['5th percentile', response.terminal.p5], ['25th percentile', response.terminal.p25],
    ['Median', response.terminal.median], ['75th percentile', response.terminal.p75],
    ['95th percentile', response.terminal.p95], ['Mean', response.terminal.mean],
  ] as const
  return values.map(([label, value]) => ({ label, value, change: value / response.initial_value - 1 }))
}

export interface FanPoint { day: number; outer: [number, number]; inner: [number, number]; median: number }
export function fanChartData(response: MonteCarloResponse): FanPoint[] {
  return response.paths.map((point) => ({
    day: point.day, outer: [point.p5, point.p95], inner: [point.p25, point.p75], median: point.p50,
  }))
}

export function monteCarloCsv(response: MonteCarloResponse): string {
  return ['day,p5,p25,p50,p75,p95', ...response.paths.map((point) => [
    point.day, point.p5, point.p25, point.p50, point.p75, point.p95,
  ].map((value) => csvNumber(value, 2)).join(','))].join('\n')
}

export function monteCarloCsvFilename(portfolioName: string, now: Date): string {
  return `${filenameSafeName(portfolioName.trim()) || 'portfolio'}-montecarlo-${datePart(now)}.csv`
}
