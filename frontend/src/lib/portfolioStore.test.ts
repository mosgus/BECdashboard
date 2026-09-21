import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Portfolio } from './portfolio'
import { listPortfolios, PORTFOLIO_STORAGE_KEY } from './portfolioStore'

function storedPortfolio(cashWeight: number): Portfolio {
  return {
    id: 'portfolio',
    name: 'Portfolio',
    cashWeight,
    positions: [{ ticker: 'AAPL', weight: 100 }],
    updatedAt: '2026-09-21T00:00:00Z',
  }
}

function stubStorage(portfolios: Portfolio[]): { setItem: ReturnType<typeof vi.fn> } {
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
})
