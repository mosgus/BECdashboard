import { describe, expect, it } from 'vitest'
import { downsample, priceDomain, snapRange } from './chart'

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
      { value: 100, bollinger_lower: 80 },
      { value: 105 },
      { value: 110 },
    ]

    const [lower] = priceDomain(rows)

    expect(lower).toBeLessThan(80)
  })

  it('extends the upper bound above a bollinger_upper value outside the close range', () => {
    const rows = [
      { value: 100, bollinger_upper: 200 },
      { value: 105 },
      { value: 110 },
    ]

    const [, upper] = priceDomain(rows)

    expect(upper).toBeGreaterThan(200)
  })

  it('ignores a key that is null in every row', () => {
    const withKey = [
      { value: 100, sma_fast: null },
      { value: 110, sma_fast: null },
    ]
    const withoutKey = [
      { value: 100 },
      { value: 110 },
    ]

    expect(priceDomain(withKey)).toEqual(priceDomain(withoutKey, ['value']))
  })

  it('ignores a key not included in the keys list even when present in rows', () => {
    const rows = [
      { value: 100, obv: 5_000_000 },
      { value: 110, obv: 5_000_000 },
    ]

    const [, upper] = priceDomain(rows, ['value'])

    expect(upper).toBeLessThan(200)
  })

  it('returns a non-zero span for a flat series', () => {
    const rows = [{ value: 100 }, { value: 100 }, { value: 100 }]

    const [lower, upper] = priceDomain(rows)

    expect(upper - lower).toBeGreaterThan(0)
  })

  it('returns [0, 1] for empty input', () => {
    expect(priceDomain([])).toEqual([0, 1])
  })
})

describe('snapRange', () => {
  const dates = ['2024-01-02', '2024-01-05', '2024-01-09']

  it('snaps both edges to rendered dates', () => {
    expect(snapRange(dates, '2024-01-03', '2024-01-08')).toEqual(['2024-01-05', '2024-01-05'])
  })

  it('returns null when no rendered date starts the range', () => {
    expect(snapRange(dates, '2024-01-10', '2024-01-12')).toBeNull()
  })

  it('returns null when no rendered date ends the range', () => {
    expect(snapRange(dates, '2024-01-01', '2024-01-01')).toBeNull()
  })
})
