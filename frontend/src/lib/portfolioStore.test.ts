import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Portfolio } from './portfolio'
import { listPortfolios, PORTFOLIO_STORAGE_KEY, remarkStoredPortfolios, savePortfolio } from './portfolioStore'

function storedPortfolio(cashWeight: number): Portfolio {
  return {
    id: 'portfolio',
    name: 'Portfolio',
    cashWeight,
    positions: [{ ticker: 'AAPL', weight: 100 }],
    updatedAt: '2026-09-21T00:00:00Z',
  }
}

function stubStorage(portfolios: unknown[]): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => key === PORTFOLIO_STORAGE_KEY ? JSON.stringify(portfolios) : null),
    setItem,
  })
  return { setItem }
}

afterEach(() => vi.unstubAllGlobals())

describe('listPortfolios', () => {
  it('recovers a negative-epsilon cash residue without writing during the read', () => {
    const storage = stubStorage([storedPortfolio(-1.4210854715202004e-14)])

    expect(listPortfolios()).toEqual([{ ...storedPortfolio(-1.4210854715202004e-14), cashWeight: 0 }])
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('rejects a negative value outside the float-noise window', () => {
    stubStorage([storedPortfolio(-0.005)])

    expect(listPortfolios()).toEqual([])
  })

  it('strips a legacy basisDate on read', () => {
    stubStorage([{ ...storedPortfolio(0), basisDate: '2026-01-02' }])

    const result = listPortfolios()
    expect(result).toHaveLength(1)
    expect('basisDate' in result[0]).toBe(false)
  })

  it('loads a portfolio whose legacy basisDate is malformed', () => {
    stubStorage([{ ...storedPortfolio(0), basisDate: 'not-a-date' }])

    const result = listPortfolios()
    expect(result).toHaveLength(1)
    expect('basisDate' in result[0]).toBe(false)
  })

  it('does not re-save a legacy basisDate on a sibling', () => {
    let stored = JSON.stringify([
      { ...storedPortfolio(0), id: 'first', basisDate: '2026-01-02' },
      { ...storedPortfolio(0), id: 'second', basisDate: '2026-01-02' },
    ])
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value
      }),
    })

    savePortfolio({ ...storedPortfolio(0), id: 'first' })
    expect(JSON.parse(stored).every((portfolio: Record<string, unknown>) => !('basisDate' in portfolio))).toBe(true)
  })
})

describe('shares-based storage', () => {
  it('preserves fixed cash when saving', () => {
    const storage = stubStorage([])
    savePortfolio({ ...storedPortfolio(10), cashDollars: 100 })
    expect(JSON.parse(storage.setItem.mock.calls[0][1])[0].cashDollars).toBe(100)
  })

  it('re-marks shares portfolios without touching weight-based siblings', () => {
    const shares = { ...storedPortfolio(10), id: 'shares', cashDollars: 100, positions: [{ ticker: 'AAA', weight: 45, shares: 10 }, { ticker: 'BBB', weight: 45, shares: 30 }] }
    const weight = { ...storedPortfolio(100), id: 'weight', positions: [] }
    const storage = stubStorage([shares, weight])
    remarkStoredPortfolios([
      { ticker: 'AAA', current_price: 55 },
      { ticker: 'BBB', current_price: 15 },
    ] as never)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(storage.setItem.mock.calls[0][1])
    expect(saved[0].positions[0].weight).toBeCloseTo(50, 6)
    expect(saved[0].updatedAt).toBe(shares.updatedAt)
    expect(saved[1]).toEqual(weight)
  })

  it('does not write when no portfolio can be re-marked', () => {
    const storage = stubStorage([storedPortfolio(100)])
    remarkStoredPortfolios([])
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
