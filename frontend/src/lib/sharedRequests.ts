import {
  attributionPortfolio,
  comparePortfolio,
  getReturns,
  getSignals,
  getUniverse,
  performancePortfolio,
  riskPortfolio,
} from '../api/client'
import type { UniverseEntry } from '../api/client'
import { memoizeRequest } from './requestCache'

// Shared by every portfolio tab (contracts 0191, 0194). Results are kept for 10 minutes: prices
// update at most daily, a holdings change alters the request so it never matches an old entry, and
// anything that changes the universe calls clearSharedRequests().
const OPTIONS = { ttlMs: 10 * 60_000, maxEntries: 20 }

export const cachedComparePortfolio = memoizeRequest(comparePortfolio, OPTIONS)
export const cachedRiskPortfolio = memoizeRequest(riskPortfolio, OPTIONS)
export const cachedPerformancePortfolio = memoizeRequest(performancePortfolio, OPTIONS)
export const cachedAttributionPortfolio = memoizeRequest(attributionPortfolio, OPTIONS)
export const cachedGetReturns = memoizeRequest(getReturns, OPTIONS)
export const cachedGetSignals = memoizeRequest(getSignals, OPTIONS)
export const cachedUniverse = memoizeRequest<void, UniverseEntry[]>(getUniverse, {
  ttlMs: 10 * 60_000,
  maxEntries: 1,
})

const ALL = [
  cachedComparePortfolio,
  cachedRiskPortfolio,
  cachedPerformancePortfolio,
  cachedAttributionPortfolio,
  cachedGetReturns,
  cachedGetSignals,
  cachedUniverse,
]

/** Drops every shared result. Call after anything that changes the universe or its stored prices. */
export function clearSharedRequests(): void {
  for (const cached of ALL) cached.clear()
}
