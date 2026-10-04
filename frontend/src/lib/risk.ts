import type { RiskRequest, RiskResponse } from '../api/client'
import type { MetricItem, TradeBasis } from './optimize'
import { lookbackLabel } from './optimize'
import type { Portfolio } from './portfolio'
import { cashDollars } from './monteCarlo'

export interface RiskSettings {
  lookbackDays: number
  marketTicker: string
}
export const DEFAULT_RISK_SETTINGS: RiskSettings = { lookbackDays: 365, marketTicker: 'SPY' }
export const DEFAULT_SHOCK_TEXT = '-20'

export function buildRiskRequest(
  portfolio: Portfolio,
  settings: RiskSettings,
  basis: TradeBasis,
): { ok: true; request: RiskRequest } | { ok: false; message: string } {
  if (portfolio.positions.length === 0) return { ok: false, message: 'Add at least one holding to measure risk.' }
  const marketTicker = settings.marketTicker.trim()
  if (marketTicker === '') return { ok: false, message: 'Choose a market ticker.' }
  return {
    ok: true,
    request: {
      tickers: portfolio.positions.map((position) => position.ticker),
      weights:
        basis.kind === 'dollar'
          ? portfolio.positions.map((position) => basis.shares[position.ticker] * basis.prices[position.ticker])
          : portfolio.positions.map((position) => position.weight),
      cash: basis.kind === 'dollar' ? cashDollars(portfolio, basis) : portfolio.cashWeight,
      market_ticker: marketTicker,
      lookback_days: settings.lookbackDays,
    },
  }
}

export function sameRiskRequest(a: RiskRequest, b: RiskRequest): boolean {
  return (
    a.cash === b.cash &&
    a.lookback_days === b.lookback_days &&
    a.market_ticker === b.market_ticker &&
    a.tickers.length === b.tickers.length &&
    a.weights.length === b.weights.length &&
    a.tickers.every((ticker, index) => ticker === b.tickers[index]) &&
    a.weights.every((weight, index) => weight === b.weights[index])
  )
}

export function riskTiles(response: RiskResponse): MetricItem[] {
  return [
    {
      label: 'Volatility',
      value: `${(response.portfolio_vol * 100).toFixed(2)}%`,
      tooltip: 'Annualised volatility of the whole portfolio, cash included, over the lookback.',
    },
    {
      label: `Beta vs ${response.market_ticker}`,
      value: response.portfolio_beta.toFixed(2),
      tooltip: `How much the portfolio tends to move when ${response.market_ticker} moves 1%. Cash counts as a beta of 0.`,
    },
    {
      label: 'Effective holdings',
      value: `${response.effective_holdings.toFixed(1)} of ${response.holdings.length}`,
      tooltip: 'How many equal-sized holdings would be this concentrated. Lower means more concentrated.',
    },
    {
      label: 'Top 5 weight',
      value: `${(response.top5_weight * 100).toFixed(1)}%`,
      tooltip: 'Share of the invested money in the five largest holdings.',
    },
  ]
}

export interface RiskRow {
  ticker: string
  weight: number
  vol: number
  beta: number
  riskShare: number | null
  ratio: number | null
}

export function riskRows(response: RiskResponse): RiskRow[] {
  return response.holdings
    .map((holding) => ({
      ticker: holding.ticker,
      weight: holding.weight,
      vol: holding.vol,
      beta: holding.beta,
      riskShare: holding.risk_share,
      ratio: holding.risk_share !== null && holding.weight > 0 ? holding.risk_share / holding.weight : null,
    }))
    .sort((a, b) => (b.riskShare ?? -Infinity) - (a.riskShare ?? -Infinity))
}

export function parseShock(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const stripped = text.trim().replace(/%$/, '').trim()
  const value = Number(stripped)
  if (stripped === '' || !Number.isFinite(value) || value < -50 || value > 50) {
    return { ok: false, message: 'Market move must be a number from -50% to +50%.' }
  }
  return { ok: true, value }
}

export function shockImpact(
  response: RiskResponse,
  shockPct: number,
): { portfolio: number; byTicker: Record<string, number> } {
  return {
    portfolio: response.portfolio_beta * shockPct,
    byTicker: Object.fromEntries(
      response.holdings.map((holding) => [holding.ticker, holding.weight * holding.beta * shockPct]),
    ),
  }
}

export function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(1))
  return rounded > 0 ? `+${rounded.toFixed(1)}%` : `${rounded.toFixed(1)}%`
}

export function riskSummary(response: RiskResponse): string {
  const cash = response.cash_weight > 0 ? ` · ${(response.cash_weight * 100).toFixed(1)}% cash` : ''
  return `${lookbackLabel(response.lookback_days)} lookback · market ${response.market_ticker} · ${response.start} → ${response.end} (${response.n_returns} daily returns)${cash}`
}
