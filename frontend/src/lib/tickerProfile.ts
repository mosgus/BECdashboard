import type { PerformanceRequest, StressPointOut } from '../api/client'

export const ROLLING_VOL_DAYS = 63

export type ProfileWindow = { ok: true; start: string; end: string; clamped: boolean } | { ok: false; message: string }

// A ticker's prices must start on or before the window start, or the engine rejects the request,
// so the window never begins before the first stored bar.
export function profileWindow(start: string, end: string, firstBarDate: string | null): ProfileWindow {
  if (start === '' || end === '') return { ok: false, message: 'Choose a start and end date above.' }
  if (start >= end) return { ok: false, message: 'Start date must be before end date.' }
  const clamped = firstBarDate !== null && firstBarDate > start
  const from = clamped ? firstBarDate : start
  if (from >= end) return { ok: false, message: 'No stored prices in this date range.' }
  return { ok: true, start: from, end, clamped }
}

export function profileRequest(symbol: string, start: string, end: string): PerformanceRequest {
  return { tickers: [symbol], weights: [1], cash: 0, start, end, market_ticker: 'SPY' }
}

export function rollingVol(
  path: StressPointOut[],
  window: number = ROLLING_VOL_DAYS,
): { date: string; value: number }[] {
  if (path.length <= window) return []
  const returns = path.map((point, i) => (i === 0 ? 0 : point.value / path[i - 1].value - 1))
  const out: { date: string; value: number }[] = []
  for (let i = window; i < path.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1)
    const mean = slice.reduce((sum, r) => sum + r, 0) / window
    const variance = slice.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (window - 1)
    out.push({ date: path[i].date, value: Math.sqrt(variance) * Math.sqrt(252) })
  }
  return out
}
