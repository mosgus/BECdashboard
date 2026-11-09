import { describe, expect, it } from 'vitest'
import type { AttributionResponse, CompareResponse, PerformanceResponse, RiskResponse } from '../api/client'
import type { DecisionMemo } from './memo'
import { buildResearchReport, pdfScoreVisual, REPORT_SECTIONS, reportFilename, tintHex, toPdfText } from './reportPdf'
import type { ReportInput } from './reportPdf'
import { computeScore } from './score'

const risk: RiskResponse = {
  tickers: ['MSFT', 'AAPL'],
  holdings: [
    { ticker: 'MSFT', weight: 0.55, invested_weight: 0.55, vol: 0.24, beta: 1.1, risk_share: 0.6 },
    { ticker: 'AAPL', weight: 0.45, invested_weight: 0.45, vol: 0.3, beta: 1.2, risk_share: 0.4 },
  ],
  market_ticker: 'SPY',
  lookback_days: 365,
  start: '2025-11-07',
  end: '2026-11-06',
  n_returns: 252,
  cash_weight: 0,
  portfolio_vol: 0.25,
  portfolio_beta: 1.15,
  hhi: 0.505,
  effective_holdings: 1.98,
  top5_weight: 1,
  warnings: [],
}

const performance: PerformanceResponse = {
  market_ticker: 'SPY',
  start: '2025-11-07',
  end: '2026-11-06',
  n_days: 252,
  cash_weight: 0,
  coverage: 1,
  rf: 0.04,
  rf_source: 'live',
  metrics: { cagr: 0.12, vol: 0.25, sharpe: 0.8, max_dd: -0.2, beta: 1.15, alpha: 0.02 },
  bench_metrics: { cagr: 0.1, vol: 0.18, sharpe: 0.7, max_dd: -0.15 },
  path: [],
  warnings: [],
}

const compare: CompareResponse = {
  tickers: ['MSFT', 'AAPL'],
  current_weights: { MSFT: 0.55, AAPL: 0.45 },
  pinned: [],
  lookback_days: 365,
  rebalance: 'none',
  rf: 0.04,
  rf_source: 'live',
  fit_start: '2024-11-07',
  fit_end: '2025-11-06',
  score_start: '2025-11-07',
  current: {
    in_sample: { cagr: 0.12, vol: 0.25, sharpe: 0.8, max_dd: -0.2 },
    holdout: { cagr: 0.11, vol: 0.24, sharpe: 0.9, max_dd: -0.18 },
    point: null,
  },
  modes: [
    {
      mode: 'equal_weight',
      error: null,
      feasible: true,
      target_weights: { MSFT: 0.5, AAPL: 0.5 },
      traded: 0.05,
      in_sample: { cagr: 0.1, vol: 0.2, sharpe: 0.7, max_dd: -0.16 },
      point: null,
      holdout_weights: { MSFT: 0.5, AAPL: 0.5 },
      holdout: { cagr: 0.09, vol: 0.19, sharpe: 0.5, max_dd: -0.15 },
      holdout_error: null,
    },
  ],
  folds: [
    {
      fold: 1,
      cut: '2025-11-06',
      score_end: '2026-11-06',
      fit_start: '2024-11-07',
      fit_end: '2025-11-06',
      score_start: '2025-11-07',
      tickers: ['MSFT', 'AAPL'],
      excluded: [],
      vol_target: null,
      unavailable: null,
      current: { cagr: 0.11, vol: 0.24, sharpe: 0.9, max_dd: -0.18 },
      modes: [{ mode: 'equal_weight', holdout: { cagr: 0.09, vol: 0.19, sharpe: 0.5, max_dd: -0.15 }, error: null }],
    },
  ],
  vol_target: 0.25,
  holdout: {
    fit_start: '2024-11-07',
    fit_end: '2025-11-06',
    score_start: '2025-11-07',
    score_end: '2026-11-06',
    tickers: ['MSFT', 'AAPL'],
    excluded: [],
  },
  holdout_unavailable: null,
  frontier: null,
  correlation: null,
  warnings: [],
}

const attribution: AttributionResponse = {
  market_ticker: 'SPY',
  start: '2025-11-07',
  end: '2026-11-06',
  factor_end: '2026-10-31',
  n_obs: 250,
  cash_weight: 0,
  coverage: 1,
  period_return: 0.12,
  alpha_daily: 0.0001,
  alpha_annual: 0.025,
  r_squared: 0.85,
  loadings: [
    { key: 'market', label: 'Market', beta: 1.1, t_stat: 2.5 },
    { key: 'size', label: 'Size (SMB)', beta: 0.1, t_stat: null },
    { key: 'value', label: 'Value (HML)', beta: -0.05, t_stat: -1.2 },
  ],
  contributions: { alpha: 0.02, market: 0.08, size: 0.01, value: -0.01, risk_free: 0.03, compounding: 0.002 },
  source: 'stored factors',
  warnings: [],
}

const memo: DecisionMemo = {
  id: 'memo-1',
  portfolioId: 'portfolio-1',
  createdAt: '2026-11-08T12:00:00.000Z',
  recommendation: 'CONDITIONAL',
  rationale: 'Keep monitoring this portfolio → 日',
  monitoringPlan: 'Review the weights next quarter.',
  redFlags: [{ id: 'flag-1', severity: 'medium', title: 'Concentration', detail: 'Two holdings' }],
  holdings: [
    { ticker: 'MSFT', weight: 55 },
    { ticker: 'AAPL', weight: 45 },
  ],
  cashWeight: 0,
  evidence: null,
}

