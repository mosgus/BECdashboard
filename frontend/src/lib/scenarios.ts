import type { RiskResponse, StressResponse } from '../api/client'
import type { GuideSection } from './capmGuide'
import { formatSigned } from './risk'
import { STRESS_PRESETS } from './stress'
import type { StressPreset } from './stress'

export type ScenarioKind = 'market_shock' | 'vol_shock' | 'historical'
export const SCENARIO_KINDS: { key: ScenarioKind; label: string }[] = [
  { key: 'market_shock', label: 'Market Shock' },
  { key: 'vol_shock', label: 'Vol Shock' },
  { key: 'historical', label: 'Historical Replay' },
]

export type ScenarioTag = 'crisis' | 'recovery' | 'rate-shock' | 'vol-shock'
export const PRESET_TAGS: Record<string, ScenarioTag[]> = {
  'dot-com': ['crisis'],
  'gfc-2008': ['crisis'],
  'euro-debt-2011': ['crisis'],
  'volmageddon-2018': ['vol-shock'],
  'q4-2018': ['crisis'],
  'covid-crash': ['crisis'],
  'covid-rebound': ['recovery'],
  'rate-shock-2022': ['rate-shock', 'crisis'],
  'carry-unwind-2024': ['vol-shock'],
  'tariffs-2025': ['crisis'],
}
export const TAG_STYLES: Record<ScenarioTag, string> = {
  crisis: 'border border-red-500/40 bg-red-500/10',
  recovery: 'border border-green-500/40 bg-green-500/10',
  'rate-shock': 'border border-amber-500/40 bg-amber-500/10',
  'vol-shock': 'border border-blue-500/40 bg-blue-500/10',
}

export interface ReplayResult {
  kind: 'historical'
  id: number
  window: { start: string; end: string }
  preset: StressPreset | null
  response: StressResponse
  bestDay: number
}
export interface ShockRow {
  ticker: string
  weight: number
  beta: number
  impact: number
}
export interface MarketShockResult {
  kind: 'market_shock'
  id: number
  movePct: number
  marketTicker: string
  portfolioBeta: number
  impact: number
  rows: ShockRow[]
  risk: RiskResponse
}
export interface VolShockResult {
  kind: 'vol_shock'
  id: number
  scale: number
  baseVol: number
  shockedVol: number
  risk: RiskResponse
}
export type ScenarioResult = ReplayResult | MarketShockResult | VolShockResult

export function parseVolScale(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const stripped = text.trim().replace(/[x×]$/, '').trim()
  const value = Number(stripped)
  if (stripped === '' || !Number.isFinite(value) || value < 0.1 || value > 10) {
    return { ok: false, message: 'Vol multiplier must be a number from 0.1 to 10.' }
  }
  return { ok: true, value }
}

export function marketShock(risk: RiskResponse, movePct: number, id: number): MarketShockResult {
  const move = movePct / 100
  const rows = risk.holdings
    .map((holding) => ({
      ticker: holding.ticker,
      weight: holding.weight,
      beta: holding.beta,
      impact: holding.weight * holding.beta * move,
    }))
    .sort((a, b) => a.impact - b.impact)
  return {
    kind: 'market_shock',
    id,
    movePct,
    marketTicker: risk.market_ticker,
    portfolioBeta: risk.portfolio_beta,
    impact: risk.portfolio_beta * move,
    rows,
    risk,
  }
}

export function volShock(risk: RiskResponse, scale: number, id: number): VolShockResult {
  return { kind: 'vol_shock', id, scale, baseVol: risk.portfolio_vol, shockedVol: risk.portfolio_vol * scale, risk }
}

export function replay(response: StressResponse, window: { start: string; end: string }, id: number): ReplayResult {
  const preset = STRESS_PRESETS.find((p) => p.start === window.start && p.end === window.end) ?? null
  let bestDay = -Infinity
  for (let i = 1; i < response.path.length; i++) {
    bestDay = Math.max(bestDay, response.path[i].value / response.path[i - 1].value - 1)
  }
  return { kind: 'historical', id, window: { start: window.start, end: window.end }, preset, response, bestDay }
}

export function replayCurve(
  r: StressResponse,
): { date: string; ret: number; drawdown: number; market: number | null }[] {
  let peak = -Infinity
  return r.path.map((point) => {
    peak = Math.max(peak, point.value)
    return {
      date: point.date,
      ret: (point.value - 1) * 100,
      drawdown: (point.value / peak - 1) * 100,
      market: point.market === null ? null : (point.market - 1) * 100,
    }
  })
}

