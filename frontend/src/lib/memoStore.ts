import { RECOMMENDATIONS } from './memo'
import type { DecisionMemo, Recommendation } from './memo'

export const MEMO_STORAGE_KEY = 'bec-research-memos'

function isValidMemo(value: unknown): value is DecisionMemo {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.portfolioId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.rationale === 'string' &&
    typeof candidate.monitoringPlan === 'string' &&
    RECOMMENDATIONS.includes(candidate.recommendation as Recommendation) &&
    Array.isArray(candidate.redFlags) &&
    Array.isArray(candidate.holdings) &&
    typeof candidate.cashWeight === 'number' &&
    Number.isFinite(candidate.cashWeight) &&
    (candidate.evidence === null || typeof candidate.evidence === 'object')
  )
}

/** Read every stored memo, dropping malformed entries. Browser storage is user-editable and may be
 * unavailable, so every access is guarded. */
function readAll(): DecisionMemo[] {
  try {
    const raw = localStorage.getItem(MEMO_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidMemo)
  } catch {
    return []
  }
}

function writeAll(memos: DecisionMemo[]): boolean {
  try {
    localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(memos))
    return true
  } catch {
    return false
  }
}

export function listMemos(portfolioId: string): DecisionMemo[] {
  return readAll()
    .filter((memo) => memo.portfolioId === portfolioId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/** Returns false when storage throws, so the UI can say the memo was not saved. */
export function saveMemo(memo: DecisionMemo): boolean {
  return writeAll([...readAll(), memo])
}

export function deleteMemo(id: string): void {
  writeAll(readAll().filter((memo) => memo.id !== id))
}

export function deleteMemosForPortfolio(portfolioId: string): void {
  writeAll(readAll().filter((memo) => memo.portfolioId !== portfolioId))
}
