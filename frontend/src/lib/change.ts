export type ChangeDirection = 'up' | 'down' | 'flat'

export interface PriceChange {
  percent: number | null
  direction: ChangeDirection
  label: string
  live: boolean
}

/** The percentage change for the Price cell's change label.
 *
 * With a live current price: percent change against lastClose, live=true.
 * Without a live price but with prior session data: yesterday's close against prior close, live=false.
 * Otherwise: no data to compute, live=false.
 *
 * Never divide by zero, never render Infinity or NaN.
 *
 * Direction and label sign derive from rounded percentage, not raw — otherwise a tiny positive
 * change renders with a misleading positive sign. `percent` is unrounded; only direction/label
 * round. */
export function priceChange(
  current: number | null,
  lastClose: number | null,
  priorClose?: number | null,
): PriceChange {
  if (current !== null && lastClose !== null && lastClose !== 0) {
    const percent = ((current - lastClose) / lastClose) * 100
    let rounded = Math.round(percent * 100) / 100
    if (rounded === 0) rounded = 0
    const direction: ChangeDirection = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
    const sign = rounded > 0 ? '+' : ''
    const label = `${sign}${rounded.toFixed(2)}%`
    return { percent, direction, label, live: true }
  }

  if (
    current === null &&
    lastClose !== null &&
    priorClose !== undefined &&
    priorClose !== null &&
    priorClose !== 0
  ) {
    const percent = ((lastClose - priorClose) / priorClose) * 100
    let rounded = Math.round(percent * 100) / 100
    if (rounded === 0) rounded = 0
    const direction: ChangeDirection = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat'
    const sign = rounded > 0 ? '+' : ''
    const label = `${sign}${rounded.toFixed(2)}%`
    return { percent, direction, label, live: false }
  }

  return { percent: null, direction: 'flat', label: '', live: false }
}