export function contributionBars(r: StressResponse): { ticker: string; pct: number }[] {
  const covered = r.holdings
    .filter((holding) => holding.contribution !== null)
    .map((holding) => ({ ticker: holding.ticker, contribution: holding.contribution as number }))
    .sort((a, b) => a.contribution - b.contribution)
  const kept = covered.length > 12 ? [...covered.slice(0, 6), ...covered.slice(-6)] : covered
  return kept.map((item) => ({ ticker: item.ticker, pct: item.contribution * 100 }))
}

export function shockBars(r: MarketShockResult): { ticker: string; pct: number }[] {
  return r.rows.map((row) => ({ ticker: row.ticker, pct: row.impact * 100 }))
}

export function comparisonRows(
  results: ScenarioResult[],
): { name: string; totalReturn: number; maxDrawdown: number }[] {
  return results.flatMap((result) =>
    result.kind === 'historical'
      ? [
          {
            name: result.preset?.name ?? `${result.window.start} → ${result.window.end}`,
            totalReturn: result.response.portfolio_return * 100,
            maxDrawdown: result.response.max_drawdown * 100,
          },
        ]
      : [],
  )
}

export function replayInterpretation(r: StressResponse): string {
  const covered = r.holdings.filter((holding) => holding.contribution !== null)
  const positive = covered.filter((holding) => (holding.contribution as number) > 0).length
  const market =
    r.market_return === null
      ? ''
      : `, while ${r.market_ticker} ${r.market_return >= 0 ? 'rose' : 'fell'} ${(Math.abs(r.market_return) * 100).toFixed(1)}%`
  const verb = r.portfolio_return >= 0 ? 'gained' : 'lost'
  const change = (Math.abs(r.portfolio_return) * 100).toFixed(1)
  const drawdown = formatSigned(r.max_drawdown * 100)
  return (
    `Over this ${r.n_days}-day window, the portfolio ${verb} ${change}%${market}. ` +
    `Deepest drawdown: ${drawdown}. ${positive} of ${covered.length} holdings with prices contributed positively.`
  )
}

export const SCENARIO_GUIDE: GuideSection[] = [
  {
    heading: 'Scenario types',
    paragraphs: ["Three ways to stress today's holdings. Every scenario keeps cash at 0% return."],
    entries: [
      {
        term: 'Market Shock',
        text:
          "Estimates an instant move in SPY. Each holding moves by its beta × the SPY move, using betas from the last year of daily returns, and cash doesn't move. Caveat: beta only captures " +
          'the part of each holding that tracks the market. In real crashes, correlations rise and stock-specific news adds to the loss, so treat this as a central estimate, not a worst case.',
      },
      {
        term: 'Vol Shock',
        text:
          "Scales every holding's volatility by a multiplier, keeping correlations fixed. Portfolio volatility then scales by exactly the multiplier, so this shows the arithmetic of a calmer " +
          'or wilder market rather than a forecast. Caveat: in real crises correlations rise too, so the true figure is usually higher.',
      },
      {
        term: 'Historical Replay',
        text:
          "Buys today's holdings at the start of a past window and holds them to the end. Returns, drawdown, best and worst days, and each holding's contribution come from real prices. " +
          "Caveat: stored prices go back to 2000, but a holding that didn't trade yet (a newer ETF or a later IPO) has no prices for an old window. " +
          'It counts as flat, and a run with under 80% of the invested money priced is refused.',
      },
    ],
  },
  {
    heading: 'How to read the results',
    paragraphs: [],
    entries: [
      {
        term: 'Portfolio impact',
        text: "Market Shock only. The estimated change in the whole portfolio's value, cash included.",
      },
      { term: 'Per-holding impact', text: 'Market Shock only. Weight × beta × the market move. Sorted worst first.' },
      { term: 'Base vs shocked vol', text: 'Vol Shock only. Annualised volatility now, and after scaling.' },
      {
        term: 'Return and drawdown chart',
        text: "Historical Replay only. The line is the portfolio's return since the start of the window; the shaded area is how far it sits below its previous high. The dashed line is SPY.",
      },
      {
        term: 'Top winners and losers',
        text: "Historical Replay only. Each holding's weight × its return over the window, which is its share of the portfolio's result.",
      },
      {
        term: 'Scenario comparison',
        text: 'Appears after two or more historical replays. Total return and maximum drawdown side by side.',
      },
    ],
  },
]
