export const MAX_CHART_POINTS = 400

export function downsample<T>(rows: T[], maxPoints = MAX_CHART_POINTS): T[] {
  if (rows.length <= maxPoints) return rows
  const step = Math.ceil(rows.length / maxPoints)
  return rows.filter((_, index) => index % step === 0 || index === rows.length - 1)
}

export const PRICE_PANEL_KEYS = [
  'value',
  'sma_fast',
  'sma_slow',
  'ema_fast',
  'ema_slow',
  'bollinger_upper',
  'bollinger_middle',
  'bollinger_lower',
  'donchian_upper',
  'donchian_mid',
  'donchian_lower',
] as const

export function priceDomain(
  rows: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<string> = PRICE_PANEL_KEYS,
  padFraction = 0.08,
): [number, number] {
  let min = Infinity
  let max = -Infinity

  for (const row of rows) {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }

  if (min === Infinity || max === -Infinity) return [0, 1]

  const padding = (max - min) * padFraction || 1
  return [min - padding, max + padding]
}
