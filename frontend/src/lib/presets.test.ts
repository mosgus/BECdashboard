import { describe, expect, it } from 'vitest'
import type { Preset, UniverseEntry } from '../api/client'
import { buildDraftPortfolio, summariseDraft } from './portfolio'
import { parsePortfolioCsv, serializePortfolioCsv } from './portfolioCsv'

const FIXTURES: Preset[] = [
  {
    id: 'test-concentrated',
    name: 'Gunnar Preset',
    description: 'Gunnar\'s real and current allocations.',
    csv: 'ticker,weight_pct,shares\nMU,74.1847583834589,\nVOO,10.104829494715357,\nPBR,6.8215124159481295,\nORCL,4.426503750208732,\nSHNY,4.163845785064591,\nXIACF,0.2985501706042959,\nCASH,0,\n',
    created_at: '2026-09-01T00:00:00+00:00',
    updated_at: '2026-09-01T00:00:00+00:00',
  },
  {
    id: 'bec-2026-09-29',
    name: 'BEC Portfolio',
    description: 'Blue Eagle Capital holdings as share counts, with $292,406.58 cash.',
    csv: 'ticker,shares\nXLK,184\nXLP,559\nXLV,410\nVEA,300\nMS,833\nSETM,870\nCEG,155\nGLD,113\nCASH,292406.58\n',
    created_at: '2026-09-29T00:00:00+00:00',
    updated_at: '2026-09-29T00:00:00+00:00',
  },
]

/** The tickers a seeded preset actually names, excluding the reserved CASH row. */
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

function pricedByTickerFor(tickers: ReadonlySet<string>): Map<string, UniverseEntry> {
  return new Map([...tickers].map((ticker) => [ticker, { ticker, last_close: 100, quote_type: 'EQUITY' } as UniverseEntry]))
}

describe('seeded preset CSV shapes', () => {
  it('parses every preset against its complete ticker set', () => {
    for (const preset of FIXTURES) {
      expect(parsePortfolioCsv(preset.csv, tickersOf(preset)).ok).toBe(true)
    }
  })

  it('produces a createable full-precision allocation with zero cash', () => {
    const result = parsePortfolioCsv(FIXTURES[0].csv, tickersOf(FIXTURES[0]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const weightTotal = result.seed.rows.reduce((sum, row) => sum + Number(row.weight), 0)
    expect(Math.abs(weightTotal - 100)).toBeLessThanOrEqual(0.01)
    expect(result.seed.cash).toBe('0')

    const summary = summariseDraft(
      {
        name: FIXTURES[0].name,
        mode: result.seed.mode,
        cash: result.seed.cash,
        rows: result.seed.rows.map((row) => ({ ...row, id: row.ticker })),
      },
      byTickerFor(tickersOf(FIXTURES[0])),
    )
    expect(summary.canCreate).toBe(true)
    expect(summary.problem).toBeNull()
  })

  it('keeps Gunnar Preset weights-only', () => {
    const result = parsePortfolioCsv(FIXTURES[0].csv, tickersOf(FIXTURES[0]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.seed.rows.every((row) => row.shares === '')).toBe(true)
  })

  it('ships the BEC preset as shares with fixed cash dollars', () => {
    const result = parsePortfolioCsv(FIXTURES[1].csv, tickersOf(FIXTURES[1]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seed.mode).toBe('shares')
    expect(result.seed.cash).toBe('292406.58')
    expect(result.seed.rows).toHaveLength(8)
    expect(result.seed.rows.every((row) => row.shares !== '')).toBe(true)
  })

  it('drops only off-universe holdings through the normal parser path', () => {
    const result = parsePortfolioCsv(FIXTURES[0].csv, new Set(['MU', 'VOO']))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dropped).toEqual([
      { ticker: 'PBR', weightPct: 6.8215124159481295 },
      { ticker: 'ORCL', weightPct: 4.426503750208732 },
      { ticker: 'SHNY', weightPct: 4.163845785064591 },
      { ticker: 'XIACF', weightPct: 0.2985501706042959 },
    ])
  })

  it('round-trips the seeded Gunnar preset without changing its allocation', () => {
    const original = parsePortfolioCsv(FIXTURES[0].csv, tickersOf(FIXTURES[0]))
    expect(original.ok).toBe(true)
    if (!original.ok) return
    const byTicker = pricedByTickerFor(tickersOf(FIXTURES[0]))
    const summary = summariseDraft(
      { name: FIXTURES[0].name, mode: original.seed.mode, cash: original.seed.cash, rows: original.seed.rows.map((row) => ({ ...row, id: row.ticker })) },
      byTicker,
    )
    const portfolio = buildDraftPortfolio(FIXTURES[0].name, original.seed.mode, summary, byTicker, 'x', '2026-10-03T00:00:00Z')
    expect(portfolio).not.toBeNull()
    if (portfolio === null) return
    const roundTripped = parsePortfolioCsv(serializePortfolioCsv(portfolio), tickersOf(FIXTURES[0]))
    expect(roundTripped.ok).toBe(true)
    if (!roundTripped.ok) return
    expect(roundTripped.seed.mode).toBe('weight')
    expect(roundTripped.seed.rows.map((row) => row.ticker)).toEqual(original.seed.rows.map((row) => row.ticker))
    roundTripped.seed.rows.forEach((row, index) => {
      expect(Math.abs(Number(row.weight) - Number(original.seed.rows[index].weight))).toBeLessThanOrEqual(1e-9)
    })
    expect(roundTripped.seed.cash).toBe(original.seed.cash)
  })

  it('round-trips the seeded BEC preset without changing its share counts or cash', () => {
    const original = parsePortfolioCsv(FIXTURES[1].csv, tickersOf(FIXTURES[1]))
    expect(original.ok).toBe(true)
    if (!original.ok) return
    const byTicker = pricedByTickerFor(tickersOf(FIXTURES[1]))
    const summary = summariseDraft(
      { name: FIXTURES[1].name, mode: original.seed.mode, cash: original.seed.cash, rows: original.seed.rows.map((row) => ({ ...row, id: row.ticker })) },
      byTicker,
    )
    const portfolio = buildDraftPortfolio(FIXTURES[1].name, original.seed.mode, summary, byTicker, 'x', '2026-10-03T00:00:00Z')
    expect(portfolio).not.toBeNull()
    if (portfolio === null) return
    const roundTripped = parsePortfolioCsv(serializePortfolioCsv(portfolio), tickersOf(FIXTURES[1]))
    expect(roundTripped.ok).toBe(true)
    if (!roundTripped.ok) return
    expect(roundTripped.seed.mode).toBe('shares')
    roundTripped.seed.rows.forEach((row, index) => {
      expect(Number(row.shares)).toBe(Number(original.seed.rows[index].shares))
    })
    expect(Math.abs(Number(roundTripped.seed.cash) - 292406.58)).toBeLessThan(1e-6)
  })
})
