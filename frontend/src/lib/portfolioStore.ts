import type { Portfolio, Position } from './portfolio'

export const PORTFOLIO_STORAGE_KEY = 'bec-portfolios'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.ticker === 'string' && isFiniteNumber(candidate.shares)
}

function isValidPortfolio(value: unknown): value is Portfolio {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isFiniteNumber(candidate.cash) &&
    Array.isArray(candidate.positions) &&
    candidate.positions.every(isValidPosition) &&
    typeof candidate.updatedAt === 'string'
  )
}

/** Reads every stored portfolio, dropping anything malformed rather than trusting it. This is
 * user-editable storage (devtools, a future schema change, a stray write from a bug) that
 * survives indefinitely — a stray shape must yield a missing portfolio, never a white screen.
 * `localStorage` access throws outright in some privacy modes, so the whole read is guarded;
 * an unguarded read in a useState initialiser would crash the page during render. */
export function listPortfolios(): Portfolio[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidPortfolio)
  } catch {
    return []
  }
}

/** Upserts by id and stamps updatedAt — **in place**, preserving list order (contract 0050 fix
 * 1). Appending on every save instead walked whatever portfolio was being edited to the bottom
 * of the list, since persist() runs on every rename keystroke and every cash change. Guarded
 * the same way listPortfolios is — a browser that refuses to store the write still applies it
 * for this session, it just will not persist across a reload. */
export function savePortfolio(portfolio: Portfolio): void {
  try {
    const stamped: Portfolio = { ...portfolio, updatedAt: new Date().toISOString() }
    const existing = listPortfolios()
    const index = existing.findIndex((candidate) => candidate.id === stamped.id)
    const next = index === -1 ? [...existing, stamped] : existing.map((candidate, i) => (i === index ? stamped : candidate))
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable — the caller's own state still reflects the change for this session.
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
