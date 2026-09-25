import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { getUniverse, optimizePortfolio } from '../../api/client'
import type { OptimizeResponse } from '../../api/client'
import { DownloadIcon } from '../../components/DownloadIcon'
import { OptimizerGuide } from '../../components/OptimizerGuide'
import { Tooltip } from '../../components/Tooltip'
import {
  DEFAULT_SETTINGS,
  LOOKBACK_OPTIONS,
  OPTIMIZE_MODES,
  REBALANCE_OPTIONS,
  buildOptimizeRequest,
  canOptimize,
  curveRows,
  formatChangePp,
  formatMoney,
  formatSignedMoney,
  formatSignedShares,
  formatWeight,
  metricItems,
  modeLabel,
  pinnedBannerLines,
  runSummary,
  sameSettings,
  scoreWindowNote,
  tradeBasis,
  tradeBasisNote,
  tradeRows,
  weightRows,
  optimizeCsv,
  optimizeCsvFilename,
} from '../../lib/optimize'
import type { OptimizeSettings, TradeBasis } from '../../lib/optimize'
import { formatPrice, formatShares } from '../../lib/format'
import { downloadTextFile } from '../../lib/download'
import { isLegacyPortfolio, listPortfolios } from '../../lib/portfolioStore'

const OptimizeChart = lazy(() => import('../../components/OptimizeChart'))

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: OptimizeResponse; settings: OptimizeSettings; basis: TradeBasis }

type PricesState =
  | { status: 'loading' }
  | { status: 'ready'; lastClose: Map<string, number | null> }

function changeColor(formatted: string): string {
  if (formatted.startsWith('+')) return 'text-brand-positive'
  if (formatted.startsWith('-')) return 'text-brand-negative'
  return 'text-[var(--color-muted)]'
}

