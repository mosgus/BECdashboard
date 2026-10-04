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
  /** Fixed cash in dollars. Present only on shares-based portfolios (contract 0129); weights are then
   *  a snapshot re-marked from shares × price whenever the Universe loads. */
  cashDollars?: number
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
  /** Estimated at last closing prices: impliedPortfolioValue × cashWeight / 100. Null unless every
   *  position has shares and a usable price. Presentation only — never saved. */
  cashDollars: number | null
  cashFixed: boolean
  missingTickers: string[]
}

/** The one price every Portfolios valuation and trade uses: the last completed session's close,
 *  the same field Optimize and CAPM size trades on (decision 2026-10-01, contract 0139).
 *  Deliberately no fallback to a live quote — a fallback would reintroduce a second price. */
export function positionPrice(entry: UniverseEntry | undefined): number | null {
  if (entry === undefined) return null
  return entry.last_close
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Residue below this is float noise, not an allocation. Symmetric. */
export const WEIGHT_EPSILON = 1e-9

/** Cash as the remainder of an allocation: `100 - Σweights`, with float residue inside the
 * project's noise epsilon snapped to exactly 0.
 *
 * Rescaling or re-summing weights lands a few 1e-14 either side of 100. Both signs are float
 * noise, and a negative one would make portfolio storage reject the record.
 *
 * Returns null when the remainder is genuinely out of range, which stays a caller error. */
export function cashFromPositions(positions: Position[]): number | null {
  const total = positions.reduce((sum, position) => sum + position.weight, 0)
  const cash = 100 - total
  if (!Number.isFinite(cash)) return null
  if (Math.abs(cash) < WEIGHT_EPSILON) return 0
  if (cash < 0) return null
  return cash
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
  const cashWeight = cashFromPositions(positions)
  if (cashWeight === null) return null

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

  const implied = impliedPortfolioValue(portfolio, byTicker)
  const cashDollars = portfolio.cashDollars === undefined
    ? implied === null ? null : implied * portfolio.cashWeight / 100
    : portfolio.cashDollars
  return { rows, cashWeight: portfolio.cashWeight, cashDollars, cashFixed: portfolio.cashDollars !== undefined, missingTickers }
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

export function isValidCurrentPortfolio(value: unknown): value is Portfolio {
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
    typeof candidate.updatedAt !== 'string' ||
    (candidate.cashDollars !== undefined && !isFiniteNonNegative(candidate.cashDollars))
  ) {
    return false
  }
  const positions = candidate.positions as Position[]
  if (new Set(positions.map((position) => position.ticker)).size !== positions.length) return false
  const total = candidate.cashWeight + positions.reduce((sum, position) => sum + position.weight, 0)
  return Math.abs(total - 100) <= 0.01
}

/** Shares are the truth: cash dollars are saved and every position has a share count. */
export function isSharesBased(portfolio: Portfolio): boolean {
  return portfolio.cashDollars !== undefined && portfolio.positions.every((position) => isFinitePositive(position.shares))
}

/** Recalculate weights from shares × last close and the fixed cash. */
export function remarkPortfolio(portfolio: Portfolio, byTicker: Map<string, UniverseEntry>): Portfolio | null {
  if (!isValidCurrentPortfolio(portfolio) || !isSharesBased(portfolio) || portfolio.positions.length === 0) return null
  const cashDollars = portfolio.cashDollars
  if (cashDollars === undefined) return null

  const valued = [] as Array<{ position: Position; value: number }>
  for (const position of portfolio.positions) {
    const price = positionPrice(byTicker.get(position.ticker))
    if (!isFinitePositive(price)) return null
    const value = position.shares! * price
    if (!isFinitePositive(value)) return null
    valued.push({ position, value })
  }
  const total = valued.reduce((sum, item) => sum + item.value, 0) + cashDollars
  if (!isFinitePositive(total)) return null

  const remarked: Portfolio = {
    id: portfolio.id,
    name: portfolio.name,
    cashWeight: cashDollars / total * 100,
    positions: valued.map(({ position, value }) => ({ ...position, weight: value / total * 100 })),
    updatedAt: portfolio.updatedAt,
    cashDollars,
  }
  return isValidCurrentPortfolio(remarked) ? remarked : null
}

/** Set a shares-based portfolio's fixed cash and re-mark its weights at the given prices (contract 0130).
 *  Null when the portfolio isn't shares-based, the amount is invalid, or a price is unusable. */
export function withCashDollars(
  portfolio: Portfolio,
  dollars: number,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null {
  if (!isValidCurrentPortfolio(portfolio) || !isSharesBased(portfolio) || !isFiniteNonNegative(dollars)) return null
  if (portfolio.positions.length === 0) return { ...portfolio, cashDollars: dollars, cashWeight: 100 }
  return remarkPortfolio({ ...portfolio, cashDollars: dollars }, byTicker)
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
  const cashWeight = cashFromPositions(positions)
  if (cashWeight === null) return null

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
  const cashWeight = cashFromPositions(positions)
  if (cashWeight === null) return null

  return {
    id: portfolio.id,
    name: portfolio.name,
    cashWeight,
    positions,
    updatedAt: portfolio.updatedAt,
  }
}

/** Sell a shares-based holding at its last close into fixed cash, then re-mark (contract 0131).
 *  Null when the portfolio isn't shares-based, the ticker isn't held, or a needed price is unusable. */
export function removePositionSelling(
  portfolio: Portfolio,
  ticker: string,
  byTicker: Map<string, UniverseEntry>,
): Portfolio | null {
  if (!isValidCurrentPortfolio(portfolio) || !isSharesBased(portfolio)) return null
  const position = portfolio.positions.find((candidate) => candidate.ticker === ticker)
  if (position === undefined) return null
  const price = positionPrice(byTicker.get(ticker))
  if (!isFinitePositive(price)) return null
  const proceeds = position.shares! * price
  if (!isFinitePositive(proceeds)) return null

  const base = removePositionToCash(portfolio, ticker)
  if (base === null) return null
  return withCashDollars({ ...base, cashDollars: 0 }, portfolio.cashDollars! + proceeds, byTicker)
}

export const SELL_STEP = 0.01

/** Slider max for selling a holding: its weight rounded up to the next SELL_STEP (contract 0137). */
export function sellSliderMax(weight: number): number {
  return Math.max(SELL_STEP, Math.ceil(weight / SELL_STEP - 1e-9 / SELL_STEP) * SELL_STEP)
}

export type SellResult =
  | { ok: true; portfolio: Portfolio; sharesSold: number; proceeds: number; soldAll: boolean; holdingWeight: number }
  | { ok: false; reason: 'invalid' | 'no-price' | 'unpriced-holding' }

/** Sell `sellWeight` points of portfolio weight of a shares-based holding at last closing prices into
 *  fixed cash, then re-mark. At or above the holding's weight, sells all of it (contract 0137). */
export function sellPositionWeight(
  portfolio: Portfolio,
  ticker: string,
  sellWeight: number,
  byTicker: Map<string, UniverseEntry>,
): SellResult {
  if (!isValidCurrentPortfolio(portfolio) || !isSharesBased(portfolio) || !(sellWeight > 0) || !portfolio.positions.some((position) => position.ticker === ticker)) {
    return { ok: false, reason: 'invalid' }
  }
  const price = positionPrice(byTicker.get(ticker))
  if (!isFinitePositive(price)) return { ok: false, reason: 'no-price' }
  const marked = remarkPortfolio(portfolio, byTicker)
  if (marked === null) return { ok: false, reason: 'unpriced-holding' }
  const holdingWeight = marked.positions.find((position) => position.ticker === ticker)!.weight
  const held = portfolio.positions.find((position) => position.ticker === ticker)!
  if (sellWeight >= holdingWeight - 1e-9) {
    const next = removePositionSelling(portfolio, ticker, byTicker)
    if (next === null) return { ok: false, reason: 'unpriced-holding' }
    return { ok: true, portfolio: next, sharesSold: held.shares!, proceeds: held.shares! * price, soldAll: true, holdingWeight }
  }
  const sharesSold = held.shares! * sellWeight / holdingWeight
  const proceeds = sharesSold * price
  const positions = portfolio.positions.map((position) => position.ticker === ticker
    ? { ...position, shares: position.shares! - sharesSold }
    : position)
  const next = withCashDollars({ ...portfolio, positions }, portfolio.cashDollars! + proceeds, byTicker)
  if (next === null) return { ok: false, reason: 'unpriced-holding' }
  return { ok: true, portfolio: next, sharesSold, proceeds, soldAll: false, holdingWeight }
}


export type BuyResult =
  | { ok: true; portfolio: Portfolio; cost: number }
  | { ok: false; reason: 'invalid' | 'no-price' | 'insufficient-cash' | 'unpriced-holding' }

/** Buy a holding (new or already held) in a shares-based portfolio with its fixed cash, then
 *  re-mark (contracts 0135, 0136). */
export function addPositionBuying(
  portfolio: Portfolio,
  ticker: string,
  shares: number,
  byTicker: Map<string, UniverseEntry>,
): BuyResult {
  if (!isValidCurrentPortfolio(portfolio) || !isSharesBased(portfolio) || ticker === '' || !isFinitePositive(shares)) {
    return { ok: false, reason: 'invalid' }
  }
  const held = portfolio.positions.some((position) => position.ticker === ticker)
  const price = positionPrice(byTicker.get(ticker))
  if (!isFinitePositive(price)) return { ok: false, reason: 'no-price' }
  const cost = shares * price
  if (!isFinitePositive(cost)) return { ok: false, reason: 'invalid' }
  if (cost > portfolio.cashDollars! + 0.005) return { ok: false, reason: 'insufficient-cash' }

  const cashAfter = Math.max(0, portfolio.cashDollars! - cost)
  if (held) {
    const positions = portfolio.positions.map((position) =>
      position.ticker === ticker ? { ...position, shares: position.shares! + shares } : position)
    const next = withCashDollars({ ...portfolio, positions }, cashAfter, byTicker)
    if (next === null) return { ok: false, reason: 'unpriced-holding' }
    return { ok: true, portfolio: next, cost }
  }

  const base = addPositionDiluting(portfolio, { ticker, weight: 1, shares })
  if (base === null) return { ok: false, reason: 'invalid' }
  const next = withCashDollars({ ...base, cashDollars: 0 }, cashAfter, byTicker)
  if (next === null) return { ok: false, reason: 'unpriced-holding' }
  return { ok: true, portfolio: next, cost }
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
  cashDollars: number | null
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
    const cashWeight = draft.cash.trim() === '' ? 0 : parseFiniteNonNegative(draft.cash)
    const rows = draft.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      shares: parseFinitePositive(row.shares),
      weight: parseFinitePositive(row.weight),
    }))
    const allocatedPercent = (cashWeight ?? 0) + rows.reduce((sum, row) => sum + (row.weight ?? 0), 0)
    const remainderPercent = 100 - allocatedPercent

    let problem: string | null = null
    if (draft.name.trim() === '') problem = 'Give the portfolio a name'
    else if (draft.rows.some((row) => row.ticker === '')) problem = 'Choose a ticker for every asset'
    else if (byTicker.size > 0 && draft.rows.some((row) => row.ticker !== '' && !byTicker.has(row.ticker))) problem = 'Every asset must be a ticker in your Universe'
    else if (cashWeight === null) problem = 'Cash must be a valid percentage'
    else if (draft.rows.some((row) => parseFinitePositive(row.weight) === null)) problem = 'Every asset needs a strictly-positive weight'
    else if (Math.abs(allocatedPercent - 100) > 0.01) problem = 'Weights must add up to 100%'

    return {
      rows,
      cashWeight,
      cashDollars: null,
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
  else if (draft.rows.some((row) => !isFinitePositive(positionPrice(byTicker.get(row.ticker))))) problem = 'Every asset needs a usable last close'
  else if (!(totalValue > 0) || !Number.isFinite(totalValue)) problem = 'The initial allocation must be greater than zero'

  return {
    rows,
    cashWeight,
    cashDollars,
    allocatedPercent,
    remainderPercent: allocatedPercent === null ? null : 100 - allocatedPercent,
    canCreate: problem === null,
    problem,
  }
}

