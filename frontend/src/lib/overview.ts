import type { PerformanceResponse, RiskResponse } from '../api/client'

export type ScoreTone = 'positive' | 'accent' | 'negative'
export const TONE_HIGH = 0.7
export const TONE_MID = 0.45

export function scoreTone(fraction: number): ScoreTone {
  if (fraction >= TONE_HIGH) return 'positive'
  if (fraction >= TONE_MID) return 'accent'
  return 'negative'
}

export const TONE_COLOR: Record<ScoreTone, string> = {
  positive: 'var(--color-positive)',
  accent: 'var(--color-accent)',
  negative: 'var(--color-negative)',
}

export interface OverviewTile {
  label: string
  value: string
  sub: string
  tooltip: string
}

function unavailable(label: string, tooltip: string): OverviewTile {
  return { label, value: '—', sub: 'Unavailable', tooltip }
}

function pct2(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function overviewTiles(risk: RiskResponse | null, performance: PerformanceResponse | null): OverviewTile[] {
  const sharpeTip = 'Annualised return over the risk-free rate, divided by volatility, over the window shown.'
  const volatilityTip = 'Annualised standard deviation of daily returns, cash included.'
  const drawdownTip = 'The largest fall from a high to a later low over the window.'
  const holdingsTip = '1 ÷ HHI of the invested money: how many equal-sized holdings the portfolio behaves like.'
  const betaTip = "How much the portfolio's daily returns move with the market's."
  const largestTip = 'The single biggest position, as a share of the money that is invested.'

  const sharpe = performance?.metrics.sharpe
  const vol = performance?.metrics.vol
  const maxDrawdown = performance?.metrics.max_dd
  const beta = performance?.metrics.beta
  const effectiveHoldings = risk?.effective_holdings
  const hhi = risk?.hhi
  const largestHolding =
    risk?.holdings.reduce<(typeof risk.holdings)[number] | null>(
      (largest, holding) => (largest === null || holding.invested_weight > largest.invested_weight ? holding : largest),
      null,
    ) ?? null

  return [
    performance === null || sharpe == null
      ? unavailable('Sharpe', sharpeTip)
      : {
          label: 'Sharpe',
          value: sharpe.toFixed(2),
          sub: `${performance.start} → ${performance.end}`,
          tooltip: sharpeTip,
        },
    vol == null
      ? unavailable('Volatility', volatilityTip)
      : { label: 'Volatility', value: pct2(vol), sub: 'Annualised', tooltip: volatilityTip },
    maxDrawdown == null
      ? unavailable('Max drawdown', drawdownTip)
      : { label: 'Max drawdown', value: pct2(maxDrawdown), sub: 'Peak to trough', tooltip: drawdownTip },
    effectiveHoldings == null || hhi == null
      ? unavailable('Effective holdings', holdingsTip)
      : {
          label: 'Effective holdings',
          value: effectiveHoldings.toFixed(1),
          sub: `HHI ${hhi.toFixed(3)}`,
          tooltip: holdingsTip,
        },
    performance === null || beta == null
      ? unavailable('Beta', betaTip)
      : { label: 'Beta', value: beta.toFixed(2), sub: `vs ${performance.market_ticker}`, tooltip: betaTip },
    largestHolding === null
      ? unavailable('Largest holding', largestTip)
      : {
          label: 'Largest holding',
          value: `${largestHolding.ticker} ${(largestHolding.invested_weight * 100).toFixed(1)}%`,
          sub: 'Of the invested money',
          tooltip: largestTip,
        },
  ]
}
