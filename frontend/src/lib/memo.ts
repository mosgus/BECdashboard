import type { CompareResponse, RiskResponse } from '../api/client'
import type { Portfolio } from './portfolio'

export type Recommendation = 'GO' | 'CONDITIONAL' | 'NO-GO'
export const RECOMMENDATIONS: readonly Recommendation[] = ['GO', 'CONDITIONAL', 'NO-GO']
export type FlagSeverity = 'high' | 'medium'

export interface RedFlag {
  id: string
  severity: FlagSeverity
  title: string
  detail: string
}

/** weight: % of the whole portfolio, as Position.weight. */
export interface MemoHolding {
  ticker: string
  weight: number
  shares?: number
}

export interface MemoEvidence {
  effectiveHoldings: number | null
  holdingsCount: number | null
  largest: { ticker: string; investedWeight: number } | null
  topRiskShare: { ticker: string; share: number } | null
  riskWindow: { start: string; end: string } | null
  holdoutSharpe: number | null
  equalWeightHoldoutSharpe: number | null
  holdoutWindow: { start: string; end: string } | null
  maxDrawdown: number | null
  drawdownWindow: { start: string; end: string } | null
  untested: string[]
}

export interface DecisionMemo {
  id: string
  portfolioId: string
  createdAt: string
  recommendation: Recommendation
  rationale: string
  monitoringPlan: string
  redFlags: RedFlag[]
  holdings: MemoHolding[]
  cashWeight: number
  cashDollars?: number
  /** null only when both evidence requests failed. */
  evidence: MemoEvidence | null
}

export const EFFECTIVE_HOLDINGS_MIN = 5
export const EFFECTIVE_HOLDINGS_HIGH = 3
export const LARGEST_HOLDING_MAX = 0.25
export const LARGEST_HOLDING_HIGH = 0.4
export const RISK_SHARE_MAX = 0.4
export const DRAWDOWN_LIMIT = -0.2

/** Percentage points. Shares-less holdings and cash weights may differ by this much before "changed". */
const WEIGHT_TOLERANCE = 0.5

export function buildEvidence(risk: RiskResponse | null, compare: CompareResponse | null): MemoEvidence | null {
  if (risk === null && compare === null) return null

  let largest: MemoEvidence['largest'] = null
  let topRiskShare: MemoEvidence['topRiskShare'] = null
  if (risk !== null) {
    for (const holding of risk.holdings) {
      if (largest === null || holding.invested_weight > largest.investedWeight) {
        largest = { ticker: holding.ticker, investedWeight: holding.invested_weight }
      }
      if (holding.risk_share !== null && (topRiskShare === null || holding.risk_share > topRiskShare.share)) {
        topRiskShare = { ticker: holding.ticker, share: holding.risk_share }
      }
    }
  }

  const holdout = compare?.holdout ?? null
  const equalWeight = compare?.modes.find((mode) => mode.mode === 'equal_weight')
  const untested = compare === null ? [] : [...new Set([...compare.pinned, ...(holdout?.excluded ?? [])])].sort()

  return {
    effectiveHoldings: risk?.effective_holdings ?? null,
    holdingsCount: risk === null ? null : risk.holdings.length,
    largest,
    topRiskShare,
    riskWindow: risk === null ? null : { start: risk.start, end: risk.end },
    holdoutSharpe: compare?.current.holdout?.sharpe ?? null,
    equalWeightHoldoutSharpe: equalWeight?.holdout?.sharpe ?? null,
    holdoutWindow: holdout === null ? null : { start: holdout.score_start, end: holdout.score_end },
    maxDrawdown: compare?.current.in_sample.max_dd ?? null,
    drawdownWindow: compare === null ? null : { start: compare.fit_start, end: compare.fit_end },
    untested,
  }
}

function pct(value: number): string {
  return (value * 100).toFixed(1)
}

function windowText(window: { start: string; end: string } | null): string {
  return window === null ? '' : `${window.start} → ${window.end}`
}

