import { describe, expect, it } from 'vitest'
import { downsample, priceDomain } from './chart'

describe('downsample', () => {
  it('returns short input by reference', () => {
    const rows = Array.from({ length: 10 }, (_, index) => index)

    expect(downsample(rows, 400)).toBe(rows)
  })

  it('caps long input at the requested maximum', () => {
    const rows = Array.from({ length: 2500 }, (_, index) => index)

    expect(downsample(rows, 400).length).toBeLessThanOrEqual(400)
  })

  it('keeps the final row of long input', () => {
    const rows = Array.from({ length: 2500 }, (_, index) => index)

    expect(downsample(rows, 400).at(-1)).toBe(rows.at(-1))
  })

  it('returns an empty array for empty input', () => {
    expect(downsample([], 400)).toEqual([])
  })
})

describe('priceDomain', () => {
  it('extends the lower bound below a bollinger_lower value outside the close range', () => {
    const rows = [
      { adj_close: 100, bollinger_lower: 80 },
      { adj_close: 105 },
      { adj_close: 110 },
    ]

    const [lower] = priceDomain(rows)

    expect(lower).toBeLessThan(80)
  })

  it('extends the upper bound above a bollinger_upper value outside the close range', () => {
    const rows = [
      { adj_close: 100, bollinger_upper: 200 },
      { adj_close: 105 },
      { adj_close: 110 },
    ]

    const [, upper] = priceDomain(rows)

    expect(upper).toBeGreaterThan(200)
  })

  it('ignores a key that is null in every row', () => {
    const withKey = [
      { adj_close: 100, sma_fast: null },
      { adj_close: 110, sma_fast: null },
    ]
    const withoutKey = [
      { adj_close: 100 },
      { adj_close: 110 },
    ]

    expect(priceDomain(withKey)).toEqual(priceDomain(withoutKey, ['adj_close']))
  })

  it('ignores a key not included in the keys list even when present in rows', () => {
    const rows = [
      { adj_close: 100, obv: 5_000_000 },
      { adj_close: 110, obv: 5_000_000 },
    ]

    const [, upper] = priceDomain(rows, ['adj_close'])

    expect(upper).toBeLessThan(200)
  })

  it('returns a non-zero span for a flat series', () => {
    const rows = [{ adj_close: 100 }, { adj_close: 100 }, { adj_close: 100 }]

    const [lower, upper] = priceDomain(rows)

    expect(upper - lower).toBeGreaterThan(0)
  })

  it('returns [0, 1] for empty input', () => {
    expect(priceDomain([])).toEqual([0, 1])
  })
})
