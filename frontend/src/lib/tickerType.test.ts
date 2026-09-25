import { describe, expect, it } from 'vitest'
import { isHoldableType } from './tickerType'

describe('isHoldableType', () => {
  it('is true for equities, ETFs, mutual funds and unknown (null) types', () => {
    expect(isHoldableType('EQUITY')).toBe(true)
    expect(isHoldableType('ETF')).toBe(true)
    expect(isHoldableType('MUTUALFUND')).toBe(true)
    expect(isHoldableType('etf')).toBe(true)
    expect(isHoldableType(null)).toBe(true)
  })

  it('is false for indices, currencies, cryptocurrencies and futures', () => {
    expect(isHoldableType('INDEX')).toBe(false)
    expect(isHoldableType('CURRENCY')).toBe(false)
    expect(isHoldableType('CRYPTOCURRENCY')).toBe(false)
    expect(isHoldableType('FUTURE')).toBe(false)
  })
})
