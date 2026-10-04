import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { forecastPortfolio, getUniverse } from '../../../api/client'
import type { ForecastRequest, ForecastResponse } from '../../../api/client'
import { DownloadIcon } from '../../../components/DownloadIcon'
import { ExpandableChart } from '../../../components/ExpandableChart'
import { HelpButton } from '../../../components/GuidePanel'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { Tooltip } from '../../../components/Tooltip'
import { formatReturn } from '../../../lib/capm'
import { downloadTextFile } from '../../../lib/download'
import {
  DEFAULT_FORECAST_SETTINGS,
  FORECAST_MODELS,
  forecastCsv,
  forecastCsvFilename,
  forecastSummary,
  lossChanceText,
  memberMedianRows,
  paramRows,
  valueChartData,
  volChartData,
  volatilitySummary,
} from '../../../lib/forecast'
import type { ForecastSettings } from '../../../lib/forecast'
import {
  buildMonteCarloRequest,
  defaultStartingValue,
  HORIZON_OPTIONS,
  MONTE_CARLO_LOOKBACK_FLOOR,
  sameMonteCarloRequest,
  terminalRows,
} from '../../../lib/monteCarlo'
import { formatMoney, tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { ForecastGuide } from './ForecastGuide'
import CalibrationPanel from './CalibrationPanel'

const ForecastChart = lazy(() => import('../../../components/ForecastChart'))
const VolatilityChart = lazy(() => import('../../../components/VolatilityChart'))
const TH =
  'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: ForecastResponse; request: ForecastRequest }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

export function ForecastSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [settings, setSettings] = useState<ForecastSettings>(DEFAULT_FORECAST_SETTINGS)
  const [startingText, setStartingText] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [guideOpen, setGuideOpen] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void getUniverse()
      .then((entries) => {
        if (!cancelled)
          setUniverse({ status: 'ready', lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])) })
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: 'ready', lastClose: new Map() })
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (portfolio === null) return null
  const current = portfolio
  const liveBasis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(current, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const currentStartingText = startingText ?? defaultStartingValue(current, liveBasis)
  const built = buildMonteCarloRequest(current, settings, currentStartingText, liveBasis)
  function submit(): void {
    if (universe.status !== 'ready') return
    const request = buildMonteCarloRequest(
      current,
      settings,
      currentStartingText,
      tradeBasis(current, universe.lastClose),
    )
    if (!request.ok) {
      setRun({ status: 'error', message: request.message })
      return
    }
    setRun({ status: 'running' })
    void forecastPortfolio(request.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: request.request })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({ status: 'error', message: error instanceof Error ? error.message : 'The forecast request failed.' })
      })
  }
  const runTooltip =
    run.status === 'running'
      ? 'Forecasting…'
      : universe.status === 'loading'
        ? 'Loading prices…'
        : portfolio.positions.length === 0
          ? 'Add a holding to this portfolio to forecast it'
          : 'Forecast this portfolio with these settings'
  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-sm font-semibold">Forecast settings</h2>
          <HelpButton
            tooltip="What the forecast models do and how each setting works"
            onClick={() => setGuideOpen(true)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(13rem,1.6fr)_repeat(4,minmax(8rem,1fr))]">
          <LookbackPicker
            floor={MONTE_CARLO_LOOKBACK_FLOOR}
            lookbackDays={settings.lookbackDays}
            onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
            customTooltip="Fit the model to daily returns since a start date you choose, at least 3 months ago"
            optionTooltip={(option) =>
              `Fit the model to the last ${option.days / 365} ${option.days === 365 ? 'year' : 'years'} of daily returns`
            }
          />
          <div>
            <label htmlFor="forecast-model" className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              Model
            </label>
            <Tooltip block label={FORECAST_MODELS.find((model) => model.value === settings.model)?.tooltip ?? ''}>
              <select
                id="forecast-model"
                value={settings.model}
                onChange={(event) =>
                  setSettings({ ...settings, model: event.target.value as ForecastSettings['model'] })
                }
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              >
                {FORECAST_MODELS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Horizon</label>
            <div className="grid grid-cols-4 gap-1">
              {HORIZON_OPTIONS.map((option) => (
                <Tooltip key={option.days} block label={`Forecast ${option.label} ahead (${option.days} trading days)`}>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, horizonDays: option.days })}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-[var(--radius-btn)] ${settings.horizonDays === option.days ? 'bg-btn-action text-btn-action-text' : 'border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
                  >
                    {option.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          <Field
            label="Simulations"
            tip="How many paths to simulate, from 100 to 10,000. More paths give smoother percentiles."
          >
            <input
              inputMode="numeric"
              value={settings.simulationsText}
              onChange={(event) => setSettings({ ...settings, simulationsText: event.target.value })}
              className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            />
          </Field>
          <div>
            <Field
              label="Starting value ($)"
              tip="Portfolio value on day 0. Defaults to the holdings at their last close plus cash."
            >
              <input
                inputMode="decimal"
                value={currentStartingText}
                onChange={(event) => setStartingText(event.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              />
            </Field>
            {liveBasis.kind === 'weights' && (
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                These holdings have no share counts or prices, so this is a hypothetical starting value.
              </p>
            )}
          </div>
        </div>
        <Tooltip block label={runTooltip}>
          <button
            type="button"
            onClick={submit}
            disabled={run.status === 'running' || universe.status === 'loading' || portfolio.positions.length === 0}
            className="inline-flex mt-4 px-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
          >
            {run.status === 'running' ? 'Forecasting…' : 'Run forecast'}
          </button>
        </Tooltip>
        {run.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{run.message}</p>}
      </div>
      {run.status === 'ready' && (
        <>
          <Results
            response={run.response}
            changed={!built.ok || !sameMonteCarloRequest(built.request, run.request)}
            portfolioName={portfolio.name}
          />
          <CalibrationPanel key={JSON.stringify(run.request)} request={run.request} />
        </>
      )}
      {guideOpen && <ForecastGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

function Field({ label, tip, children }: { label: string; tip: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</label>
      <Tooltip block label={tip}>
        {children}
      </Tooltip>
    </div>
  )
}
function Card({ children }: { children: ReactNode }): JSX.Element {
  return <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">{children}</div>
}
function Results({
  response,
  changed,
  portfolioName,
}: {
  response: ForecastResponse
  changed: boolean
  portfolioName: string
}): JSX.Element {
  const members = memberMedianRows(response)
  const params = paramRows(response)
  return (
    <div className="space-y-5">
      <Card>
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-muted)]">{forecastSummary(response)}</p>
          {changed && (
            <p className="text-sm text-[var(--color-muted)]">
              Settings have changed since this run. Run it again to update the results.
            </p>
          )}
          {response.warnings.map((warning) => (
            <p key={warning} className="text-sm text-[var(--color-muted)]">
              {warning}
            </p>
          ))}
          <p className="text-sm">{volatilitySummary(response)}</p>
          <p className="text-sm">{lossChanceText(response)}</p>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Grey is the portfolio’s value over the same length of past, scaled to end at the starting value. The dark
            band holds the middle half of the paths, the light band 90%, and the line is the median. A model forecast,
            not a prediction.
          </p>
          <Suspense
            fallback={
              <div className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">
                Loading chart…
              </div>
            }
          >
            <ExpandableChart title="Forecast portfolio value">
              {(expanded) => (
                <ForecastChart
                  data={valueChartData(response)}
                  initialValue={response.initial_value}
                  size={expanded ? 'expanded' : 'inline'}
                />
              )}
            </ExpandableChart>
          </Suspense>
        </Card>
        <Card>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            {response.vol_forecast.length === 0
              ? 'Grey is the realised volatility over each past 21 trading days. Prophet does not forecast volatility, so there is no forecast line.'
              : 'Grey is the realised volatility over each past 21 trading days. The line after day 0 is the model’s forecast, annualized. The dashed line is the lookback average.'}
          </p>
          <Suspense
            fallback={
              <div className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">
                Loading chart…
              </div>
            }
          >
            <ExpandableChart title="Forecast volatility">
              {(expanded) => (
                <VolatilityChart
                  data={volChartData(response)}
                  lookbackVol={response.lookback_vol}
                  size={expanded ? 'expanded' : 'inline'}
                />
              )}
            </ExpandableChart>
          </Suspense>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold">Terminal values</h2>
            <Tooltip label="Download the percentile paths and forecast volatility as a CSV">
              <button
                type="button"
                onClick={() =>
                  downloadTextFile(
                    forecastCsvFilename(portfolioName, new Date()),
                    forecastCsv(response),
                    'text/csv;charset=utf-8',
                  )
                }
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border hover:bg-brand-border"
              >
                <DownloadIcon />
                Export CSV
              </button>
            </Tooltip>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Outcome</th>
                  <th className={`${TH} text-right`}>Ending value</th>
                  <th className={`${TH} text-right`}>Change</th>
                </tr>
              </thead>
              <tbody>
                {terminalRows(response).map((row) => (
                  <tr key={row.label}>
                    <td className={TD}>{row.label}</td>
                    <td className={NUMERIC}>{formatMoney(row.value)}</td>
                    <td className={NUMERIC}>{formatReturn(row.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        {params.length > 0 && (
          <Card>
            <h2 className="text-sm font-semibold">Fitted parameters</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Parameter</th>
                    <th className={`${TH} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((row) => (
                    <tr key={row.label}>
                      <td className={TD}>{row.label}</td>
                      <td className={NUMERIC}>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
      {members.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold">Ensemble members</h2>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Each member’s own median. The ensemble’s bands pool all members’ paths.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Member</th>
                  <th className={`${TH} text-right`}>Median ending value</th>
                  <th className={`${TH} text-right`}>Change</th>
                </tr>
              </thead>
              <tbody>
                {members.map((row) => (
                  <tr key={row.label}>
                    <td className={TD}>{row.label}</td>
                    <td className={NUMERIC}>{formatMoney(row.value)}</td>
                    <td className={NUMERIC}>{formatReturn(row.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
