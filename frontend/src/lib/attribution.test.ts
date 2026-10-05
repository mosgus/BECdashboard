import { describe, expect, it } from 'vitest'
import type { AttributionResponse } from '../api/client'
import { attributionFootnote, attributionSummary, contributionRows, loadingRows, signedPct } from './attribution'

const R: AttributionResponse = {
  market_ticker: 'SPY',
  start: '2025-09-02',
  end: '2026-08-31',
  factor_end: '2026-08-31',
  n_obs: 250,
  cash_weight: 0.4,
  coverage: 1,
  period_return: 0.192,
  alpha_daily: 0.00006,
  alpha_annual: 0.0154,
  r_squared: 0.646,
  loadings: [
    { key: 'market', label: 'Market (Mkt-RF)', beta: 0.742, t_stat: 19.04 },
    { key: 'size', label: 'Size (SMB)', beta: 0.008, t_stat: 0.21 },
    { key: 'value', label: 'Value (HML)', beta: 0.108, t_stat: 2.61 },
  ],
  contributions: { alpha: 0.0151, market: 0.1165, size: 0.0001, value: 0.0109, risk_free: 0.0396, compounding: 0.0097 },
  source: 'Kenneth R. French Data Library — daily Fama/French 3 factors',
  warnings: [
    'Cash (40.0% at the start) is counted at 0% return, so alpha is about 1.60% a year lower than if it earned the T-bill rate.',
  ],
}

function withBetas(size: number, sizeC: number, value: number, valueC: number): AttributionResponse {
  return {
    ...R,
    loadings: R.loadings.map((l) =>
      l.key === 'size' ? { ...l, beta: size } : l.key === 'value' ? { ...l, beta: value } : l,
    ),
    contributions: { ...R.contributions, size: sizeC, value: valueC },
  }
}

describe('attribution', () => {
  it('formats signed percentages', () => {
    expect(signedPct(0.192)).toBe('+19.20%')
    expect(signedPct(-0.0123)).toBe('-1.23%')
    expect(signedPct(0)).toBe('0.00%')
  })

  it('summarises with only the market tilt above threshold', () => {
    expect(attributionSummary(R)).toBe(
      'The portfolio returned +19.20% from 2025-09-02 to 2026-08-31 (250 trading days). Market exposure (beta 0.74) contributed +11.65%. Alpha contributed +1.51% (+1.54% a year). T-bills contributed +3.96% and compounding +0.97%.',
    )
  })

  it('names the tilts by sign', () => {
    const a = attributionSummary(withBetas(-0.3, -0.0123, 0.25, 0.02))
    expect(a).toContain('Large-cap tilt (SMB beta -0.30) contributed -1.23%.')
    expect(a).toContain('Value tilt (HML beta 0.25) contributed +2.00%.')
    const b = attributionSummary(withBetas(0.3, 0.01, -0.25, -0.02))
    expect(b).toContain('Small-cap tilt')
    expect(b).toContain('Growth tilt')
  })

  it('writes the footnote', () => {
    expect(attributionFootnote(R)).toBe('R² = 0.646 · 250 observations · factor data through 2026-08-31')
    expect(attributionFootnote({ ...R, r_squared: null }).startsWith('R² = — ·')).toBe(true)
  })

  it('builds loading rows', () => {
    const rows = loadingRows(R)
    expect(rows.map((r) => r.betaText)).toEqual(['0.742', '0.008', '0.108'])
    expect(rows.map((r) => r.tText)).toEqual(['t = 19.0 ★', 't = 0.2', 't = 2.6 ★'])
    expect(rows[0].leftPct).toBe(50)
    expect(rows[0].widthPct).toBeCloseTo(37.1)
  })

  it('scales loading bars past beta 1 and handles a missing t-stat', () => {
    const rows = loadingRows({
      ...R,
      loadings: [
        { key: 'market', label: 'Market (Mkt-RF)', beta: 1.6, t_stat: 10 },
        R.loadings[1],
        { key: 'value', label: 'Value (HML)', beta: -0.4, t_stat: null },
      ],
    })
    expect(rows[0].widthPct).toBe(50)
    expect(rows[2].widthPct).toBeCloseTo(12.5)
    expect(rows[2].leftPct).toBeCloseTo(37.5)
    expect(rows[2].positive).toBe(false)
    expect(rows[2].tText).toBe('t = —')
  })

  it('builds contribution rows', () => {
    const rows = contributionRows(R)
    expect(rows.map((r) => r.key)).toEqual(['alpha', 'market', 'size', 'value', 'risk_free', 'compounding'])
    expect(rows.map((r) => r.label)).toEqual([
      'Alpha',
      'Market (excess over T-bills)',
      'Size (SMB)',
      'Value (HML)',
      'Risk-free (T-bills)',
      'Compounding',
    ])
    expect(rows[1].widthPct).toBe(50)
    expect(rows[1].text).toBe('+11.65%')
    const negative = contributionRows({ ...R, contributions: { ...R.contributions, alpha: -0.05 } })[0]
    expect(negative.positive).toBe(false)
    expect(negative.leftPct).toBeCloseTo(50 - (0.05 / 0.1165) * 50)
    expect(negative.text).toBe('-5.00%')
  })
})