const fullInput: ReportInput = {
  portfolioName: 'Growth Portfolio',
  generatedOn: '2026-11-08',
  holdingsCount: 2,
  cashPct: 0,
  score: computeScore(risk, performance, compare),
  risk,
  performance,
  compare,
  attribution,
  errors: {},
  memo,
  memoHoldingsChanged: false,
}

describe('reportPdf', () => {
  it('maps unsupported characters to WinAnsi-safe text', () => {
    expect(toPdfText('2023-01-01 → 2026-01-01')).toBe('2023-01-01 to 2026-01-01')
    expect(toPdfText('t = 2.4 ★')).toBe('t = 2.4 *')
    expect(toPdfText('−0.50')).toBe('-0.50')
    expect(toPdfText('x ≥ 1')).toBe('x >= 1')
    expect(toPdfText('a — b · c × d')).toBe('a — b · c × d')
    expect(toPdfText('日本')).toBe('??')
    expect(toPdfText('line1\nline2')).toBe('line1\nline2')
  })

  it('creates a safe research report filename', () => {
    expect(reportFilename('BEC Growth / 2026', '2026-11-08')).toBe('BEC_Growth___2026_research_2026-11-08.pdf')
  })

  it('tints score tones into light-theme fills', () => {
    expect(tintHex('#16a34a', 10)).toBe('#e8f6ed')
    expect(tintHex('#F2A900', 10)).toBe('#fef6e6')
    expect(tintHex('#dc2626', 10)).toBe('#fce9e9')
  })

  it('builds a coloured score ring and bars from the shared score tones', () => {
    const visual = pdfScoreVisual(computeScore(risk, performance, compare))
    expect(visual.ring).toEqual({ text: '36', strokeHex: '#dc2626', fillHex: '#fce9e9' })
    expect(visual.bars.map((bar) => bar.fillHex)).toEqual(['#dc2626', '#dc2626', '#F2A900', '#16a34a'])
    expect(visual.bars.map((bar) => bar.points)).toEqual(['3.5 / 35', '0.0 / 25', '12.2 / 20', '20.0 / 20'])
  })

  it('leaves unavailable score tones empty', () => {
    const visual = pdfScoreVisual(computeScore(null, null, null))
    expect(visual.ring).toEqual({ text: '—', strokeHex: '#dde3f0', fillHex: '#ffffff' })
    expect(visual.bars.every((bar) => bar.fillHex === null)).toBe(true)
    expect(visual.bars.map((bar) => bar.points)).toEqual(['— / 35', '— / 25', '— / 20', '— / 20'])
  })

  it('keeps the required report sections in order', () => {
    expect(REPORT_SECTIONS.map((section) => section.title)).toEqual([
      'Research Score',
      'Performance',
      'Holdings and risk',
      'Factor attribution',
      'Optimizer comparison',
      'Decision memo',
      'How the score is calculated',
    ])
  })

  it('draws all report sections with sanitized selectable text and page numbers', () => {
    const doc = buildResearchReport(fullInput)
    const output = doc.output()
    for (const title of [
      'Research Score',
      'Performance',
      'Holdings and risk',
      'Factor attribution',
      'Optimizer comparison',
      'Decision memo',
      'How the score is calculated',
    ]) {
      expect(output).toContain(`(${title}) Tj`)
    }
    expect(output).toContain('(How the score works) Tj')
    expect(output).toContain('(What is not scored) Tj')
    expect(output.includes('\u0000')).toBe(false)
    const pages = doc.getNumberOfPages()
    expect(output).toContain(`Page ${pages} of ${pages}`)
  })

  it('prints unavailable states and a missing memo without throwing', () => {
    const doc = buildResearchReport({
      ...fullInput,
      score: computeScore(null, null, null),
      risk: null,
      performance: null,
      compare: null,
      attribution: null,
      errors: { risk: 'boom' },
      memo: null,
      memoHoldingsChanged: false,
    })
    const output = doc.output()
    expect(output).toContain('(Unavailable: boom) Tj')
    expect(output).toContain('(Unavailable: not loaded) Tj')
    expect(output).toContain('(No decision memo recorded.) Tj')
    expect(output).toContain('(/ 100) Tj')
    expect(output.includes('\u0000')).toBe(false)
  })

  it('paginates long rationale text without corrupting PDF text', () => {
    const normal = buildResearchReport(fullInput)
    const long = buildResearchReport({
      ...fullInput,
      memo: { ...memo, rationale: 'Long rationale. '.repeat(600) },
    })
    expect(long.getNumberOfPages()).toBeGreaterThan(normal.getNumberOfPages())
    expect(long.output().includes('\u0000')).toBe(false)
  })

  it('wraps paragraphs at the full content width', () => {
    const longInput = {
      ...fullInput,
      memo: { ...memo, rationale: 'Long rationale. '.repeat(600) },
    }
    const doc = buildResearchReport(longInput)
    const lines = [...doc.output().matchAll(/\(([^)]*rationale\.[^)]*)\) Tj/g)].map((m) => m[1])
    expect(lines.length).toBeGreaterThan(10)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const widest = Math.max(...lines.map((line) => doc.getTextWidth(line)))
    expect(widest).toBeGreaterThan(150)
    expect(widest).toBeLessThanOrEqual(180)
  })
})
