import type { AttributionContributions, AttributionResponse } from '../api/client'

export function signedPct(value: number): string {
  const text = (value * 100).toFixed(2)
  return value > 0 ? `+${text}%` : `${text}%`
}

function beta(r: AttributionResponse, key: 'market' | 'size' | 'value'): number {
  return r.loadings.find((loading) => loading.key === key)?.beta ?? 0
}

export function attributionSummary(r: AttributionResponse): string {
  const c = r.contributions
  const market = beta(r, 'market')
  const size = beta(r, 'size')
  const value = beta(r, 'value')
  const sentences = [
    `The portfolio returned ${signedPct(r.period_return)} from ${r.start} to ${r.end} (${r.n_obs} trading days).`,
  ]
  if (Math.abs(market) > 0.1)
    sentences.push(`Market exposure (beta ${market.toFixed(2)}) contributed ${signedPct(c.market)}.`)
  if (Math.abs(size) > 0.15)
    sentences.push(
      `${size > 0 ? 'Small-cap' : 'Large-cap'} tilt (SMB beta ${size.toFixed(2)}) contributed ${signedPct(c.size)}.`,
    )
  if (Math.abs(value) > 0.15)
    sentences.push(
      `${value > 0 ? 'Value' : 'Growth'} tilt (HML beta ${value.toFixed(2)}) contributed ${signedPct(c.value)}.`,
    )
  sentences.push(`Alpha contributed ${signedPct(c.alpha)} (${signedPct(r.alpha_annual)} a year).`)
  sentences.push(`T-bills contributed ${signedPct(c.risk_free)} and compounding ${signedPct(c.compounding)}.`)
  return sentences.join(' ')
}

export function attributionFootnote(r: AttributionResponse): string {
  return `R² = ${r.r_squared === null ? '—' : r.r_squared.toFixed(3)} · ${r.n_obs} observations · factor data through ${r.factor_end}`
}

function bar(value: number, scale: number): { positive: boolean; leftPct: number; widthPct: number } {
  const widthPct = scale === 0 ? 0 : (Math.abs(value) / scale) * 50
  return { positive: value >= 0, leftPct: value >= 0 ? 50 : 50 - widthPct, widthPct }
}

export interface LoadingRow {
  key: string
  label: string
  betaText: string
  tText: string
  significant: boolean
  positive: boolean
  leftPct: number
  widthPct: number
}

export function loadingRows(r: AttributionResponse): LoadingRow[] {
  const scale = Math.max(1, ...r.loadings.map((loading) => Math.abs(loading.beta)))
  return r.loadings.map((loading) => {
    const significant = loading.t_stat !== null && Math.abs(loading.t_stat) > 1.96
    const tText = loading.t_stat === null ? 't = —' : `t = ${loading.t_stat.toFixed(1)}${significant ? ' ★' : ''}`
    return {
      key: loading.key,
      label: loading.label,
      betaText: loading.beta.toFixed(3),
      tText,
      significant,
      ...bar(loading.beta, scale),
    }
  })
}

export interface ContributionRow {
  key: keyof AttributionContributions
  label: string
  tooltip: string
  value: number
  text: string
  positive: boolean
  leftPct: number
  widthPct: number
}

const CONTRIBUTION_ROWS: { key: keyof AttributionContributions; label: string; tooltip: string }[] = [
  {
    key: 'alpha',
    label: 'Alpha',
    tooltip: 'Return not explained by the three factors or T-bills: the daily intercept × the number of days.',
  },
  {
    key: 'market',
    label: 'Market (excess over T-bills)',
    tooltip: "Market beta × the sum of the market's daily return above T-bills.",
  },
  {
    key: 'size',
    label: 'Size (SMB)',
    tooltip: 'Size beta × the sum of SMB, small caps minus big caps.',
  },
  {
    key: 'value',
    label: 'Value (HML)',
    tooltip: 'Value beta × the sum of HML, cheap stocks minus expensive ones.',
  },
  {
    key: 'risk_free',
    label: 'Risk-free (T-bills)',
    tooltip: 'What one-month T-bills paid over the window, part of every return.',
  },
  {
    key: 'compounding',
    label: 'Compounding',
    tooltip: 'The compounded return minus the plain sum of daily returns. The other five add up to that plain sum.',
  },
]

export function contributionRows(r: AttributionResponse): ContributionRow[] {
  const max = Math.max(...CONTRIBUTION_ROWS.map((row) => Math.abs(r.contributions[row.key])))
  return CONTRIBUTION_ROWS.map((row) => {
    const value = r.contributions[row.key]
    return { ...row, value, text: signedPct(value), ...bar(value, max) }
  })
}