export function deriveRedFlags(evidence: MemoEvidence | null): RedFlag[] {
  if (evidence === null) return []
  const flags: RedFlag[] = []
  const { effectiveHoldings, largest, topRiskShare, holdoutSharpe, equalWeightHoldoutSharpe, maxDrawdown } = evidence

  if (effectiveHoldings !== null && effectiveHoldings < EFFECTIVE_HOLDINGS_MIN) {
    flags.push({
      id: 'concentration',
      severity: effectiveHoldings < EFFECTIVE_HOLDINGS_HIGH ? 'high' : 'medium',
      title: 'Concentrated portfolio',
      detail: `Effective holdings ${effectiveHoldings.toFixed(1)} of ${evidence.holdingsCount ?? '—'} (1 ÷ HHI of the invested money).`,
    })
  }
  if (largest !== null && largest.investedWeight > LARGEST_HOLDING_MAX) {
    flags.push({
      id: 'largest-holding',
      severity: largest.investedWeight > LARGEST_HOLDING_HIGH ? 'high' : 'medium',
      title: 'One holding dominates',
      detail: `${largest.ticker} is ${pct(largest.investedWeight)}% of the invested money.`,
    })
  }
  if (topRiskShare !== null && topRiskShare.share > RISK_SHARE_MAX) {
    flags.push({
      id: 'risk-share',
      severity: 'medium',
      title: 'One holding drives the risk',
      detail: `${topRiskShare.ticker} contributes ${pct(topRiskShare.share)}% of portfolio volatility.`,
    })
  }
  if (holdoutSharpe !== null && holdoutSharpe < 0) {
    flags.push({
      id: 'holdout-negative',
      severity: 'high',
      title: 'Negative Sharpe over the last 12 months',
      detail: `Sharpe ${holdoutSharpe.toFixed(2)} on ${windowText(evidence.holdoutWindow)}.`,
    })
  }
  if (holdoutSharpe !== null && equalWeightHoldoutSharpe !== null && holdoutSharpe < equalWeightHoldoutSharpe) {
    flags.push({
      id: 'behind-equal-weight',
      severity: 'medium',
      title: 'Equal weight did better over the last 12 months',
      detail: `Sharpe ${holdoutSharpe.toFixed(2)} vs ${equalWeightHoldoutSharpe.toFixed(2)} for equal weight (1/N), on ${windowText(evidence.holdoutWindow)}.`,
    })
  }
  if (maxDrawdown !== null && maxDrawdown < DRAWDOWN_LIMIT) {
    flags.push({
      id: 'drawdown',
      severity: 'medium',
      title: 'Deep drawdown',
      detail: `Max drawdown ${pct(maxDrawdown)}% on ${windowText(evidence.drawdownWindow)}.`,
    })
  }
  if (evidence.untested.length > 0) {
    flags.push({
      id: 'short-history',
      severity: 'medium',
      title: 'Too little history to test',
      detail: `${evidence.untested.join(', ')}: not enough prices for the optimizer fit or the holdout.`,
    })
  }
  return flags
}

export function memoHoldings(portfolio: Portfolio): MemoHolding[] {
  return portfolio.positions.map((position) => ({
    ticker: position.ticker,
    weight: position.weight,
    ...(position.shares === undefined ? {} : { shares: position.shares }),
  }))
}

export function holdingsChanged(memo: DecisionMemo, portfolio: Portfolio): boolean {
  const current = new Map(portfolio.positions.map((position) => [position.ticker, position]))
  const saved = new Map(memo.holdings.map((holding) => [holding.ticker, holding]))
  if (current.size !== saved.size) return true
  for (const [ticker, holding] of saved) {
    const now = current.get(ticker)
    if (now === undefined) return true
    if (holding.shares !== undefined && now.shares !== undefined) {
      if (holding.shares !== now.shares) return true
    } else if (Math.abs(holding.weight - now.weight) > WEIGHT_TOLERANCE) {
      return true
    }
  }
  if (memo.cashDollars !== undefined && portfolio.cashDollars !== undefined) {
    return memo.cashDollars !== portfolio.cashDollars
  }
  return Math.abs(memo.cashWeight - portfolio.cashWeight) > WEIGHT_TOLERANCE
}
