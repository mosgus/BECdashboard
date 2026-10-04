import { describe, expect, it } from 'vitest'
import type { CalibrationResponse, MonteCarloRequest } from '../api/client'
import { calibrationRequest, calibrationRows } from './calibration'

const response: CalibrationResponse = {
  tickers: ['A'],
  model: 'normal',
  lookback_days: 730,
  num_simulations: 1000,
  warnings: [],
  horizons: [
    {
      horizon_days: 21,
      windows: 60,
      first_origin: '2021-03-01',
      last_origin: '2026-08-31',
      inside_90: 0.75,
      inside_50: 0.4333,
      below_90: 8,
      above_90: 7,
      range_90: [0.8167, 0.9667],
      range_50: [0.3667, 0.6333],
      verdict_90: 'too_narrow',
      verdict_50: 'consistent',
    },
    {
      horizon_days: 63,
      windows: 5,
      first_origin: '2025-08-01',
      last_origin: '2026-08-31',
      inside_90: 0.8,
      inside_50: 0.4,
      below_90: 1,
      above_90: 0,
      range_90: [0.4, 1],
      range_50: [0, 1],
      verdict_90: 'too_few',
      verdict_50: 'too_few',
    },
  ],
}

describe('calibration', () => {
  it('formats rows and their readings', () => {
    const [first, second] = calibrationRows(response)
    expect(first).toMatchObject({
      inside90: '75% (expected 82–97%)',
      inside50: '43% (expected 37–63%)',
      misses: '8 below, 7 above',
      flagged: true,
      reading: 'Too narrow: outcomes fell outside the 90% band more often than a calibrated model allows.',
    })
    expect(second.reading).toBe('Too few windows to judge.')
  })
  it('uses each remaining reading rule', () => {
    const row = response.horizons[0]
    expect(calibrationRows({ ...response, horizons: [{ ...row, verdict_90: 'too_wide' }] })[0].reading).toContain(
      'Too wide:',
    )
    expect(
      calibrationRows({ ...response, horizons: [{ ...row, verdict_90: 'consistent', verdict_50: 'too_narrow' }] })[0]
        .reading,
    ).toContain('middle band is too narrow')
    expect(
      calibrationRows({ ...response, horizons: [{ ...row, verdict_90: 'consistent', verdict_50: 'too_wide' }] })[0]
        .reading,
    ).toContain('middle band is too wide')
    expect(
      calibrationRows({ ...response, horizons: [{ ...row, verdict_90: 'consistent', verdict_50: 'consistent' }] })[0]
        .reading,
    ).toBe('Consistent with calibrated bands.')
  })
  it('formats zero windows', () => {
    const row = calibrationRows({
      ...response,
      horizons: [
        {
          ...response.horizons[0],
          windows: 0,
          first_origin: null,
          last_origin: null,
          inside_90: null,
          inside_50: null,
          range_90: null,
          range_50: null,
        },
      ],
    })[0]
    expect(row.windows).toBe('0')
    expect(row.inside90).toBe('—')
    expect(row.inside50).toBe('—')
  })
  it('drops Monte Carlo-only fields', () => {
    const request: MonteCarloRequest = {
      tickers: ['A'],
      weights: [1],
      cash: 0,
      lookback_days: 730,
      model: 'normal',
      horizon_days: 21,
      num_simulations: 1000,
      initial_value: 1,
    }
    expect(calibrationRequest(request)).toEqual({
      tickers: ['A'],
      weights: [1],
      cash: 0,
      lookback_days: 730,
      model: 'normal',
    })
  })
})
