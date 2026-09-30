import { isValidCurrentPortfolio, remarkPortfolio, WEIGHT_EPSILON } from './portfolio'
import type { LegacyPortfolio, Portfolio, StoredPortfolio } from './portfolio'
import type { UniverseEntry } from '../api/client'

export const PORTFOLIO_STORAGE_KEY = 'bec-portfolios'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidLegacyPosition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.ticker === 'string' && isFiniteNumber(candidate.shares)
}

function isValidLegacyPortfolio(value: unknown): value is LegacyPortfolio {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isFiniteNumber(candidate.cash) &&
    Array.isArray(candidate.positions) &&
    candidate.positions.every(isValidLegacyPosition) &&
    typeof candidate.updatedAt === 'string'
  )
}

export function isLegacyPortfolio(value: StoredPortfolio): value is LegacyPortfolio {
  return 'cash' in value
}

function normaliseStoredPortfolio(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const candidate = value as Record<string, unknown>
  const { basisDate: _basisDate, ...withoutBasisDate } = candidate
  if (typeof candidate.cashWeight !== 'number' || !(candidate.cashWeight < 0 && candidate.cashWeight > -WEIGHT_EPSILON)) return withoutBasisDate
  return { ...withoutBasisDate, cashWeight: 0 }
}

/** Read both schemas without discarding valid legacy data. Browser storage is user-editable and
 * may be unavailable, so every access remains guarded. */
export function listPortfolios(): StoredPortfolio[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(normaliseStoredPortfolio)
      .filter((value): value is StoredPortfolio => isValidCurrentPortfolio(value) || isValidLegacyPortfolio(value))
  } catch {
    return []
  }
}

/** Save a current portfolio in place, preserving valid legacy siblings and list order. */
export function savePortfolio(portfolio: Portfolio): void {
  try {
    const stamped: Portfolio = {
      id: portfolio.id,
      name: portfolio.name,
      cashWeight: portfolio.cashWeight,
      positions: portfolio.positions,
      updatedAt: new Date().toISOString(),
      ...(portfolio.cashDollars === undefined ? {} : { cashDollars: portfolio.cashDollars }),
    }
    const existing = listPortfolios()
    const index = existing.findIndex((candidate) => candidate.id === stamped.id)
    const next = index === -1 ? [...existing, stamped] : existing.map((candidate, i) => (i === index ? stamped : candidate))
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — the caller's state still reflects the change for this session.
  }
}

/** Re-mark every shares-based portfolio against freshly loaded prices (contract 0129). */
export function remarkStoredPortfolios(entries: UniverseEntry[]): void {
  try {
    const byTicker = new Map(entries.map((entry) => [entry.ticker, entry]))
    let remarked = false
    const next = listPortfolios().map((portfolio) => {
      if (isLegacyPortfolio(portfolio)) return portfolio
      const nextPortfolio = remarkPortfolio(portfolio, byTicker)
      if (nextPortfolio !== null) remarked = true
      return nextPortfolio ?? portfolio
    })
    if (remarked) replacePortfolios(next)
  } catch {
    // A re-mark must never prevent a Universe load.
  }
}

/** Replace the whole validated-or-legacy list after an explicit migration pass. */
export function replacePortfolios(portfolios: StoredPortfolio[]): void {
  try {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(portfolios))
  } catch {
    // Storage unavailable — the caller's state still reflects the migration for this session.
  }
}

export function deletePortfolio(id: string): void {
  try {
    const remaining = listPortfolios().filter((existing) => existing.id !== id)
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(remaining))
  } catch {
    // Storage unavailable — nothing persisted to delete anyway.
  }
}
