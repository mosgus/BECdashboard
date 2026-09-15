import type { PriceBar } from '../api/client'

export type RangeKey = '10Y' | '5Y' | '1Y' | 'YTD' | '6M' | '3M' | '1M' | '5D'

export const RANGE_KEYS: RangeKey[] = ['10Y', '5Y', '1Y', 'YTD', '6M', '3M', '1M', '5D']

export const DEFAULT_RANGE: RangeKey = 'YTD'

function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

/** The start of `key`'s window, anchored to `lastBarDate` — never to the current date. The
 * newest bar is Friday's close over a weekend; anchoring to "now" would silently shift every
 * window (5D would return three bars on a Monday). Clamps silently for 10Y against a shorter
 * history — it does not pad. */
export function rangeStart(key: RangeKey, lastBarDate: Date): Date {
  const d = new Date(lastBarDate)
  if (key === 'YTD') return new Date(lastBarDate.getFullYear(), 0, 1)
  if (key === '5D') {
    d.setDate(d.getDate() - 7)
    return d
  }
  if (key === '1M') {
    d.setMonth(d.getMonth() - 1)
    return d
  }
  if (key === '3M') {
    d.setMonth(d.getMonth() - 3)
    return d
  }
  if (key === '6M') {
    d.setMonth(d.getMonth() - 6)
    return d
  }
  if (key === '1Y') {
    d.setFullYear(d.getFullYear() - 1)
    return d
  }
  if (key === '5Y') {
    d.setFullYear(d.getFullYear() - 5)
    return d
  }
  d.setFullYear(d.getFullYear() - 10) // '10Y'
  return d
}

/** Bars within `key`'s window, oldest first, with null-close bars dropped — a gap in a price
 * line is a lie, so these are excluded rather than interpolated or charted as a gap. */
export function sliceRange(bars: PriceBar[], key: RangeKey, lastBarDate: Date): PriceBar[] {
  const start = rangeStart(key, lastBarDate)
  return bars.filter((bar) => bar.close !== null && parseLocalDate(bar.date) >= start)
}

/** False when a range would yield fewer than 2 chartable points — the caller renders that
 * range's button disabled rather than an empty chart. */
export function hasEnoughData(bars: PriceBar[], key: RangeKey, lastBarDate: Date): boolean {
  return sliceRange(bars, key, lastBarDate).length >= 2
}

/** Appends a synthetic bar for the live quote, or replaces the last bar when it already
 * covers the same date — after the close, the daily bar for today may already exist *and* a
 * quote may still be stored, and appending would put two points on the same date and draw a
 * visible spike. Returns `bars` unchanged when `currentPrice` or `asOfISODate` is null — the
 * closed-market case, and the common one. Never mutates the input array. */
export function withLiveQuote(
  bars: PriceBar[],
  currentPrice: number | null,
  asOfISODate: string | null,
): PriceBar[] {
  if (currentPrice === null || asOfISODate === null) return bars

  const liveBar: PriceBar = { date: asOfISODate, close: currentPrice, adj_close: null }

  if (bars.length > 0 && bars[bars.length - 1].date === asOfISODate) {
    return [...bars.slice(0, -1), liveBar]
  }

  return [...bars, liveBar]
}
