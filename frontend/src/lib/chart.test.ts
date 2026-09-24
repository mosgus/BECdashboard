import { describe, expect, it } from 'vitest'
import { downsample, priceDomain, rangeReturn, snapRange } from './chart'

describe('rangeReturn', () => {
  it('returns the signed change and dates from the first to last point', () => {
    expect(rangeReturn([
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 105 },
      { date: '2024-01-04', value: 110 },
    ])).toEqual({
      label: '+10.00%',
      direction: 'up',
      from: '2024-01-02',
      to: '2024-01-04',
    })
  })

  it('returns a down direction for a negative change', () => {
    expect(rangeReturn([
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 90 },
    ])).toMatchObject({ label: '-10.00%', direction: 'down' })
  })

  it('returns flat for a change that rounds to zero', () => {
    expect(rangeReturn([
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 100.004 },
    ])).toMatchObject({ label: '0.00%', direction: 'flat' })
  })

  it('returns null with fewer than two points or a zero first value', () => {
    expect(rangeReturn([{ date: '2024-01-02', value: 100 }])).toBeNull()
    expect(rangeReturn([])).toBeNull()
    expect(rangeReturn([
      { date: '2024-01-02', value: 0 },
      { date: '2024-01-03', value: 100 },
    ])).toBeNull()
  })
})

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
