import type { RiskResponse } from '../api/client'
import type { MetricItem } from './optimize'

export interface HealthRow {
  ticker: string
  weight: number
  rc: number | null
  mctr: number | null
  vol: number
  beta: number
}

export interface Mitigation {
  severity: 'high' | 'medium' | 'low'
  title: string
  body: string
  action?: string
  link?: { to: string; label: string }
}

export function healthCards(r: RiskResponse): MetricItem[] {
  return [
    {
      label: 'HHI',
      value: r.hhi.toFixed(4),
      tooltip:
        'Herfindahl-Hirschman Index: the sum of squared weights of the invested money. 1/N is perfectly spread, 1.0 is a single holding. Higher means more concentrated.',
    },
    {
      label: 'N_eff',
      value: r.effective_holdings.toFixed(2),
      tooltip: 'Effective N = 1 / HHI: how many equal-sized holdings would be this concentrated.',
    },
    {
      label: 'Top 5',
      value: `${(r.top5_weight * 100).toFixed(1)}%`,
      tooltip: 'Share of the invested money in the five largest holdings.',
    },
    {
      label: 'Beta',
      value: r.portfolio_beta.toFixed(3),
      tooltip: `How much the whole portfolio moves per 1% move in ${r.market_ticker} over the lookback. Cash counts as a beta of 0.`,
    },
    {
      label: 'Ann. Vol',
      value: `${(r.portfolio_vol * 100).toFixed(2)}%`,
      tooltip: 'Annualised volatility of the whole portfolio, cash included, over the lookback.',
    },
  ]
}

export function healthRows(r: RiskResponse): HealthRow[] {
  return r.holdings
    .map((holding) => ({
      ticker: holding.ticker,
      weight: holding.invested_weight,
      rc: holding.risk_share,
      mctr:
        holding.risk_share === null || holding.weight <= 0
          ? null
          : (holding.risk_share * r.portfolio_vol) / holding.weight,
      vol: holding.vol,
      beta: holding.beta,
    }))
    .sort((a, b) => (b.rc ?? -Infinity) - (a.rc ?? -Infinity))
}

export function healthChartData(
  rows: HealthRow[],
): { ticker: string; weightPct: number; rcPct: number; mctr: number | null }[] {
  return rows
    .filter((row) => row.rc !== null)
    .slice(0, 20)
    .map((row) => ({ ticker: row.ticker, weightPct: row.weight * 100, rcPct: (row.rc ?? 0) * 100, mctr: row.mctr }))
}

export function mitigations(r: RiskResponse, portfolioId: string): Mitigation[] {
  const items: Mitigation[] = []
  const optimizeLink = { to: `/portfolios/${portfolioId}/optimize`, label: 'Go to Historical Optimize →' }
  const outlookLink = { to: `/portfolios/${portfolioId}/outlook`, label: 'Go to Forward Models →' }

  if (r.hhi > 0.15) {
    items.push({
      severity: 'high',
      title: 'High concentration risk',
      body: `HHI of ${r.hhi.toFixed(3)} indicates a concentrated portfolio. Top 5 holdings account for ${(r.top5_weight * 100).toFixed(1)}% of the portfolio.`,
      action: 'Consider the Risk Parity or Max Diversification modes in Historical Optimize.',
      link: optimizeLink,
    })
  } else if (r.hhi > 0.08) {
    items.push({
      severity: 'medium',
      title: 'Moderate concentration',
      body: `HHI of ${r.hhi.toFixed(3)} — portfolio is moderately concentrated. Consider adding positions to improve diversification.`,
    })
  }

  if (r.portfolio_beta > 1.3) {
    items.push({
      severity: 'high',
      title: 'High market sensitivity',
      body: `Portfolio beta of ${r.portfolio_beta.toFixed(2)} amplifies market swings by ${((r.portfolio_beta - 1) * 100).toFixed(0)}%.`,
      action: 'Consider adding defensive sectors (XLP, XLV, utilities) or non-correlated assets (GLD, bonds).',
      link: outlookLink,
    })
  } else if (r.portfolio_beta > 1.1) {
    items.push({
      severity: 'medium',
      title: 'Above-market sensitivity',
      body: `Beta of ${r.portfolio_beta.toFixed(2)} — portfolio moves more than the market. CAPM Allocation in Forward Models can explore alternatives.`,
      link: outlookLink,
    })
  }

  if (r.portfolio_vol > 0.25) {
    items.push({
      severity: 'high',
      title: 'Elevated volatility',
      body: `Annualised vol of ${(r.portfolio_vol * 100).toFixed(1)}% is significantly above typical balanced portfolios (12-18%).`,
      action: 'Consider the Target Volatility mode in Historical Optimize to scale down to a comfortable vol level.',
      link: optimizeLink,
    })
  } else if (r.portfolio_vol > 0.2) {
    items.push({
      severity: 'medium',
      title: 'Above-average volatility',
      body: `Annualised vol of ${(r.portfolio_vol * 100).toFixed(1)}%. Min Variance in Historical Optimize can reduce this while staying fully invested.`,
      link: optimizeLink,
    })
  }

  return items.length > 0
    ? items
    : [
        {
          severity: 'low',
          title: 'Portfolio health looks good',
          body: 'No major concentration, beta, or volatility concerns detected. Continue monitoring periodically.',
        },
      ]
}