/** cashDollars to save when a portfolio is created, or undefined for a weight-based one. */
export function creationCashDollars(
  mode: EntryMode,
  summaryCashDollars: number | null,
  portfolio: Portfolio,
  byTicker: Map<string, UniverseEntry>,
): number | undefined {
  if (mode === 'shares') return summaryCashDollars !== null && summaryCashDollars >= 0 ? summaryCashDollars : undefined
  if (!portfolio.positions.every((position) => isFinitePositive(position.shares))) return undefined
  const implied = impliedPortfolioValue(portfolio, byTicker)
  return implied === null ? undefined : implied * portfolio.cashWeight / 100
}

/** The Portfolio a valid draft produces, or null when the draft cannot be created. Shared by
 *  New Portfolio's Create and the preset editor's Save so both serialise identically. */
export function buildDraftPortfolio(
  name: string,
  mode: EntryMode,
  summary: DraftSummary,
  byTicker: Map<string, UniverseEntry>,
  id: string,
  updatedAt: string,
): Portfolio | null {
  if (!summary.canCreate || summary.cashWeight === null) return null

  const positions: Position[] = summary.rows
    .filter((row) => row.ticker !== '' && row.weight !== null)
    .map((row) =>
      row.shares !== null
        ? { ticker: row.ticker, weight: row.weight as number, shares: row.shares }
        : { ticker: row.ticker, weight: row.weight as number },
    )
  const portfolio: Portfolio = { id, name: name.trim(), cashWeight: summary.cashWeight, positions, updatedAt }
  const cashDollars = creationCashDollars(mode, summary.cashDollars, portfolio, byTicker)
  return cashDollars === undefined ? portfolio : { ...portfolio, cashDollars }
}

