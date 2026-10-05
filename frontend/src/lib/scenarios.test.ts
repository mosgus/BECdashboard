import { describe, expect, it } from 'vitest'
import type { RiskResponse, StressResponse } from '../api/client'
import { STRESS_PRESETS } from './stress'
import {
  PRESET_TAGS,
  comparisonRows,
  contributionBars,
  marketShock,
  parseVolScale,
  replay,
  replayCurve,
  replayInterpretation,
  volShock,
} from './scenarios'

const R: RiskResponse = {
  tickers: ['A', 'B'],
  holdings: [
    { ticker: 'A', weight: 0.4, invested_weight: 0.5, vol: 0.3, beta: 1.2, risk_share: 0.7 },
    { ticker: 'B', weight: 0.4, invested_weight: 0.5, vol: 0.15, beta: 0.6, risk_share: 0.3 },
  ],
  market_ticker: 'SPY',
  lookback_days: 365,
  start: '2025-01-02',
  end: '2026-01-02',
  n_returns: 250,
  cash_weight: 0.2,
  portfolio_vol: 0.2,
  portfolio_beta: 0.72,
  hhi: 0.5,
  effective_holdings: 2,
  top5_weight: 1,
  warnings: [],
}
const S: StressResponse = {
  tickers: ['A', 'B', 'C'],
  market_ticker: 'SPY',
  start: '2025-02-19',
  end: '2025-04-08',
  n_days: 33,
  cash_weight: 0.2,
  coverage: 0.875,
  portfolio_return: -0.123,
  max_drawdown: -0.15,
  worst_day: -0.045,
  worst_day_date: '2025-04-04',
  market_return: -0.188,
  warnings: [],
  holdings: [
    { ticker: 'A', weight: 0.5, covered: true, asset_return: -0.2, contribution: -0.1 },
    { ticker: 'B', weight: 0.2, covered: true, asset_return: -0.115, contribution: -0.023 },
    { ticker: 'C', weight: 0.1, covered: false, asset_return: null, contribution: null },
  ],
  path: [
    { date: '2025-02-19', value: 1, market: 1 },
    { date: '2025-04-08', value: 0.877, market: 0.812 },
  ],
}
const CRASH = { start: '2020-02-19', end: '2020-03-23' }
const CUSTOM = { start: '2021-01-04', end: '2021-06-30' }

describe('scenarios', () => {
  it('market shock down', () => {
    const r = marketShock(R, -20, 1)
    expect(r.impact).toBeCloseTo(-0.144)
    expect(r.rows.map((row) => row.ticker)).toEqual(['A', 'B'])
    expect(r.rows[0].impact).toBeCloseTo(-0.096)
    expect(r.rows[1].impact).toBeCloseTo(-0.048)
  })
  it('market shock up', () => {
    const r = marketShock(R, 10, 1)
    expect(r.impact).toBeCloseTo(0.072)
    expect(r.rows.map((row) => row.ticker)).toEqual(['B', 'A'])
    expect(r.rows[0].impact).toBeCloseTo(0.024)
    expect(r.rows[1].impact).toBeCloseTo(0.048)
  })
  it('vol shock', () => {
    const r = volShock(R, 2, 1)
    expect(r.baseVol).toBe(0.2)
    expect(r.shockedVol).toBeCloseTo(0.4)
  })
  it('parses vol scale', () => {
    expect(parseVolScale(' 1.5 ')).toEqual({ ok: true, value: 1.5 })
    expect(parseVolScale('1.5x')).toEqual({ ok: true, value: 1.5 })
    for (const text of ['0', '11', 'abc']) expect(parseVolScale(text).ok).toBe(false)
  })
  it('replay matches presets and finds best day', () => {
    expect(replay(S, CRASH, 1).preset?.name).toBe('COVID crash')
    expect(replay(S, CUSTOM, 1).preset).toBeNull()
    for (const preset of STRESS_PRESETS) expect(PRESET_TAGS[preset.id]?.length).toBeGreaterThan(0)
    const path = [1, 0.9, 0.95, 0.93].map((value, i) => ({ date: `2025-01-0${i + 2}`, value, market: null }))
    expect(replay({ ...S, path }, CRASH, 1).bestDay).toBeCloseTo(0.05556, 4)
  })
  it('replay curve', () => {
    const path = [
      { date: '2025-01-02', value: 1, market: null },
      { date: '2025-01-03', value: 1.1, market: null },
      { date: '2025-01-06', value: 0.99, market: null },
    ]
    const last = replayCurve({ ...S, path }).at(-1)
    expect(last?.ret).toBeCloseTo(-1)
    expect(last?.drawdown).toBeCloseTo(-10)
    expect(last?.market).toBeNull()
  })
  it('contribution bars', () => {
    expect(contributionBars(S).map((bar) => bar.ticker)).toEqual(['A', 'B'])
    const holdings = Array.from({ length: 15 }, (_, i) => ({
      ticker: `T${i}`,
      weight: 0.05,
      covered: true,
      asset_return: 0,
      contribution: (i - 7) / 100,
    }))
    const bars = contributionBars({ ...S, holdings })
    expect(bars).toHaveLength(12)
    expect(new Set(bars.map((bar) => bar.ticker)).size).toBe(12)
    expect(bars[0].pct).toBeCloseTo(-7)
    expect(bars[11].pct).toBeCloseTo(7)
  })
  it('comparison rows', () => {
    const rows = comparisonRows([replay(S, CRASH, 1), replay(S, CUSTOM, 2), marketShock(R, -20, 3)])
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.name)).toEqual(['COVID crash', '2021-01-04 → 2021-06-30'])
    expect(rows[0].totalReturn).toBeCloseTo(-12.3)
    expect(rows[0].maxDrawdown).toBeCloseTo(-15)
  })
  it('interpretation', () => {
    expect(replayInterpretation(S)).toBe(
      'Over this 33-day window, the portfolio lost 12.3%, while SPY fell 18.8%. Deepest drawdown: -15.0%. 0 of 2 holdings with prices contributed positively.',
    )
    expect(replayInterpretation({ ...S, market_return: null })).not.toContain('while')
  })
  it('has ten unique presets in chronological order', () => {
    const ids = STRESS_PRESETS.map((p) => p.id)
    expect(ids).toHaveLength(10)
    expect(new Set(ids).size).toBe(10)
    const starts = STRESS_PRESETS.map((p) => p.start)
    expect(starts).toEqual([...starts].sort())
    expect(STRESS_PRESETS[0].id).toBe('dot-com')
    expect(PRESET_TAGS['volmageddon-2018']).toEqual(['vol-shock'])
  })
})
