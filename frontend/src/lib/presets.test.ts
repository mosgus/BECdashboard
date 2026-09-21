import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { summariseDraft } from './portfolio'
import { parsePortfolioCsv } from './portfolioCsv'
import { PRESETS } from './presets'

const presetTickers = new Set(['MU', 'ORCL', 'VOO', 'PBR', 'SHNY', 'XIACF'])

function byTickerFor(tickers: ReadonlySet<string>): Map<string, UniverseEntry> {
  return new Map([...tickers].map((ticker) => [ticker, { ticker } as UniverseEntry]))
}

describe('preset portfolios', () => {
  it('ships exactly the supplied preset', () => {
    expect(PRESETS).toHaveLength(1)
  })

  it('parses every preset against its complete ticker set', () => {
    for (const preset of PRESETS) {
      expect(parsePortfolioCsv(preset.csv, presetTickers).ok).toBe(true)
    }
  })

  it('produces a createable full-precision allocation with zero cash', () => {
    const result = parsePortfolioCsv(PRESETS[0].csv, presetTickers)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const weightTotal = result.seed.rows.reduce((sum, row) => sum + Number(row.weight), 0)
    expect(Math.abs(weightTotal - 100)).toBeLessThanOrEqual(0.01)
    expect(result.seed.cash).toBe('0')

    const summary = summariseDraft(
      {
        name: PRESETS[0].name,
        mode: result.seed.mode,
        cash: result.seed.cash,
        rows: result.seed.rows.map((row) => ({ ...row, id: row.ticker })),
      },
      byTickerFor(presetTickers),
    )
    expect(summary.canCreate).toBe(true)
    expect(summary.problem).toBeNull()
  })

  it('contains no share counts', () => {
    for (const preset of PRESETS) {
      const result = parsePortfolioCsv(preset.csv, presetTickers)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.seed.rows.every((row) => row.shares === '')).toBe(true)
    }
  })

  it('drops only off-universe holdings through the normal parser path', () => {
    const result = parsePortfolioCsv(PRESETS[0].csv, new Set(['MU', 'VOO']))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dropped).toEqual([
      { ticker: 'ORCL', weightPct: 10.481994524396962 },
      { ticker: 'PBR', weightPct: 3.1979752499318987 },
      { ticker: 'SHNY', weightPct: 2.2013242930879917 },
      { ticker: 'XIACF', weightPct: 0.30626691660223515 },
    ])
  })

  it('uses unique, non-empty ids', () => {
    const ids = PRESETS.map((preset) => preset.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
