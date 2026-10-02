import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { getUniverse, monteCarloPortfolio } from '../../../api/client'
import type { MonteCarloRequest, MonteCarloResponse } from '../../../api/client'
import { DownloadIcon } from '../../../components/DownloadIcon'
import { ExpandableChart } from '../../../components/ExpandableChart'
import { HelpButton } from '../../../components/GuidePanel'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { Tooltip } from '../../../components/Tooltip'
import { downloadTextFile } from '../../../lib/download'
import { formatReturn } from '../../../lib/capm'
import {
  DEFAULT_MONTE_CARLO_SETTINGS,
  defaultStartingValue,
  buildMonteCarloRequest,
  fanChartData,
  HORIZON_OPTIONS,
  MONTE_CARLO_LOOKBACK_FLOOR,
  monteCarloCsv,
  monteCarloCsvFilename,
  monteCarloSummary,
  sameMonteCarloRequest,
  terminalRows,
} from '../../../lib/monteCarlo'
import type { MonteCarloSettings } from '../../../lib/monteCarlo'
import { formatMoney, tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { MonteCarloGuide } from './MonteCarloGuide'

const MonteCarloChart = lazy(() => import('../../../components/MonteCarloChart'))
const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: MonteCarloResponse; request: MonteCarloRequest }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

