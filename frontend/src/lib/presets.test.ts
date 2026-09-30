import { describe, expect, it } from 'vitest'
import type { UniverseEntry } from '../api/client'
import { summariseDraft } from './portfolio'
import { parsePortfolioCsv } from './portfolioCsv'
import { PRESETS } from './presets'
import type { Preset } from './presets'

/** The tickers a preset actually names, excluding the reserved CASH row. Derived from the
 *  preset's own CSV so the suite survives presets being added — a shared constant broke the
 *  moment a second preset arrived (contract 0076). */
function tickersOf(preset: Preset): Set<string> {
  return new Set(
    preset.csv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[0].trim().toUpperCase())
      .filter((ticker) => ticker !== '' && ticker !== 'CASH'),
  )
}

function byTickerFor(tickers: ReadonlySet<string>): Map<string, UniverseEntry> {
  return new Map([...tickers].map((ticker) => [ticker, { ticker } as UniverseEntry]))
}

describe('preset portfolios', () => {
  it('ships exactly the supplied preset', () => {
    // Pinned so a coding agent can never add an allocation; change only when Gunnar does.
    expect(PRESETS).toHaveLength(2)
  })

  it('parses every preset against its complete ticker set', () => {
    for (const preset of PRESETS) {
      expect(parsePortfolioCsv(preset.csv, tickersOf(preset)).ok).toBe(true)
    }
  })

  it('produces a createable full-precision allocation with zero cash', () => {
    const result = parsePortfolioCsv(PRESETS[0].csv, tickersOf(PRESETS[0]))
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
      byTickerFor(tickersOf(PRESETS[0])),
    )
    expect(summary.canCreate).toBe(true)
    expect(summary.problem).toBeNull()
  })

  it('keeps Gunnar Preset weights-only', () => {
    const result = parsePortfolioCsv(PRESETS[0].csv, tickersOf(PRESETS[0]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.seed.rows.every((row) => row.shares === '')).toBe(true)
  })

  it('ships the BEC preset as shares with fixed cash dollars', () => {
    const result = parsePortfolioCsv(PRESETS[1].csv, tickersOf(PRESETS[1]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seed.mode).toBe('shares')
    expect(result.seed.cash).toBe('292406.58')
    expect(result.seed.rows).toHaveLength(8)
    expect(result.seed.rows.every((row) => row.shares !== '')).toBe(true)
  })

  it('drops only off-universe holdings through the normal parser path', () => {
    const result = parsePortfolioCsv(PRESETS[0].csv, new Set(['MU', 'VOO']))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dropped).toEqual([
      { ticker: 'PBR', weightPct: 6.8215124159481295 },
      { ticker: 'ORCL', weightPct: 4.426503750208732 },
      { ticker: 'SHNY', weightPct: 4.163845785064591 },
      { ticker: 'XIACF', weightPct: 0.2985501706042959 },
    ])
  })

  it('uses unique, non-empty ids', () => {
    const ids = PRESETS.map((preset) => preset.id)
    expect(ids.every((id) => id !== '')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
