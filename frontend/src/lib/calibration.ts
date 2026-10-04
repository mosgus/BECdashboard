import type { CalibrationRequest, CalibrationResponse, MonteCarloRequest } from '../api/client'

export function calibrationRequest(request: MonteCarloRequest): CalibrationRequest {
  const { tickers, weights, cash, lookback_days, model } = request
  return { tickers, weights, cash, lookback_days, model }
}

export function calibrationRows(response: CalibrationResponse) {
  return response.horizons.map((item) => {
    const horizon =
      item.horizon_days === 21
        ? '1 month (21 trading days)'
        : item.horizon_days === 63
          ? '3 months (63 trading days)'
          : `${item.horizon_days} trading days`
    const coverage = (share: number | null, range: number[] | null) =>
      share === null || range === null
        ? '—'
        : `${Math.round(share * 100)}% (expected ${Math.round(range[0] * 100)}–${Math.round(range[1] * 100)}%)`
    let reading = 'Consistent with calibrated bands.'
    if (item.verdict_90 === 'too_few' || item.verdict_50 === 'too_few') reading = 'Too few windows to judge.'
    else if (item.verdict_90 === 'too_narrow')
      reading = 'Too narrow: outcomes fell outside the 90% band more often than a calibrated model allows.'
    else if (item.verdict_90 === 'too_wide')
      reading = 'Too wide: outcomes stayed inside the 90% band more often than a calibrated model would.'
    else if (item.verdict_50 === 'too_narrow') reading = 'The 90% band holds up, but the middle band is too narrow.'
    else if (item.verdict_50 === 'too_wide') reading = 'The 90% band holds up, but the middle band is too wide.'
    return {
      horizon,
      windows: item.windows === 0 ? '0' : `${item.windows} (${item.first_origin} to ${item.last_origin})`,
      inside90: coverage(item.inside_90, item.range_90),
      inside50: coverage(item.inside_50, item.range_50),
      misses: `${item.below_90} below, ${item.above_90} above`,
      reading,
      flagged:
        item.verdict_90 === 'too_narrow' ||
        item.verdict_90 === 'too_wide' ||
        item.verdict_50 === 'too_narrow' ||
        item.verdict_50 === 'too_wide',
    }
  })
}

export const CALIBRATION_NOTE =
  'Refits this method at up to 60 past start dates per horizon, using only the prices before each one, and counts how often ' +
  'the real outcome landed inside the bands. The windows do not overlap. Only 1- and 3-month bands are checked: longer horizons ' +
  'have too few independent outcomes to test. The expected range is where a calibrated model lands 95% of the time with that many outcomes.'