export function MonteCarloSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [settings, setSettings] = useState<MonteCarloSettings>(DEFAULT_MONTE_CARLO_SETTINGS)
  const [startingText, setStartingText] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [guideOpen, setGuideOpen] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useEffect(() => {
    let cancelled = false
    void getUniverse()
      .then((entries) => {
        if (!cancelled) setUniverse({ status: 'ready', lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])) })
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: 'ready', lastClose: new Map() })
      })
    return () => { cancelled = true }
  }, [])
  if (portfolio === null) return null
  const current = portfolio
  const liveBasis: TradeBasis = universe.status === 'ready'
    ? tradeBasis(current, universe.lastClose)
    : { kind: 'weights', reason: 'no-shares' }
  const currentStartingText = startingText ?? defaultStartingValue(current, liveBasis)
  const built = buildMonteCarloRequest(current, settings, currentStartingText, liveBasis)

  function submit(): void {
    if (universe.status !== 'ready') return
    const request = buildMonteCarloRequest(current, settings, currentStartingText, tradeBasis(current, universe.lastClose))
    if (!request.ok) {
      setRun({ status: 'error', message: request.message })
      return
    }
    setRun({ status: 'running' })
    void monteCarloPortfolio(request.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: request.request })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) setRun({ status: 'error', message: error instanceof Error ? error.message : 'The Monte Carlo request failed.' })
      })
  }

  const runTooltip = run.status === 'running'
    ? 'Simulating…'
    : universe.status === 'loading'
      ? 'Loading prices…'
      : portfolio.positions.length === 0
        ? 'Add a holding to this portfolio to simulate it'
        : 'Simulate this portfolio with these settings'
  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-sm font-semibold">Monte Carlo settings</h2>
          <HelpButton tooltip="What the Monte Carlo simulation does and how each setting works" onClick={() => setGuideOpen(true)} />
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <LookbackPicker
            floor={MONTE_CARLO_LOOKBACK_FLOOR}
            lookbackDays={settings.lookbackDays}
            onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
            customTooltip="Simulate from daily returns since a start date you choose, at least 3 months ago"
            optionTooltip={(option) => `Draw simulated days from the last ${option.days / 365} ${option.days === 365 ? 'year' : 'years'} of daily returns`}
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Model</label>
            <div className="grid grid-cols-2 gap-1">
              {(['bootstrap', 'normal'] as const).map((model) => (
                <Tooltip key={model} block label={model === 'bootstrap'
                  ? 'Replay randomly chosen real days from the lookback. Keeps fat tails and big moves.'
                  : "Draw daily returns from a bell curve with the lookback's mean and volatility. Thinner tails."}>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, model })}
                    className={`w-full px-3 py-2 text-xs font-medium rounded-[var(--radius-btn)] ${settings.model === model ? 'bg-btn-action text-btn-action-text' : 'border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
                  >
                    {model === 'bootstrap' ? 'Bootstrap' : 'Normal'}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Horizon</label>
            <div className="grid grid-cols-4 gap-1">
              {HORIZON_OPTIONS.map((option) => (
                <Tooltip key={option.days} block label={`Simulate ${option.label} ahead (${option.days} trading days)`}>
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
          <Field label="Simulations" tip="How many paths to simulate, from 100 to 10,000. More paths give smoother percentiles.">
            <input inputMode="numeric" value={settings.simulationsText} onChange={(event) => setSettings({ ...settings, simulationsText: event.target.value })} className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground" />
          </Field>
        </div>
        <div className="mt-4 max-w-xs">
          <Field label="Starting value ($)" tip="Portfolio value on day 0. Defaults to the holdings at their last close plus cash.">
            <input inputMode="decimal" value={currentStartingText} onChange={(event) => setStartingText(event.target.value)} className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground" />
          </Field>
          {liveBasis.kind === 'weights' && <p className="mt-1 text-xs text-[var(--color-muted)]">These holdings have no share counts or prices, so this is a hypothetical starting value.</p>}
        </div>
        <Tooltip block label={runTooltip}>
          <button type="button" onClick={submit} disabled={run.status === 'running' || universe.status === 'loading' || portfolio.positions.length === 0} className="w-full mt-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50">
            {run.status === 'running' ? 'Simulating…' : 'Run simulation'}
          </button>
        </Tooltip>
        {run.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{run.message}</p>}
      </div>
      {run.status === 'ready' && <Results response={run.response} changed={!built.ok || !sameMonteCarloRequest(built.request, run.request)} portfolioName={portfolio.name} />}
      {guideOpen && <MonteCarloGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

function Field({ label, tip, children }: { label: string; tip: string; children: ReactNode }): JSX.Element {
  return <div><label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</label><Tooltip block label={tip}>{children}</Tooltip></div>
}

function Results({ response, changed, portfolioName }: { response: MonteCarloResponse; changed: boolean; portfolioName: string }): JSX.Element {
  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-3">
        <p className="text-sm text-[var(--color-muted)]">{monteCarloSummary(response)}</p>
        {changed && <p className="text-sm text-[var(--color-muted)]">Settings have changed since this run. Run it again to update the results.</p>}
        {response.warnings.map((warning) => <p key={warning} className="text-sm text-[var(--color-muted)]">{warning}</p>)}
        <p className="text-sm">Chance of ending below the starting value: {(response.terminal.prob_loss * 100).toFixed(1)}%</p>
      </div>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <p className="text-xs text-[var(--color-muted)] mb-3">The dark band holds the middle half of the simulated paths, the light band 90% of them, and the line is the median. The dashed line is the starting value. Simulations of past behavior, not a forecast.</p>
        <Suspense fallback={<div className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</div>}>
          <ExpandableChart title="Simulated portfolio value">
            {(expanded) => <MonteCarloChart data={fanChartData(response)} initialValue={response.initial_value} size={expanded ? 'expanded' : 'inline'} />}
          </ExpandableChart>
        </Suspense>
      </div>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold">Terminal values</h2>
          <Tooltip label="Download the percentile paths as a CSV">
            <button
              type="button"
              onClick={() => downloadTextFile(monteCarloCsvFilename(portfolioName, new Date()), monteCarloCsv(response), 'text/csv;charset=utf-8')}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border hover:bg-brand-border"
            >
              <DownloadIcon />Export CSV
            </button>
          </Tooltip>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr><th className={TH}>Outcome</th><th className={`${TH} text-right`}>Ending value</th><th className={`${TH} text-right`}>Change</th></tr>
            </thead>
            <tbody>
              {terminalRows(response).map((row) => <tr key={row.label}><td className={TD}>{row.label}</td><td className={NUMERIC}>{formatMoney(row.value)}</td><td className={NUMERIC}>{formatReturn(row.change)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
