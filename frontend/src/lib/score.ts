import type { CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import { walkForward } from './research'

export type ScoreKey = 'diversification' | 'risk_concentration' | 'volatility' | 'robustness'

export const SCORE_KEYS: readonly ScoreKey[] = ['diversification', 'risk_concentration', 'volatility', 'robustness']

export const SCORE_POINTS: Record<ScoreKey, number> = {
  diversification: 35,
  risk_concentration: 25,
  volatility: 20,
  robustness: 20,
}

export const SCORE_LABELS: Record<ScoreKey, string> = {
  diversification: 'Diversification',
  risk_concentration: 'Risk concentration',
  volatility: 'Volatility vs market',
  robustness: 'Holdout robustness',
}

export const DIVERSIFICATION_FULL = 20
export const RISK_SHARE_FULL = 0.1
export const RISK_SHARE_ZERO = 0.5
export const VOL_RATIO_FULL = 1.0
export const VOL_RATIO_ZERO = 2.0

export const SCORE_DISCLAIMER =
  'This score describes how the portfolio is built: how spread out its money and its risk are, how volatile ' +
  'it is next to the market, and how often it beat an equal-weight version of itself in past one-year ' +
  'holdouts. It does not predict returns. The weights (35, 25, 20, 20) are a judgment call, not fitted to ' +
  'any outcome. A high score does not mean the portfolio will do well, and a low score does not mean it ' +
  'will do badly.'

export interface ScoreComponent {
  key: ScoreKey
  label: string
  measured: string | null
  window: string | null
  subscore: number | null
  points: number | null
  maxPoints: number
}

export interface ResearchScore {
  total: number | null
  components: ScoreComponent[]
  missing: string[]
}

export function diversificationSubscore(effectiveHoldings: number): number {
  return effectiveHoldings <= 0 ? 0 : Math.min(effectiveHoldings / DIVERSIFICATION_FULL, 1)
}

export function riskConcentrationSubscore(largestRiskShare: number): number {
  if (largestRiskShare <= RISK_SHARE_FULL) return 1
  if (largestRiskShare >= RISK_SHARE_ZERO) return 0
  return (RISK_SHARE_ZERO - largestRiskShare) / (RISK_SHARE_ZERO - RISK_SHARE_FULL)
}

export function volatilitySubscore(volRatio: number): number {
  if (volRatio <= VOL_RATIO_FULL) return 1
  if (volRatio >= VOL_RATIO_ZERO) return 0
  return (VOL_RATIO_ZERO - volRatio) / (VOL_RATIO_ZERO - VOL_RATIO_FULL)
}

export function computeScore(
  risk: RiskResponse | null,
  performance: PerformanceResponse | null,
  compare: CompareResponse | null,
): ResearchScore {
  const components: ScoreComponent[] = []
  const missing: string[] = []

  // Diversification
  const diversificationComponent: ScoreComponent = {
    key: 'diversification',
    label: SCORE_LABELS['diversification'],
    measured: null,
    window: null,
    subscore: null,
    points: null,
    maxPoints: SCORE_POINTS['diversification'],
  }

  if (risk === null) {
    missing.push(diversificationComponent.label)
  } else {
    const n = risk.effective_holdings
    diversificationComponent.measured = `${n.toFixed(1)} effective holdings`
    diversificationComponent.window = `${risk.start} → ${risk.end}`
    diversificationComponent.subscore = diversificationSubscore(n)
    diversificationComponent.points = diversificationComponent.subscore * SCORE_POINTS['diversification']
  }
  components.push(diversificationComponent)

  // Risk concentration
  const riskConcentrationComponent: ScoreComponent = {
    key: 'risk_concentration',
    label: SCORE_LABELS['risk_concentration'],
    measured: null,
    window: null,
    subscore: null,
    points: null,
    maxPoints: SCORE_POINTS['risk_concentration'],
  }

  if (risk === null) {
    missing.push(riskConcentrationComponent.label)
  } else {
    let largestRiskShare: number | null = null
    let largestTicker: string | null = null

    for (const holding of risk.holdings) {
      if (holding.risk_share !== null) {
        if (largestRiskShare === null || holding.risk_share > largestRiskShare) {
          largestRiskShare = holding.risk_share
          largestTicker = holding.ticker
        }
      }
    }

    if (largestRiskShare === null) {
      missing.push(riskConcentrationComponent.label)
    } else {
      riskConcentrationComponent.measured = `${largestTicker} drives ${(largestRiskShare * 100).toFixed(1)}% of portfolio volatility`
      riskConcentrationComponent.window = `${risk.start} → ${risk.end}`
      riskConcentrationComponent.subscore = riskConcentrationSubscore(largestRiskShare)
      riskConcentrationComponent.points = riskConcentrationComponent.subscore * SCORE_POINTS['risk_concentration']
    }
  }
  components.push(riskConcentrationComponent)

  // Volatility vs market
  const volatilityComponent: ScoreComponent = {
    key: 'volatility',
    label: SCORE_LABELS['volatility'],
    measured: null,
    window: null,
    subscore: null,
    points: null,
    maxPoints: SCORE_POINTS['volatility'],
  }

  if (
    performance === null ||
    performance.metrics.vol === null ||
    performance.metrics.vol === undefined ||
    performance.bench_metrics === null ||
    performance.bench_metrics.vol === null ||
    performance.bench_metrics.vol === undefined ||
    performance.bench_metrics.vol <= 0
  ) {
    missing.push(volatilityComponent.label)
  } else {
    const pv = performance.metrics.vol
    const bv = performance.bench_metrics.vol
    const r = pv / bv
    volatilityComponent.measured = `${(pv * 100).toFixed(1)}% vs ${(bv * 100).toFixed(1)}% for ${performance.market_ticker} (${r.toFixed(2)}×)`
    volatilityComponent.window = `${performance.start} → ${performance.end}`
    volatilityComponent.subscore = volatilitySubscore(r)
    volatilityComponent.points = volatilityComponent.subscore * SCORE_POINTS['volatility']
  }
  components.push(volatilityComponent)

  // Robustness (holdout)
  const robustnessComponent: ScoreComponent = {
    key: 'robustness',
    label: SCORE_LABELS['robustness'],
    measured: null,
    window: null,
    subscore: null,
    points: null,
    maxPoints: SCORE_POINTS['robustness'],
  }

  if (compare === null) {
    missing.push(robustnessComponent.label)
  } else {
    const wf = walkForward(compare)
    const currentWf = wf['current']
    const beatEqual = currentWf.beatEqual

    if (beatEqual === null || beatEqual.of === 0) {
      missing.push(robustnessComponent.label)
    } else {
      const wins = beatEqual.wins
      const of = beatEqual.of
      robustnessComponent.measured = `Beat equal weight in ${wins} of ${of} year${of === 1 ? '' : 's'}`
      robustnessComponent.subscore = wins / of

      const validFolds = compare.folds.filter((fold) => fold.unavailable === null && fold.score_start !== null)

      if (validFolds.length > 0) {
        let earliestStart = validFolds[0].score_start!
        let latestEnd = validFolds[0].score_end

        for (const fold of validFolds.slice(1)) {
          if (fold.score_start! < earliestStart) earliestStart = fold.score_start!
          if (fold.score_end > latestEnd) latestEnd = fold.score_end
        }

        robustnessComponent.window = `${earliestStart} → ${latestEnd}`
      }

      robustnessComponent.points = robustnessComponent.subscore * SCORE_POINTS['robustness']
    }
  }
  components.push(robustnessComponent)

  let total: number | null = 0
  for (const component of components) {
    if (component.points === null) {
      total = null
      break
    }
    total += component.points
  }

  return {
    total,
    components,
    missing,
  }
}