export function OptimizePage(): JSX.Element | null {
  const { portfolioId } = useParams()
  const portfolio = listPortfolios().find((candidate) => candidate.id === portfolioId)
  const current = portfolio === undefined || isLegacyPortfolio(portfolio) ? null : portfolio

  const [settings, setSettings] = useState<OptimizeSettings>(DEFAULT_SETTINGS)
  const [guideOpen, setGuideOpen] = useState(false)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [prices, setPrices] = useState<PricesState>({ status: 'loading' })
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
        if (!cancelled) setPrices({ status: 'ready', lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])) })
      })
      .catch(() => {
        if (!cancelled) setPrices({ status: 'ready', lastClose: new Map() })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (current === null) return null

  const runnable = canOptimize(current)

  function handleRun(): void {
    if (current === null || prices.status !== 'ready') return
    setRun({ status: 'running' })
    const requestSettings = settings
    const basis = tradeBasis(current, prices.lastClose)
    void optimizePortfolio(buildOptimizeRequest(current, requestSettings, basis))
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, settings: requestSettings, basis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          const message = error instanceof Error ? error.message : 'The optimizer request failed.'
          setRun({ status: 'error', message })
        }
      })
  }

  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="text-sm font-semibold mb-4">Optimization settings</h2>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="flex flex-col">
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Mode</label>
            <Tooltip block label="Choose what the optimizer aims for. The Optimizer guide describes each mode.">
              <select
                value={settings.mode}
                onChange={(event) => setSettings({ ...settings, mode: event.target.value as OptimizeSettings['mode'] })}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              >
                {OPTIMIZE_MODES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Tooltip>
            <div className="mt-auto pt-6">
              <Tooltip block label={prices.status === 'loading' ? 'Loading the latest prices' : runnable ? 'Fit weights on stored prices and score them against your current weights' : 'Needs at least 2 holdings to optimize'}>
                <button
                  type="button"
                  onClick={handleRun}
                  disabled={!runnable || prices.status === 'loading' || run.status === 'running'}
                  className="w-full py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
                >
                  {run.status === 'running' ? 'Optimizing…' : 'Run optimizer'}
                </button>
              </Tooltip>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Lookback</label>
            <div className="grid grid-cols-4 gap-2">
              {LOOKBACK_OPTIONS.map((option) => (
                <Tooltip block key={option.days} label={`Fit the weights on the last ${option.days / 365} ${option.days / 365 === 1 ? 'year' : 'years'} of daily prices`}>
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, lookbackDays: option.days })}
                    className={`w-full py-2 text-xs font-medium rounded-[var(--radius-btn)] ${
                      settings.lookbackDays === option.days
                        ? 'bg-btn-action text-btn-action-text'
                        : 'border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                {settings.allowShort ? `Max abs. weight: ${settings.maxWeightPct}%` : `Max weight: ${settings.maxWeightPct}%`}
              </label>
              <Tooltip dismissOnPointerDown block label={settings.allowShort ? "Cap on any one holding's absolute weight, long or short" : "Cap on any one holding's share of the invested holdings"}>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={settings.maxWeightPct}
                  onChange={(event) => setSettings({ ...settings, maxWeightPct: Number(event.target.value) })}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Tooltip>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                Min weight: {settings.minWeightPct}%
              </label>
              <Tooltip dismissOnPointerDown block label={settings.allowShort ? 'Not used while short positions are allowed' : "Floor on every holding's weight. Min weight × number of holdings must stay at or below 100%."}>
                <input
                  type="range"
                  min={0}
                  max={20}
                  step={1}
                  disabled={settings.allowShort}
                  value={settings.minWeightPct}
                  onChange={(event) => setSettings({ ...settings, minWeightPct: Number(event.target.value) })}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Tooltip>
            </div>

            {settings.mode === 'target_volatility' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Vol target: {settings.volTargetPct}%
                </label>
                <Tooltip block label="The optimizer finds the highest-return mix whose annual volatility stays at or below this">
                  <input
                    type="range"
                    min={5}
                    max={50}
                    step={1}
                    value={settings.volTargetPct}
                    onChange={(event) => setSettings({ ...settings, volTargetPct: Number(event.target.value) })}
                    className="w-full accent-[var(--color-primary)]"
                  />
                </Tooltip>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Rebalance</label>
              <Tooltip block label="How the curves hold the weights: bought and held from the start, or reset to them on this schedule. It doesn't change which weights are picked.">
                <select
                  value={settings.rebalance}
                  onChange={(event) => setSettings({ ...settings, rebalance: event.target.value as OptimizeSettings['rebalance'] })}
                  className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
                >
                  {REBALANCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Tooltip>
            </div>

            <Tooltip block label="Let weights go negative. Equal Weight, Risk Parity and Max Diversification stay long-only.">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.allowShort}
                  onChange={(event) => setSettings({ ...settings, allowShort: event.target.checked })}
                  className="accent-[var(--color-primary)]"
                />
                Allow short positions
              </label>
            </Tooltip>
          </div>
        </div>

        {run.status === 'error' && (
          <p className="mt-3 text-sm text-brand-negative">{run.message}</p>
        )}
        <div className="flex justify-end mt-4">
          <Tooltip label="Open a short description of each optimization mode">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-btn-selected-text hover:underline"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={2}>
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              Optimizer guide →
            </button>
          </Tooltip>
        </div>
      </div>

      {run.status === 'ready' && (
        <OptimizeResults response={run.response} settings={run.settings} liveSettings={settings} portfolio={current} basis={run.basis} />
      )}

      {guideOpen && <OptimizerGuide onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

function OptimizeResults({
  response,
  settings,
  liveSettings,
  portfolio,
  basis,
}: {
  response: OptimizeResponse
  settings: OptimizeSettings
  liveSettings: OptimizeSettings
  portfolio: { cashWeight: number; name: string }
  basis: TradeBasis
}): JSX.Element {
  const rows = weightRows(response)
  const dollarRows = basis.kind === 'dollar' ? tradeRows(response, basis) : null
  const note = scoreWindowNote(response)

  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-2">
        <p className="text-sm text-[var(--color-muted)]">{runSummary(response)}</p>

        {!sameSettings(liveSettings, settings) && (
          <p className="text-sm text-[var(--color-muted)]">
            Settings have changed since this run. Run it again to update the results.
          </p>
        )}

        {!response.feasible && (
          <div className="bg-brand-negative/10 text-brand-negative rounded-[var(--radius-btn)] p-3 text-sm">
            The optimizer did not converge, so the results below use your current weights.
          </div>
        )}

        {response.pinned.length > 0 && (
          <div className="bg-brand-accent/10 rounded-[var(--radius-btn)] p-3">
            <p className="text-sm font-semibold">Held at current weight: not enough price history</p>
            {pinnedBannerLines(response.pinned, settings.maxWeightPct).map((line) => (
              <p key={line} className="text-sm mt-1">{line}</p>
            ))}
          </div>
        )}

        {response.warnings.map((warning) => (
          <p key={warning} className="text-sm text-[var(--color-muted)]">{warning}</p>
        ))}

        <p className="text-sm text-[var(--color-muted)]">
          Weights are constant-mix: chosen as if held at these proportions every day. Invested holdings only.
          {portfolio.cashWeight > 0 && ` Cash (${portfolio.cashWeight.toFixed(1)}%) is left out and stays as it is.`}
        </p>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold">Weights</h3>
          <Tooltip label="Download this table as a CSV">
            <button
              type="button"
              onClick={() => downloadTextFile(optimizeCsvFilename(portfolio.name, response.mode, new Date()), optimizeCsv(response, basis), 'text/csv;charset=utf-8')}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
            >
              <DownloadIcon />
              <span>Export CSV</span>
            </button>
          </Tooltip>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {dollarRows === null ? (
              <>
                <thead><tr><th className={TH}>Ticker</th><th className={`${TH} text-right`}>Current</th><th className={`${TH} text-right`}>Optimized</th><th className={`${TH} text-right`}>Change</th></tr></thead>
                <tbody>{rows.map((row) => {
                  const changeText = formatChangePp(row.change)
                  return <tr key={row.ticker}><TickerCell row={row} /><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.current)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.target)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td></tr>
                })}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th className={TH}>Ticker</th><th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Current shares</th><th className={`${TH} text-right`}>Current value</th><th className={`${TH} text-right`}>Current</th><th className={`${TH} text-right`}>Optimized shares</th><th className={`${TH} text-right`}>Optimized value</th><th className={`${TH} text-right`}>Optimized</th><th className={`${TH} text-right`}>Trade shares</th><th className={`${TH} text-right`}>Trade $</th><th className={`${TH} text-right`}>Change</th></tr></thead>
                <tbody>{dollarRows.map((row) => {
                  const changeText = formatChangePp(row.change)
                  const tradeSharesText = formatSignedShares(row.tradeShares)
                  const tradeMoneyText = formatSignedMoney(row.tradeValue)
                  return <tr key={row.ticker}><TickerCell row={row} /><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatPrice(row.price)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatShares(row.currentShares)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(row.currentValue)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.current)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatShares(row.targetShares)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(row.targetValue)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.target)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(tradeSharesText)}`}>{tradeSharesText}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(tradeMoneyText)}`}>{tradeMoneyText}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td></tr>
                })}</tbody>
              </>
            )}
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">{tradeBasisNote(basis)}</p>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h3 className="text-sm font-semibold mb-3">In-sample backtest: not a forecast</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Current</p>
            <MetricTiles items={metricItems(response.metrics.current)} />
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Optimized ({modeLabel(response.mode)})</p>
            <MetricTiles items={metricItems(response.metrics.optimized)} />
          </div>
        </div>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h3 className="text-sm font-semibold mb-1">Return: Current vs Optimized</h3>
        <p className="text-xs text-[var(--color-muted)]">
          Change since {response.score_start}. In-sample, invested holdings only. Not a forecast.
        </p>
        {note !== null && <p className="text-xs text-[var(--color-muted)] mt-1">{note}</p>}
        <p className="text-xs text-[var(--color-muted)] mt-1">
          The Current curve starts from today's weights on that date, so it will not match the Holdings chart, which
          is anchored at today.
        </p>
        <div className="mt-3">
          <Suspense fallback={<p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
            <OptimizeChart rows={curveRows(response.curves)} hasBenchmark={response.curves.benchmark !== null} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function TickerCell({ row }: { row: { ticker: string; pinned: boolean } }): JSX.Element {
  return (
    <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>
      {row.ticker}
      {row.pinned && <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">pinned</span>}
    </td>
  )
}

function MetricTiles({ items }: { items: ReturnType<typeof metricItems> }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-center">
          <p className="text-xs text-[var(--color-muted)]">
            <Tooltip label={item.tooltip}>
              <span>{item.label}</span>
            </Tooltip>
          </p>
          <p className="mt-0.5 text-base font-bold">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
