import {
  attributionPortfolio,
  comparePortfolio,
  getUniverse,
  performancePortfolio,
  riskPortfolio,
} from '../api/client'
import type { UniverseEntry } from '../api/client'
import { memoizeRequest } from './requestCache'

// Shared by the Research tab's sections (contract 0191). Results are kept for 10 minutes: prices
// update at most daily, and a holdings change alters the request, so it never matches an old entry.
const OPTIONS = { ttlMs: 10 * 60_000, maxEntries: 20 }

export const cachedComparePortfolio = memoizeRequest(comparePortfolio, OPTIONS)
export const cachedRiskPortfolio = memoizeRequest(riskPortfolio, OPTIONS)
export const cachedPerformancePortfolio = memoizeRequest(performancePortfolio, OPTIONS)
export const cachedAttributionPortfolio = memoizeRequest(attributionPortfolio, OPTIONS)
export const cachedUniverse = memoizeRequest<void, UniverseEntry[]>(getUniverse, {
  ttlMs: 10 * 60_000,
  maxEntries: 1,
})
