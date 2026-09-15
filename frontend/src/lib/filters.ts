import type { UniverseEntry } from '../api/client'

export interface FilterState {
  query: string
  types: string[]
  sectors: (string | null)[]
  price: [number | null, number | null]
  mcap: [number | null, number | null]
  pe: [number | null, number | null]
  yield: [number | null, number | null]
}

export const EMPTY_FILTERS: FilterState = {
  query: '',
  types: [],
  sectors: [],
  price: [null, null],
  mcap: [null, null],
  pe: [null, null],
  yield: [null, null],
}

const SUFFIX_MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

export function parseNumericInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const match = /^(-?\d*\.?\d+)([kmbt])?$/i.exec(cleaned)
  if (!match) return null
  const multiplier = match[2] ? SUFFIX_MULTIPLIERS[match[2].toLowerCase()] : 1
  return parseFloat(match[1]) * multiplier
}

function inRange(value: number | null, range: [number | null, number | null]): boolean {
  const [lo, hi] = range
  if (lo === null && hi === null) return true
  if (value === null) return false
  if (lo !== null && value < lo) return false
  if (hi !== null && value > hi) return false
  return true
}

type NumericKey = 'price' | 'mcap' | 'pe' | 'yield'

interface NumericFieldSpec {
  key: NumericKey
  label: string
  getValue: (row: UniverseEntry) => number | null
}

const NUMERIC_FIELDS: NumericFieldSpec[] = [
  { key: 'price', label: 'price', getValue: (row) => row.regular_market_price },
  { key: 'mcap', label: 'market cap', getValue: (row) => row.market_cap },
  { key: 'pe', label: 'P/E', getValue: (row) => row.trailing_pe },
  { key: 'yield', label: 'dividend yield', getValue: (row) => row.dividend_yield },
]

export function applyFilters(
  rows: UniverseEntry[],
  f: FilterState
): { shown: UniverseEntry[]; hiddenForMissingData: number; missingFields: string[] } {
  let hiddenForMissingData = 0
  const missingFieldSet = new Set<string>()
  const query = f.query.trim().toLowerCase()

  const shown = rows.filter((row) => {
    if (query) {
      const tickerMatch = row.ticker.toLowerCase().includes(query)
      const nameMatch = row.short_name !== null && row.short_name.toLowerCase().includes(query)
      if (!tickerMatch && !nameMatch) return false
    }

    if (f.types.length > 0 && !f.types.includes(row.quote_type ?? '')) return false
    if (f.sectors.length > 0 && !f.sectors.includes(row.sector)) return false

    const failingFields: { label: string; dueToNull: boolean }[] = []
    for (const field of NUMERIC_FIELDS) {
      const range = f[field.key]
      const isActive = range[0] !== null || range[1] !== null
      if (!isActive) continue
      const value = field.getValue(row)
      if (!inRange(value, range)) {
        failingFields.push({ label: field.label, dueToNull: value === null })
      }
    }

    if (failingFields.length > 0) {
      const allDueToNull = failingFields.every((entry) => entry.dueToNull)
      if (allDueToNull) {
        hiddenForMissingData += 1
        failingFields.forEach((entry) => missingFieldSet.add(entry.label))
      }
      return false
    }

    return true
  })

  return { shown, hiddenForMissingData, missingFields: [...missingFieldSet] }
}

export function activeFilterCount(f: FilterState): number {
  let count = 0
  if (f.types.length > 0) count += 1
  if (f.sectors.length > 0) count += 1
  if (f.price[0] !== null || f.price[1] !== null) count += 1
  if (f.mcap[0] !== null || f.mcap[1] !== null) count += 1
  if (f.pe[0] !== null || f.pe[1] !== null) count += 1
  if (f.yield[0] !== null || f.yield[1] !== null) count += 1
  return count
}

export function sectorOptions(rows: UniverseEntry[]): (string | null)[] {
  const sectors = new Set<string>()
  let hasNull = false
  for (const row of rows) {
    if (row.sector === null) {
      hasNull = true
    } else {
      sectors.add(row.sector)
    }
  }
  const sorted = [...sectors].sort()
  return hasNull ? [...sorted, null] : sorted
}
