const NIL = '—'

export function formatPrice(v: number | null): string {
  if (v === null) return NIL
  return v.toFixed(2)
}

export function formatMarketCap(v: number | null): string {
  if (v === null) return NIL
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  return v.toFixed(2)
}

export function formatRatio(v: number | null): string {
  if (v === null) return NIL
  return v.toFixed(1)
}

export function formatPercent(v: number | null): string {
  if (v === null) return NIL
  // v is already in percent units (0.33 means 0.33%) — never scale it.
  return `${v.toFixed(2)}%`
}

export function formatCount(v: number): string {
  return v.toLocaleString('en-US')
}

/** Share counts. Thousands separators like formatCount, but up to 6 fraction digits and no
 *  trailing zeros — fractional shares are ordinary, and 0.5 should not read as 0.500000.
 *  Separate from formatCount, which formats bar counts and must stay integral. */
export function formatShares(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function formatDateRange(a: string | null, b: string | null): string {
  if (a === null || b === null) return NIL
  return `${a} → ${b}`
}
