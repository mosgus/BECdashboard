import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionMemo } from './memo'
import { deleteMemosForPortfolio, listMemos, MEMO_STORAGE_KEY, saveMemo } from './memoStore'

function memo(id: string, portfolioId: string, createdAt: string, recommendation: string = 'GO'): DecisionMemo {
  return {
    id,
    portfolioId,
    createdAt,
    recommendation,
    rationale: 'r',
    monitoringPlan: '',
    redFlags: [],
    holdings: [],
    cashWeight: 0,
    evidence: null,
  } as DecisionMemo
}

function stubStorage(memos: unknown[]): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => (key === MEMO_STORAGE_KEY ? JSON.stringify(memos) : null)),
    setItem,
  })
  return { setItem }
}

afterEach(() => vi.unstubAllGlobals())

describe('listMemos', () => {
  it('returns one portfolio newest first and drops malformed entries', () => {
    stubStorage([
      memo('old', 'p1', '2026-01-01T00:00:00Z'),
      memo('other', 'p2', '2026-03-01T00:00:00Z'),
      memo('new', 'p1', '2026-02-01T00:00:00Z'),
      memo('bad', 'p1', '2026-04-01T00:00:00Z', 'MAYBE'),
    ])
    expect(listMemos('p1').map((m) => m.id)).toEqual(['new', 'old'])
  })

  it('returns [] when getItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: vi.fn(),
    })
    expect(listMemos('p1')).toEqual([])
  })
})

describe('saveMemo', () => {
  it('writes under the storage key and returns true', () => {
    const storage = stubStorage([])
    expect(saveMemo(memo('a', 'p1', '2026-01-01T00:00:00Z'))).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(MEMO_STORAGE_KEY, expect.any(String))
  })

  it('returns false when setItem throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('full')
      },
    })
    expect(saveMemo(memo('a', 'p1', '2026-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('deleteMemosForPortfolio', () => {
  it('removes only that portfolio’s memos', () => {
    const storage = stubStorage([memo('a', 'p1', '2026-01-01T00:00:00Z'), memo('b', 'p2', '2026-01-02T00:00:00Z')])
    deleteMemosForPortfolio('p1')
    const written = JSON.parse(storage.setItem.mock.calls[0][1] as string) as DecisionMemo[]
    expect(written.map((m) => m.id)).toEqual(['b'])
  })
})
