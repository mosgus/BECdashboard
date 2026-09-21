import type { UniverseEntry } from '../api/client'

export interface Position {
  ticker: string
  weight: number
  shares?: number
}

export interface Portfolio {
  id: string
  name: string
  cashWeight: number
  positions: Position[]
  updatedAt: string
}

export interface LegacyPosition {
  ticker: string
  shares: number
}

export interface LegacyPortfolio {
  id: string
  name: string
  cash: number
  positions: LegacyPosition[]
  updatedAt: string
}

export type StoredPortfolio = Portfolio | LegacyPortfolio

export interface ValuedRow {
  ticker: string
  shares: number | null
  name: string | null
  weight: number
  missing: boolean
}

export interface ValuedPortfolio {
  rows: ValuedRow[]
  cashWeight: number
  missingTickers: string[]
}

/** current_price ?? last_close ?? regular_market_price — the same fallback chain
 * UniverseTable.tsx uses. This remains useful only when converting a legacy shares model. */
export function positionPrice(entry: UniverseEntry | undefined): number | null {
  if (entry === undefined) return null
  return entry.current_price ?? entry.last_close ?? entry.regular_market_price
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Convert the deployed shares-and-cash shape into the allocation model without mutating it.
 * A missing or unusable price makes the conversion unsafe, so null preserves the old record. */
export function migrateLegacyPortfolio(
  legacy: LegacyPortfolio,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null {
  if (
    typeof legacy !== 'object' ||
    legacy === null ||
    typeof legacy.id !== 'string' ||
    typeof legacy.name !== 'string' ||
    typeof legacy.updatedAt !== 'string' ||
    !isFiniteNonNegative(legacy.cash) ||
    !Array.isArray(legacy.positions)
  ) {
    return null
  }

  const seen = new Set<string>()
  if (legacy.positions.length === 0) {
    return {
      id: legacy.id,
      name: legacy.name,
      cashWeight: 100,
      positions: [],
      updatedAt: legacy.updatedAt,
    }
  }

  const valued: Array<{ ticker: string; shares: number; value: number }> = []
  for (const position of legacy.positions) {
    if (
      typeof position !== 'object' ||
      position === null ||
      typeof position.ticker !== 'string' ||
      position.ticker === '' ||
      seen.has(position.ticker) ||
      !isFinitePositive(position.shares)
    ) {
      return null
    }
    seen.add(position.ticker)

    const price = positionPrice(byTicker.get(position.ticker))
    if (!isFinitePositive(price)) return null
    const value = position.shares * price
    if (!isFinitePositive(value)) return null
    valued.push({ ticker: position.ticker, shares: position.shares, value })
  }

  const positionsValue = valued.reduce((sum, position) => sum + position.value, 0)
  const totalValue = positionsValue + legacy.cash
  if (!Number.isFinite(totalValue) || !(totalValue > 0)) return null

  const positions = valued.map((position) => ({
    ticker: position.ticker,
    shares: position.shares,
    weight: (position.value / totalValue) * 100,
  }))
  const cashWeight = 100 - positions.reduce((sum, position) => sum + position.weight, 0)

  if (!Number.isFinite(cashWeight) || cashWeight < 0) return null

  return {
    id: legacy.id,
    name: legacy.name,
    cashWeight,
    positions,
    updatedAt: legacy.updatedAt,
  }
}

/** Presentation only: saved allocation weights are authoritative and never recalculate from
 * quotes. Universe data supplies a display name and the missing-ticker warning only. */
export function valuePortfolio(portfolio: Portfolio, byTicker: Map<string, UniverseEntry>): ValuedPortfolio {
  const missingTickers: string[] = []
  const rows = portfolio.positions.map((position) => {
    const entry = byTicker.get(position.ticker)
    const missing = entry === undefined
    if (missing) missingTickers.push(position.ticker)
    return {
      ticker: position.ticker,
      shares: position.shares ?? null,
      name: entry?.short_name ?? null,
      weight: position.weight,
      missing,
    }
  })

  return { rows, cashWeight: portfolio.cashWeight, missingTickers }
}

function isValidCurrentPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.ticker === 'string' &&
    candidate.ticker !== '' &&
    typeof candidate.weight === 'number' &&
    Number.isFinite(candidate.weight) &&
    candidate.weight > 0 &&
    (candidate.shares === undefined || (typeof candidate.shares === 'number' && Number.isFinite(candidate.shares) && candidate.shares > 0))
  )
}

function isValidCurrentPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if ('cash' in candidate || 'totalValue' in candidate) return false
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.cashWeight !== 'number' ||
    !Number.isFinite(candidate.cashWeight) ||
    candidate.cashWeight < 0 ||
    !Array.isArray(candidate.positions) ||
    !candidate.positions.every(isValidCurrentPosition) ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return false
  }
  const positions = candidate.positions as Position[]
  if (new Set(positions.map((position) => position.ticker)).size !== positions.length) return false
  const total = candidate.cashWeight + positions.reduce((sum, position) => sum + position.weight, 0)
  return Math.abs(total - 100) <= 0.01
}

/** Derive total value from a fully specified shares portfolio without making it allocation truth. */
export function impliedPortfolioValue(
  portfolio: Portfolio,
  byTicker: Map<string, UniverseEntry>,
): number | null {
  if (!isValidCurrentPortfolio(portfolio) || portfolio.positions.length === 0) return null

  const positionPercent = 100 - portfolio.cashWeight
  if (!(positionPercent > 0) || !Number.isFinite(positionPercent)) return null

  let marketValue = 0
  for (const position of portfolio.positions) {
    if (!isFinitePositive(position.shares)) return null
    const price = positionPrice(byTicker.get(position.ticker))
    if (!isFinitePositive(price)) return null
    const value = position.shares * price
    if (!isFinitePositive(value)) return null
    marketValue += value
  }
  if (!isFinitePositive(marketValue)) return null

  const impliedValue = marketValue / (positionPercent / 100)
  return isFinitePositive(impliedValue) ? impliedValue : null
}

/** Calculate a newly purchased holding's allocation after it expands the implied portfolio. */
export function weightFromShares(shares: number, price: number, impliedValue: number): number | null {
  if (!isFinitePositive(shares) || !isFinitePositive(price) || !isFinitePositive(impliedValue)) return null
  const value = shares * price
  const total = impliedValue + value
  if (!isFinitePositive(value) || !isFinitePositive(total)) return null
  const weight = (value / total) * 100
  return isFinitePositive(weight) && weight < 100 ? weight : null
}

/** Add an allocation from cash first, diluting existing positions only for an uncovered shortfall. */
export function addPositionDiluting(portfolio: Portfolio, position: Position): Portfolio | null {
  if (!isValidCurrentPortfolio(portfolio) || !isValidCurrentPosition(position)) return null
  if (portfolio.positions.some((existing) => existing.ticker === position.ticker)) return null
  if (position.weight >= 100) return null

  const positionTotal = portfolio.positions.reduce((sum, existing) => sum + existing.weight, 0)
  const fromCash = Math.min(position.weight, portfolio.cashWeight)
  const shortfall = position.weight - fromCash
  if (shortfall > 0 && (!(positionTotal > 0) || positionTotal - shortfall <= 0)) return null

  const scale = shortfall > 0 ? (positionTotal - shortfall) / positionTotal : 1
  const positions = [
    ...portfolio.positions.map((existing) => ({ ...existing, weight: existing.weight * scale })),
    position,
  ]
  let cashWeight = 100 - positions.reduce((sum, next) => sum + next.weight, 0)
  if (cashWeight < 0 && cashWeight > -0.01) cashWeight = 0
  if (!Number.isFinite(cashWeight) || cashWeight < 0) return null

  const total = cashWeight + positions.reduce((sum, next) => sum + next.weight, 0)
  if (Math.abs(total - 100) > 0.01) return null

  return {
    id: portfolio.id,
    name: portfolio.name,
    cashWeight,
    positions,
    updatedAt: portfolio.updatedAt,
  }
}

