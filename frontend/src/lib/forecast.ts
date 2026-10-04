import type { ForecastResponse } from '../api/client'
import { csvNumber, formatMoney, lookbackLabel } from './optimize'
import { datePart, filenameSafeName } from './portfolioCsv'
import { fanChartData } from './monteCarlo'

export type ForecastModel = 'ewma' | 'garch' | 'arima' | 'ensemble' | 'prophet'
export const FORECAST_MODELS: ReadonlyArray<{ value: ForecastModel; label: string; tooltip: string }> = [
  {
    value: 'ewma',
    label: 'EWMA',
    tooltip: 'Volatility from recent days, weighted toward the latest. Stays at today’s level for the whole horizon.',
  },
  {
    value: 'garch',
    label: 'GARCH',
    tooltip: 'Volatility starts at today’s level and drifts back toward the lookback average.',
  },
  {
    value: 'arima',
    label: 'ARIMA',
    tooltip: 'Constant volatility at the lookback average. The baseline that ignores current conditions.',
  },
  { value: 'ensemble', label: 'Ensemble', tooltip: 'Pools paths from EWMA, GARCH and ARIMA in equal shares.' },
  {
    value: 'prophet',
    label: 'Prophet (untested)',
    tooltip:
      'Unstable and untested. Extrapolates the trend and yearly pattern of the portfolio’s value. Its bands are not based on volatility.',
  },
]
export interface ForecastSettings {
  lookbackDays: number
  model: ForecastModel
  horizonDays: number
  simulationsText: string
}
export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  lookbackDays: 1825,
  model: 'garch',
  horizonDays: 252,
  simulationsText: '1000',
}
export function formatVol(vol: number): string {
  return `${(vol * 100).toFixed(1)}%`
}
const label = (model: string): string => FORECAST_MODELS.find((item) => item.value === model)?.label ?? model
export function forecastSummary(response: ForecastResponse): string {
  const prefix = `${response.num_simulations.toLocaleString('en-US')} ${label(response.model)} paths over ${response.horizon_days} trading days from ${formatMoney(response.initial_value)}.`
  const fitted = ` Fitted ${response.fit_start} to ${response.fit_end} (${response.n_returns} daily returns, ${lookbackLabel(response.lookback_days)} lookback).`
  return `${prefix}${fitted} Seed ${response.seed}, so the same settings give the same result.`
}
export function volatilitySummary(response: ForecastResponse): string {
  if (response.current_vol === null)
    return 'Prophet does not forecast volatility. Its bands come from how uncertain the trend is, so they widen with the horizon.'
  if (response.current_vol === 0) return 'These returns have no variation, so every path is the same.'
  const halfLife = response.params.half_life_days ?? response.params['garch.half_life_days']
  return `Forecast volatility today: ${formatVol(response.current_vol)} a year, against ${formatVol(response.lookback_vol)} over the lookback.${halfLife === undefined ? '' : ` GARCH expects volatility to close half the gap in about ${Math.round(halfLife)} trading days.`}`
}
/** The results line about finishing below the starting value. Prophet's figure is withheld:
 *  its bands only reflect trend uncertainty and calibration does not cover it. */
export function lossChanceText(response: ForecastResponse): string {
  if (response.model === 'prophet')
    return 'Chance of ending below the starting value: not estimated for Prophet. Its bands only reflect how uncertain the trend is, and they have not been checked against real outcomes.'
  return `Chance of ending below the starting value: ${(response.terminal.prob_loss * 100).toFixed(1)}%`
}
export interface ValuePoint {
  day: number
  history?: number
  outer?: [number, number]
  inner?: [number, number]
  median?: number
}
export function valueChartData(response: ForecastResponse): ValuePoint[] {
  const data = new Map<number, ValuePoint>()
  for (const point of response.history)
    if (point.day >= -response.horizon_days && point.day < 0)
      data.set(point.day, { day: point.day, history: point.value })
  for (const point of fanChartData(response))
    data.set(point.day, {
      ...(data.get(point.day) ?? { day: point.day }),
      ...point,
      ...(point.day === 0 ? { history: response.initial_value } : {}),
    })
  return [...data.values()].sort((a, b) => a.day - b.day)
}
export interface VolChartPoint {
  day: number
  realised?: number
  forecast?: number
}
export function volChartData(response: ForecastResponse): VolChartPoint[] {
  const data = new Map<number, VolChartPoint>()
  for (const point of response.vol_history)
    if (point.day >= -response.horizon_days) data.set(point.day, { day: point.day, realised: point.vol })
  for (const point of response.vol_forecast)
    data.set(point.day, { ...(data.get(point.day) ?? { day: point.day }), forecast: point.vol })
  return [...data.values()].sort((a, b) => a.day - b.day)
}
export function memberMedianRows(response: ForecastResponse): Array<{ label: string; value: number; change: number }> {
  return response.members.length > 1
    ? response.members.map((member) => ({
        label: label(member),
        value: response.member_medians[member],
        change: response.member_medians[member] / response.initial_value - 1,
      }))
    : []
}
const PARAM_LABELS: Record<string, string> = {
  lambda: 'Decay (λ)',
  omega: 'ω',
  alpha: 'α (reaction)',
  beta: 'β (persistence of variance)',
  persistence: 'α + β',
  half_life_days: 'Half-life',
  c: 'Constant (c)',
  phi: 'φ (autocorrelation)',
  sigma: 'σ (daily)',
  end_gap: 'Fitted trend vs last close',
}
export function paramRows(response: ForecastResponse): Array<{ label: string; value: string }> {
  return Object.entries(response.params).map(([key, number]) => {
    const [member, base] = key.includes('.') ? key.split('.', 2) : ['', key]
    const value =
      base === 'end_gap'
        ? `${number > 0 ? '+' : ''}${(number * 100).toFixed(2)}%`
        : base === 'lambda' || base === 'persistence'
          ? number.toFixed(2)
          : base === 'half_life_days'
            ? `${number.toFixed(1)} days`
            : number.toPrecision(4)
    return { label: member ? `${label(member)} ${PARAM_LABELS[base] ?? base}` : (PARAM_LABELS[base] ?? key), value }
  })
}
export function forecastCsv(response: ForecastResponse): string {
  const vols = new Map(response.vol_forecast.map((point) => [point.day, point.vol]))
  return [
    'day,p5,p25,p50,p75,p95,vol',
    ...response.paths.map(
      (point) =>
        [point.day, point.p5, point.p25, point.p50, point.p75, point.p95]
          .map((value) => csvNumber(value, 2))
          .join(',') + (vols.has(point.day) ? `,${csvNumber(vols.get(point.day)!, 6)}` : ','),
    ),
  ].join('\n')
}
export function forecastCsvFilename(portfolioName: string, now: Date): string {
  return `${filenameSafeName(portfolioName.trim()) || 'portfolio'}-forecast-${datePart(now)}.csv`
}
