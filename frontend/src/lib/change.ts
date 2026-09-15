export type ChangeDirection = 'up' | 'down' | 'flat'

export interface PriceChange {
  percent: number | null
  direction: ChangeDirection
  label: string
}

/** The percentage change of `current` against `lastClose`, for the Price cell's change label.
 *
 * `current` null is the market-closed case — the Price cell is showing `lastClose` itself
 * then, so the change against it is genuinely zero, not unknown.
 *
 * `lastClose` null or 0 means there is nothing to compute a percentage against — never divide
 * by zero, never render Infinity or NaN.
 *
 * Direction and the label's sign are derived from the *rounded* percentage, not the raw one —
 * otherwise a raw +0.004% renders as a green "+0.00%", a colour that contradicts the number
 * beside it. `percent` itself is returned unrounded; only direction/label go through rounding. */
export function priceChange(current: number | null, lastClose: number | null): PriceChange {
  if (current === null) {
    return { percent: 0, direction: 'flat', label: '0.00%' }
  }
  if (lastClose === null || lastClose === 0) {
    return { percent: null, direction: 'flat', label: '' }
  }

  const percent = ((current - lastClose) / lastClose) * 100

  let rounded = Math.round(percent * 100) / 100
  if (rounded === 0) rounded = 0 // normalizes -0 to 0 so toFixed never prints "-0.00"

  const direction: ChangeDirection = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
  const sign = rounded > 0 ? '+' : ''
  const label = `${sign}${rounded.toFixed(2)}%`

  return { percent, direction, label }
}