/** Remove an allocation and return its saved weight to cash without mutating the input. */
export function removePositionToCash(portfolio: Portfolio, ticker: string): Portfolio | null {
  if (!isValidCurrentPortfolio(portfolio)) return null
  const index = portfolio.positions.findIndex((position) => position.ticker === ticker)
  if (index === -1) return null

  const positions = portfolio.positions.filter((_, positionIndex) => positionIndex !== index)
  const cashWeight = 100 - positions.reduce((sum, position) => sum + position.weight, 0)
  if (!Number.isFinite(cashWeight) || cashWeight < 0) return null

  return {
    id: portfolio.id,
    name: portfolio.name,
    cashWeight,
    positions,
    updatedAt: portfolio.updatedAt,
  }
}

export function weightOf(value: number | null, totalValue: number): number | null {
  if (value === null || !(totalValue > 0)) return null
  return (value / totalValue) * 100
}

export function toFieldText(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(maxDecimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function parseFiniteOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function parseFinitePositive(raw: string): number | null {
  const value = parseFiniteOrNull(raw)
  return value !== null && value > 0 ? value : null
}

function parseFiniteNonNegative(raw: string): number | null {
  const value = parseFiniteOrNull(raw)
  return value !== null && value >= 0 ? value : null
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
    shares: number | null
    weight: number | null
  }>
  cashWeight: number | null
  allocatedPercent: number | null
  remainderPercent: number | null
  canCreate: boolean
  problem: string | null
}

/** Pure composer validation. Weight mode never reads prices; shares mode uses them once to
 * derive the initial allocation that is saved with the entered shares. */
export function summariseDraft(
  draft: { name: string; mode: EntryMode; cash: string; rows: DraftRow[] },
  byTicker: Map<string, UniverseEntry>,
): DraftSummary {
  if (draft.mode === 'weight') {
    const cashWeight = parseFiniteNonNegative(draft.cash)
    const rows = draft.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      shares: null,
      weight: parseFinitePositive(row.weight),
    }))
    const allocatedPercent = (cashWeight ?? 0) + rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)
    const remainderPercent = 100 - allocatedPercent

    let problem: string | null = null
    if (draft.name.trim() === '') problem = 'Give the portfolio a name'
    else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
    else if (cashWeight === null) problem = 'Cash must be a valid percentage'
    else if (draft.rows.some((row) => parseFinitePositive(row.weight) === null)) problem = 'Every asset needs a strictly-positive weight'
    else if (Math.abs(allocatedPercent - 100) > 0.01) problem = 'Weights must add up to 100%'

    return {
      rows,
      cashWeight,
      allocatedPercent,
      remainderPercent,
      canCreate: problem === null,
      problem,
    }
  }

  const cashDollars = draft.cash.trim() === '' ? 0 : parseFiniteNonNegative(draft.cash)
  const preliminary = draft.rows.map((row) => {
    const shares = parseFinitePositive(row.shares)
    const price = positionPrice(byTicker.get(row.ticker))
    const value = shares !== null && isFinitePositive(price) ? shares * price : null
    return { id: row.id, ticker: row.ticker, shares, price, value }
  })
  const positionsValue = preliminary.reduce((sum, row) => sum + (row.value ?? 0), 0)
  const totalValue = positionsValue + (cashDollars ?? 0)
  const rows = preliminary.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    shares: row.shares,
    weight: row.value !== null && totalValue > 0 ? (row.value / totalValue) * 100 : null,
  }))
  const cashWeight = cashDollars !== null && totalValue > 0 ? (cashDollars / totalValue) * 100 : null
  const allocatedPercent = cashWeight === null ? null : cashWeight + rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)

  let problem: string | null = null
  if (draft.name.trim() === '') problem = 'Give the portfolio a name'
  else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
  else if (cashDollars === null) problem = 'Cash must be a non-negative number'
  else if (draft.rows.some((row) => parseFinitePositive(row.shares) === null)) problem = 'Every asset needs a strictly-positive share count'
  else if (draft.rows.some((row) => !isFinitePositive(positionPrice(byTicker.get(row.ticker))))) problem = 'Every asset needs a usable current price'
  else if (!(totalValue > 0) || !Number.isFinite(totalValue)) problem = 'The initial allocation must be greater than zero'

  return {
    rows,
    cashWeight,
    allocatedPercent,
    remainderPercent: allocatedPercent === null ? null : 100 - allocatedPercent,
    canCreate: problem === null,
    problem,
  }
}
