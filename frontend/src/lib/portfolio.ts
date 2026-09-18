import type { UniverseEntry } from '../api/client'

export interface Position {
  ticker: string
  shares: number
}

export interface Portfolio {
  id: string
  name: string
  cash: number
  positions: Position[]
  updatedAt: string
}

export interface ValuedRow {
  ticker: string
  shares: number
  name: string | null
  price: number | null
  value: number | null
  weight: number | null
  missing: boolean
}

export interface ValuedPortfolio {
  rows: ValuedRow[]
  positionsValue: number
  cash: number
  totalValue: number
  cashWeight: number | null
  missingTickers: string[]
}

/** current_price ?? last_close ?? regular_market_price — the same fallback chain
 *  UniverseTable.tsx:120 already uses. Do not invent a second one. */
export function positionPrice(entry: UniverseEntry | undefined): number | null {
  if (entry === undefined) return null
  return entry.current_price ?? entry.last_close ?? entry.regular_market_price
}

/** Pure: no clock, no storage, no network. The Universe arrives as a Map the caller built,
 * once, from GET /universe — this never fetches.
 *
 * A position can reference a ticker no longer in the Universe (contract 0038 permanently
 * deletes tickers; portfolios live in localStorage and survive that entirely). Such a row gets
 * null price/value/weight and missing: true, and never contributes to positionsValue —
 * treating a missing price as zero would silently understate the total and skew every other
 * weight. totalValue is honest about what it could actually price.
 *
 * Weights are against positionsValue + cash, never positionsValue alone — cash is part of the
 * portfolio, so position weights sum to less than 100% whenever cash is non-zero, and
 * cashWeight is the remainder. */
export function valuePortfolio(portfolio: Portfolio, byTicker: Map<string, UniverseEntry>): ValuedPortfolio {
  const { cash } = portfolio
  const missingTickers: string[] = []
  let positionsValue = 0

  const priced = portfolio.positions.map((position) => {
    const entry = byTicker.get(position.ticker)
    const missing = entry === undefined
    if (missing) missingTickers.push(position.ticker)

    const price = positionPrice(entry)
    const value = price === null ? null : price * position.shares
    if (value !== null) positionsValue += value

    return {
      ticker: position.ticker,
      shares: position.shares,
      name: entry?.short_name ?? null,
      price,
      value,
      missing,
    }
  })

  const totalValue = positionsValue + cash

  const rows: ValuedRow[] = priced.map((row) => ({
    ...row,
    weight: row.value === null || totalValue <= 0 ? null : (row.value / totalValue) * 100,
  }))

  // totalValue <= 0 covers the empty-portfolio case (no positions, no cash) and the unusual
  // case of cash exactly offsetting a negative — either way this stays null rather than
  // dividing by zero. Cash of exactly 0 against a positive total is a real, well-defined 0%.
  const cashWeight = totalValue > 0 ? (cash / totalValue) * 100 : cash === 0 ? 0 : null

  return {
    rows,
    positionsValue,
    cash,
    totalValue,
    cashWeight,
    missingTickers,
  }
}

// --- Composer (contract 0050): shares and weight cannot both be free inputs, so entry happens
// in one mode at a time and the other side is derived. Nothing here changes Position/Portfolio
// shape — a stored weight would describe what was intended the day it was typed, so weight mode
// converts to shares at entry time and discards itself (REBUILD.md: shares are the stored
// truth, weights are derived). ---------------------------------------------------------------

/** Weight of a value against a portfolio total, in percent units (33.3 means 33.3%) — the
 * units lib/format.ts's formatPercent already expects. null when the total is not positive, so
 * an empty or fully-unpriced draft yields "—" rather than NaN or Infinity. */
export function weightOf(value: number | null, totalValue: number): number | null {
  if (value === null || !(totalValue > 0)) return null
  return (value / totalValue) * 100
}

/** Shares implied by a target weight. null when price is null or <= 0, when totalValue is not
 * positive, or when weightPercent is not finite — every path that would otherwise divide by
 * zero or propagate a non-finite input into the draft. */
export function sharesForWeight(weightPercent: number, totalValue: number, price: number | null): number | null {
  if (price === null || !(price > 0)) return null
  if (!(totalValue > 0)) return null
  if (!Number.isFinite(weightPercent)) return null
  return (weightPercent / 100) * totalValue / price
}

export type EntryMode = 'shares' | 'weight'

export interface DraftRow {
  id: string
  ticker: string
  shares: string
  weight: string
}

export interface DraftSummary {
  rows: Array<{
    id: string
    ticker: string
    price: number | null
    shares: number | null
    value: number | null
    weight: number | null
  }>
  cash: number
  positionsValue: number
  totalValue: number
  cashWeight: number | null
  allocatedPercent: number | null
  remainderPercent: number | null
  canCreate: boolean
  problem: string | null
}