/** The mode-dependent part of a composer draft: what a mode switch rewrites. */
export interface DraftFields {
  cash: string
  rows: DraftRow[]
}

/** The last mode switch, kept so an untouched switch back can be undone exactly. */
export interface ModeSwitch {
  from: EntryMode
  before: DraftFields
  after: DraftFields
}

function sameDraftFields(left: DraftFields, right: DraftFields): boolean {
  return (
    left.cash === right.cash &&
    left.rows.length === right.rows.length &&
    left.rows.every((row, index) => {
      const other = right.rows[index]
      return (
        row.id === other.id &&
        row.ticker === other.ticker &&
        row.shares === other.shares &&
        row.weight === other.weight
      )
    })
  )
}

/** Switch the composer's entry mode, restoring fields after an untouched round trip. Switching
 * to shares keeps existing share counts and derives cash dollars only from a complete, priced
 * share set. */
export function switchEntryMode(
  draft: { mode: EntryMode; cash: string; rows: DraftRow[] },
  nextMode: EntryMode,
  summary: DraftSummary,
  lastSwitch: ModeSwitch | null,
  byTicker: Map<string, UniverseEntry>,
): { fields: DraftFields; lastSwitch: ModeSwitch | null } {
  const currentFields = { cash: draft.cash, rows: draft.rows }
  if (nextMode === draft.mode) return { fields: currentFields, lastSwitch }

  if (
    lastSwitch !== null &&
    lastSwitch.from === nextMode &&
    sameDraftFields(currentFields, lastSwitch.after)
  ) {
    return { fields: lastSwitch.before, lastSwitch: null }
  }

  let fields: DraftFields
  if (nextMode === 'weight') {
    fields = {
      cash: summary.cashWeight !== null ? toFieldText(summary.cashWeight, 2) : '',
      rows: draft.rows.map((row) => {
        const weight = summary.rows.find((candidate) => candidate.id === row.id)?.weight
        return { ...row, weight: weight !== null && weight !== undefined ? toFieldText(weight, 4) : '' }
      }),
    }
  } else {
    let positionsValue = 0
    let completePricedSet = draft.rows.length > 0
    for (const row of draft.rows) {
      const shares = parseFinitePositive(row.shares)
      const price = positionPrice(byTicker.get(row.ticker))
      if (shares === null || !isFinitePositive(price)) {
        completePricedSet = false
        break
      }
      positionsValue += shares * price
    }
    const cashWeight = summary.cashWeight
    const cash = completePricedSet && cashWeight !== null && cashWeight >= 0 && cashWeight < 100 &&
      Number.isFinite(positionsValue) && positionsValue > 0
      ? toFieldText(positionsValue * cashWeight / (100 - cashWeight), 2)
      : ''
    fields = { cash, rows: draft.rows.map((row) => ({ ...row })) }
  }

  return {
    fields,
    lastSwitch: {
      from: draft.mode,
      before: currentFields,
      after: fields,
    },
  }
}
