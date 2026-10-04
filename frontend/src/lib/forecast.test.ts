import { describe, expect, it } from 'vitest'
import type { ForecastResponse } from '../api/client'
import {
  forecastCsv,
  forecastCsvFilename,
  forecastSummary,
  FORECAST_MODELS,
  formatVol,
  lossChanceText,
  memberMedianRows,
  paramRows,
  valueChartData,
  volChartData,
  volatilitySummary,
} from './forecast'

const RESPONSE: ForecastResponse = {
  tickers: ['AAA'],
  weights: { AAA: 1 },
  cash_weight: 0,
  model: 'ensemble',
  seed: 42,
  horizon_days: 2,
  num_simulations: 1000,
  initial_value: 1000,
  lookback_days: 1825,
  fit_start: '2021-10-02',
  fit_end: '2026-10-02',
  n_returns: 300,
  daily_drift: 0.0004,
  current_vol: 0.25,
  lookback_vol: 0.16118,
  params: { 'ewma.lambda': 0.94, 'garch.alpha': 0.0919491, 'garch.half_life_days': 24.372, 'arima.phi': 0.0036814 },
  members: ['ewma', 'garch', 'arima'],
  member_medians: { ewma: 1010, garch: 1000, arima: 1005 },
  paths: [
    { day: 0, p5: 900, p25: 950, p50: 1000, p75: 1050, p95: 1100 },
    { day: 1, p5: 890, p25: 945, p50: 1005, p75: 1060, p95: 1120 },
    { day: 2, p5: 880, p25: 940, p50: 1010, p75: 1070, p95: 1140 },
  ],
  terminal: {
    mean: 1015,
    median: 1010,
    p5: 880,
    p25: 940,
    p75: 1070,
    p95: 1140,
    prob_loss: 0.4,
    mean_return: 0.015,
    median_return: 0.01,
  },
  vol_forecast: [
    { day: 0, vol: 0.25 },
    { day: 1, vol: 0.25 },
    { day: 2, vol: 0.24 },
  ],
  vol_history: [
    { date: '2026-09-29', day: -3, vol: 0.2 },
    { date: '2026-09-30', day: -2, vol: 0.21 },
    { date: '2026-10-01', day: -1, vol: 0.22 },
    { date: '2026-10-02', day: 0, vol: 0.23 },
  ],
  history: [
    { date: '2026-09-28', day: -4, value: 900 },
    { date: '2026-09-30', day: -2, value: 950 },
    { date: '2026-10-02', day: 0, value: 1000 },
  ],
  warnings: [],
}

describe('forecast helpers', () => {
  it('formats volatility', () => expect(formatVol(0.16118)).toBe('16.1%'))
  it('summarizes volatility', () => {
    expect(volatilitySummary(RESPONSE)).toBe(
      'Forecast volatility today: 25.0% a year, against 16.1% over the lookback. GARCH expects volatility to close half the gap in about 24 trading days.',
    )
    expect(volatilitySummary({ ...RESPONSE, params: {} })).toBe(
      'Forecast volatility today: 25.0% a year, against 16.1% over the lookback.',
    )
    expect(volatilitySummary({ ...RESPONSE, current_vol: 0 })).toBe(
      'These returns have no variation, so every path is the same.',
    )
    expect(volatilitySummary({ ...RESPONSE, current_vol: null })).toBe(
      'Prophet does not forecast volatility. Its bands come from how uncertain the trend is, so they widen with the horizon.',
    )
  })
  it('formats the estimated chance of loss for non-Prophet models', () =>
    expect(lossChanceText({ ...RESPONSE, terminal: { ...RESPONSE.terminal, prob_loss: 0.123 } })).toBe(
      'Chance of ending below the starting value: 12.3%',
    ))
  it('withholds the chance of loss for Prophet', () => {
    const text = lossChanceText({ ...RESPONSE, model: 'prophet', terminal: { ...RESPONSE.terminal, prob_loss: 0.123 } })
    expect(text).toBe(
      'Chance of ending below the starting value: not estimated for Prophet. Its bands only reflect how uncertain the trend is, and they have not been checked against real outcomes.',
    )
    expect(text).not.toContain('%')
  })
  it('builds value chart data', () => {
    const data = valueChartData(RESPONSE)
    expect(data.map((point) => point.day)).toEqual([-2, 0, 1, 2])
    expect(data[0]).toEqual({ day: -2, history: 950 })
    expect(data[1]).toMatchObject({ day: 0, history: 1000, outer: [900, 1100], inner: [950, 1050], median: 1000 })
  })
  it('builds volatility chart data', () => {
    const data = volChartData(RESPONSE)
    expect(data.map((point) => point.day)).toEqual([-2, -1, 0, 1, 2])
    expect(data[2]).toEqual({ day: 0, realised: 0.23, forecast: 0.25 })
    expect(data[0]).not.toHaveProperty('forecast')
  })
  it('lists ensemble member medians', () => {
    expect(memberMedianRows(RESPONSE).map((row) => row.label)).toEqual(['EWMA', 'GARCH', 'ARIMA'])
    expect(memberMedianRows(RESPONSE)[0].change).toBeCloseTo(0.01)
    expect(memberMedianRows({ ...RESPONSE, members: ['garch'] })).toEqual([])
  })
  it('formats parameters', () =>
    expect(paramRows(RESPONSE)).toEqual([
      { label: 'EWMA Decay (λ)', value: '0.94' },
      { label: 'GARCH α (reaction)', value: '0.09195' },
      { label: 'GARCH Half-life', value: '24.4 days' },
      { label: 'ARIMA φ (autocorrelation)', value: '0.003681' },
    ]))
  it('formats Prophet fitted trend gap', () =>
    expect(paramRows({ ...RESPONSE, params: { end_gap: 0.0096 } })).toEqual([
      { label: 'Fitted trend vs last close', value: '+0.96%' },
    ]))
  it('exports forecast CSV', () => {
    const rows = forecastCsv(RESPONSE).split('\n')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toBe('day,p5,p25,p50,p75,p95,vol')
    expect(rows[3].endsWith(',0.24')).toBe(true)
    expect(
      forecastCsv({ ...RESPONSE, vol_forecast: [] })
        .split('\n')
        .slice(1)
        .every((row) => row.endsWith(',')),
    ).toBe(true)
  })
  it('builds a forecast CSV filename', () =>
    expect(forecastCsvFilename('My: Fund', new Date(2026, 9, 2))).toBe('My Fund-forecast-2026-10-02.csv'))
  it('summarizes the forecast', () => {
    expect(forecastSummary(RESPONSE).startsWith('1,000 Ensemble paths over 2 trading days from ')).toBe(true)
    expect(forecastSummary(RESPONSE)).toContain('Seed 42')
  })
  it('lists Prophet after the established models', () =>
    expect(FORECAST_MODELS.map((model) => model.value)).toEqual(['ewma', 'garch', 'arima', 'ensemble', 'prophet']))
})
