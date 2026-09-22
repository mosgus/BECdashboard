import { isValidBasisDate, WEIGHT_EPSILON } from './portfolio'
import type { LegacyPortfolio, Portfolio, Position, StoredPortfolio } from './portfolio'

export const PORTFOLIO_STORAGE_KEY = 'bec-portfolios'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidCurrentPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.ticker === 'string' &&
    candidate.ticker !== '' &&
    isFiniteNumber(candidate.weight) &&
    candidate.weight > 0 &&
    (candidate.shares === undefined || (isFiniteNumber(candidate.shares) && candidate.shares > 0))
  )
}

function isValidLegacyPosition(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.ticker === 'string' && isFiniteNumber(candidate.shares)
}

function hasUniqueTickers(positions: Array<{ ticker: string }>): boolean {
  return new Set(positions.map((position) => position.ticker)).size === positions.length
}

function isValidCurrentPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if ('cash' in candidate || 'totalValue' in candidate) return false
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    !isFiniteNumber(candidate.cashWeight) ||
    candidate.cashWeight < 0 ||
    (candidate.basisDate !== undefined && !isValidBasisDate(candidate.basisDate)) ||
    !Array.isArray(candidate.positions) ||
    !candidate.positions.every(isValidCurrentPosition) ||
    !hasUniqueTickers(candidate.positions as Position[]) ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return false
  }
  const total = candidate.cashWeight + (candidate.positions as Position[]).reduce((sum, position) => sum + position.weight, 0)
  return Math.abs(total - 100) <= 0.01
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
  if (typeof candidate.cashWeight !== 'number' || !(candidate.cashWeight < 0 && candidate.cashWeight > -WEIGHT_EPSILON)) return value
  return { ...candidate, cashWeight: 0 }
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
      basisDate: portfolio.basisDate,
    }
    const existing = listPortfolios()
    const index = existing.findIndex((candidate) => candidate.id === stamped.id)
    const next = index === -1 ? [...existing, stamped] : existing.map((candidate, i) => (i === index ? stamped : candidate))
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — the caller's state still reflects the change for this session.
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