/** A computed number as text for a controlled number input (contract 0053, defect 3). Plain
 * digits only — no thousands separators (a "1,000" would parse back as NaN) and no exponent
 * (a number input rejects "1e+21"), which is why this uses toFixed + trimming rather than a
 * locale-aware formatter: those add exactly the punctuation that breaks re-parsing a number
 * input's own value back into a number. Trailing zeros are trimmed — 0.5 stays "0.5", not
 * "0.500000" — and non-finite input (NaN, Infinity, -Infinity) returns '' rather than the
 * literal word "NaN" or "Infinity" landing in a text box.
 *
 * Not a display formatter — lib/format.ts is for reading, this is for re-parsing. Applied
 * only to values that already exist; the "leave it empty when it cannot be computed" rule
 * from contract 0050 is unchanged, so a null upstream value must still resolve to '' before
 * it ever reaches this function, never be coerced through it as a stand-in for "unknown". */
export function toFieldText(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(maxDecimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function parseFiniteOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function parseFinitePositive(raw: string): number | null {
  const n = parseFiniteOrNull(raw)
  return n !== null && n > 0 ? n : null
}

/** Pure: no clock, no storage, no network, no crypto — row ids arrive on the draft. Every
 * numeric field crosses this boundary as raw text, not a number (fix 2: a controlled number
 * input bound directly to a number cannot hold an intermediate value like "1234." — the DOM
 * reports "" there, which becomes 0 and silently wipes what was typed).
 *
 * canCreate/problem check conditions in a fixed order and report the first one unmet, so a
 * disabled Create button always has a stated reason next to it. */
export function summariseDraft(
  draft: { name: string; mode: EntryMode; totalValue: string; cash: string; rows: DraftRow[] },
  byTicker: Map<string, UniverseEntry>,
): DraftSummary {
  if (draft.mode === 'shares') {
    const cashParsed = draft.cash.trim() === '' ? 0 : parseFiniteOrNull(draft.cash)
    const cash = cashParsed ?? 0

    const rowResults = draft.rows.map((row) => {
      const price = positionPrice(byTicker.get(row.ticker))
      const shares = parseFiniteOrNull(row.shares)
      const value = shares !== null && price !== null ? shares * price : null
      return { id: row.id, ticker: row.ticker, price, shares, value }
    })

    const positionsValue = rowResults.reduce((sum, row) => sum + (row.value ?? 0), 0)
    const totalValue = positionsValue + cash

    const rows = rowResults.map((row) => ({ ...row, weight: weightOf(row.value, totalValue) }))
    const cashWeight = weightOf(cash, totalValue)

    let problem: string | null = null
    if (draft.name.trim() === '') problem = 'Give the portfolio a name'
    else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
    else if (draft.rows.some((row) => parseFinitePositive(row.shares) === null)) problem = 'Every asset needs a share count'
    else if (cashParsed === null) problem = 'Cash must be a valid number'

    return {
      rows,
      cash,
      positionsValue,
      totalValue,
      cashWeight,
      allocatedPercent: null,
      remainderPercent: null,
      canCreate: problem === null,
      problem,
    }
  }

  // Weight mode: totalValue is an independent input (what the weights are measured against),
  // not derived from the rows — every row and cash express a percent of it.
  const totalValueParsed = parseFinitePositive(draft.totalValue)
  const totalValue = totalValueParsed ?? 0
  const cashPercentParsed = draft.cash.trim() === '' ? 0 : parseFiniteOrNull(draft.cash)
  const cashPercent = cashPercentParsed ?? 0
  const cash = totalValue > 0 ? totalValue * (cashPercent / 100) : 0

  const rowResults = draft.rows.map((row) => {
    const price = positionPrice(byTicker.get(row.ticker))
    const weightParsed = parseFiniteOrNull(row.weight)
    const value = totalValue > 0 && weightParsed !== null ? totalValue * (weightParsed / 100) : null
    const shares = weightParsed !== null ? sharesForWeight(weightParsed, totalValue, price) : null
    return { id: row.id, ticker: row.ticker, price, shares, value, weightParsed }
  })

  const positionsValue = rowResults.reduce((sum, row) => sum + (row.value ?? 0), 0)
  const allocatedPercent = cashPercent + rowResults.reduce((sum, row) => sum + (row.weightParsed ?? 0), 0)
  const remainderPercent = 100 - allocatedPercent

  const rows = rowResults.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    price: row.price,
    shares: row.shares,
    value: row.value,
    weight: row.weightParsed,
  }))

  let problem: string | null = null
  if (draft.name.trim() === '') problem = 'Give the portfolio a name'
  else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
  else if (totalValueParsed === null) problem = 'Set a total portfolio value'
  else if (cashPercentParsed === null) problem = 'Cash must be a valid percentage'
  else if (draft.rows.some((row) => parseFinitePositive(row.weight) === null)) problem = 'Every asset needs a target weight'
  else if (draft.rows.some((row) => positionPrice(byTicker.get(row.ticker)) === null)) problem = 'One of your assets has no price available'
  else if (Math.abs(allocatedPercent - 100) > 0.01) problem = 'Weights must add up to 100%'

  return {
    rows,
    cash,
    positionsValue,
    totalValue,
    cashWeight: cashPercentParsed,
    allocatedPercent,
    remainderPercent,
    canCreate: problem === null,
    problem,
  }
}
