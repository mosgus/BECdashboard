import { describe, expect, it } from 'vitest'
import type { StressPointOut } from '../api/client'
import { profileRequest, profileWindow, rollingVol } from './tickerProfile'

function pathOf(multipliers: number[]): StressPointOut[] {
  let value = 100
  const path: StressPointOut[] = [{ date: '2024-01-01', value, market: null }]
  multipliers.forEach((m, i) => {
    value *= m
    path.push({ date: `2024-01-0${i + 2}`, value, market: null })
  })
  return path
}

describe('profileWindow', () => {
  it('uses the chosen dates when there is enough history', () => {
    expect(profileWindow('2023-10-26', '2024-10-26', '2010-01-04')).toEqual({
      ok: true,
      start: '2023-10-26',
      end: '2024-10-26',
      clamped: false,
    })
  })
  it('clamps the start to the first stored bar', () => {
    expect(profileWindow('2020-01-01', '2026-10-26', '2024-03-01')).toEqual({
      ok: true,
      start: '2024-03-01',
      end: '2026-10-26',
      clamped: true,
    })
  })
  it('rejects empty or inverted dates', () => {
    expect(profileWindow('', '2026-10-26', null).ok).toBe(false)
    expect(profileWindow('2026-10-26', '2026-10-26', null).ok).toBe(false)
  })
  it('rejects a window that ends before the first stored bar', () => {
    expect(profileWindow('2020-01-01', '2021-01-01', '2024-03-01').ok).toBe(false)
  })
})

describe('profileRequest', () => {
  it('is one ticker at full weight against SPY', () => {
    expect(profileRequest('MS', '2023-10-26', '2024-10-26')).toEqual({
      tickers: ['MS'],
      weights: [1],
      cash: 0,
      start: '2023-10-26',
      end: '2024-10-26',
      market_ticker: 'SPY',
    })
  })
})

describe('rollingVol', () => {
  it('uses the sample standard deviation, annualised', () => {
    const path = pathOf([1.01, 0.99, 1.01, 0.99, 1.01])
    const out = rollingVol(path, 4)
    expect(out.map((p) => p.date)).toEqual([path[4].date, path[5].date])
    const expected = 0.01 * Math.sqrt(4 / 3) * Math.sqrt(252)
    out.forEach((p) => expect(p.value).toBeCloseTo(expected, 6))
  })
  it('is zero for constant growth', () => {
    const out = rollingVol(pathOf([1.01, 1.01, 1.01, 1.01, 1.01]), 4)
    out.forEach((p) => expect(p.value).toBeCloseTo(0, 10))
  })
  it('returns nothing when the path is no longer than the window', () => {
    expect(rollingVol(pathOf([1.01, 0.99, 1.01, 0.99]), 5)).toEqual([])
  })
})
