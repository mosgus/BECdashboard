import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { getUniverse, optimizePortfolio } from '../../api/client'
import type { OptimizeResponse } from '../../api/client'
import { DownloadIcon } from '../../components/DownloadIcon'
import { ExpandableChart } from '../../components/ExpandableChart'
import { OptimizerGuide } from '../../components/OptimizerGuide'
import { Tooltip } from '../../components/Tooltip'
import { LookbackPicker } from '../../components/LookbackPicker'
import {
  DEFAULT_SETTINGS,
  applyBlockedText,
  applyConfirmLines,
  applyPlan,
  cashAfterDeploy,
  cashSplit,
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
  portfolioShareRows,
  weightRows,
  optimizeCsv,
  optimizeCsvFilename,
} from '../../lib/optimize'
import type { ApplyPlan, OptimizeSettings, TradeBasis } from '../../lib/optimize'
import { formatPrice, formatShares } from '../../lib/format'
import { downloadTextFile } from '../../lib/download'
import { isLegacyPortfolio, listPortfolios, savePortfolio } from '../../lib/portfolioStore'

const OptimizeChart = lazy(() => import('../../components/OptimizeChart'))

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: OptimizeResponse; settings: OptimizeSettings; basis: TradeBasis; applied: boolean }

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
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [cashDeployPct, setCashDeployPct] = useState(0)
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

  const cashAfter = cashAfterDeploy(current.cashWeight, cashDeployPct)
  const runnable = canOptimize(current)
  const plan = run.status === 'ready'
    ? applyPlan(current, run.response, prices.status === 'ready' ? prices.lastClose : new Map(), cashAfter)
    : null

  function handleRun(): void {
    if (current === null || prices.status !== 'ready') return
    setApplyError(null)
    setRun({ status: 'running' })
    const requestSettings = settings
    const basis = tradeBasis(current, prices.lastClose)
    void optimizePortfolio(buildOptimizeRequest(current, requestSettings, basis))
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, settings: requestSettings, basis, applied: false })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          const message = error instanceof Error ? error.message : 'The optimizer request failed.'
          setRun({ status: 'error', message })
        }
      })
  }

  function handleConfirmApply(): void {
    if (current === null || run.status !== 'ready' || plan === null || !plan.ok) return
    savePortfolio(plan.portfolio)
    const saved = listPortfolios().find((candidate) => candidate.id === current.id)
    if (saved === undefined || isLegacyPortfolio(saved) || saved.updatedAt === current.updatedAt) {
      setApplyError("Couldn't save to this browser's storage. Nothing was changed.")
    } else {
      setRun({ ...run, applied: true })
      setApplyError(null)
      setCashDeployPct(0)
    }
    setApplyOpen(false)
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

          <LookbackPicker
            lookbackDays={settings.lookbackDays}
            onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
            optionTooltip={(option) => `Fit the weights on the last ${option.days / 365} ${option.days === 365 ? 'year' : 'years'} of daily prices`}
            customTooltip="Fit the weights on daily prices from a start date you choose"
          />

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                {settings.allowShort ? `Max abs. weight: ${settings.maxWeightPct}%` : `Max weight: ${settings.maxWeightPct}%`}
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={settings.maxWeightPct}
                onChange={(event) => setSettings({ ...settings, maxWeightPct: Number(event.target.value) })}
                className="w-full accent-[var(--color-primary)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                Min weight: {settings.minWeightPct}%
              </label>
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
            </div>

            {settings.mode === 'target_volatility' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                  Vol target: {settings.volTargetPct}%
                </label>
                <Tooltip dismissOnPointerDown block label="The optimizer finds the highest-return mix whose annual volatility stays at or below this">
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

            <Tooltip block label="Let weights go negative, up to the Max total short cap. Equal Weight, Risk Parity and Max Diversification stay long-only.">
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
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                Max total short: {settings.maxShortPct}%
              </label>
              <Tooltip dismissOnPointerDown block label={settings.allowShort ? 'Cap on the combined size of all short positions, as a share of the portfolio. 30% allows up to 130% long / 30% short.' : 'Only used when short positions are allowed'}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  disabled={!settings.allowShort}
                  value={settings.maxShortPct}
                  onChange={(event) => setSettings({ ...settings, maxShortPct: Number(event.target.value) })}
                  className="w-full accent-[var(--color-primary)]"
                />
              </Tooltip>
            </div>
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
        <OptimizeResults
          response={run.response} settings={run.settings} liveSettings={settings} portfolio={current} basis={run.basis}
          plan={plan!} applied={run.applied} applyError={applyError} cashDeployPct={cashDeployPct}
          onCashDeployChange={setCashDeployPct} cashAfter={cashAfter} onOpenApply={() => setApplyOpen(true)}
        />
      )}

      {guideOpen && <OptimizerGuide onClose={() => setGuideOpen(false)} />}

      {applyOpen && run.status === 'ready' && plan !== null && plan.ok && (
        <div
          className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setApplyOpen(false)
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="apply-portfolio-heading" className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 w-full max-w-sm shadow-xl">
            <h2 id="apply-portfolio-heading" className="font-heading font-bold text-lg text-foreground mb-2">Apply to {current.name}?</h2>
            <div className="space-y-2 mb-4">
              {applyConfirmLines(plan, 'Optimized', current.cashWeight).map((line) => <p key={line} className="text-sm text-[var(--color-muted)] leading-relaxed">{line}</p>)}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setApplyOpen(false)} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground">Cancel</button>
              <button type="button" onClick={handleConfirmApply} className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OptimizeResults({
  response,
  settings,
  liveSettings,
  portfolio,
  basis,
  plan,
  applied,
  applyError,
  cashDeployPct,
  onCashDeployChange,
  cashAfter,
  onOpenApply,
}: {
  response: OptimizeResponse
  settings: OptimizeSettings
  liveSettings: OptimizeSettings
  portfolio: { cashWeight: number; name: string; cashDollars?: number }
  basis: TradeBasis
  plan: ApplyPlan
  applied: boolean
  applyError: string | null
  cashDeployPct: number
  onCashDeployChange: (cashDeployPct: number) => void
  cashAfter: number
  onOpenApply: () => void
}): JSX.Element {
  const rows = portfolioShareRows(weightRows(response), portfolio.cashWeight, cashAfter)
  const split = basis.kind === 'dollar' ? cashSplit(basis.investedValue, portfolio.cashWeight, cashAfter, portfolio.cashDollars) : null
  const dollarRows = basis.kind === 'dollar'
    ? portfolioShareRows(tradeRows(response, basis, split!.sizedValue), portfolio.cashWeight, cashAfter)
    : null
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
          Weights are constant-mix: chosen as if held at these proportions every day. The optimizer and backtest use invested holdings only; the table shows each holding's share of the whole portfolio, cash included.
        </p>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold">Weights</h3>
          <div className="flex gap-2">
            <Tooltip label="Download this table as a CSV">
              <button
                type="button"
                onClick={() => downloadTextFile(optimizeCsvFilename(portfolio.name, response.mode, new Date()), optimizeCsv(response, basis, portfolio.cashWeight, cashAfter, portfolio.cashDollars), 'text/csv;charset=utf-8')}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
              >
                <DownloadIcon />
                <span>Export CSV</span>
              </button>
            </Tooltip>
            <Tooltip label={applied ? 'Already applied. Run again to optimize the new weights.' : !plan.ok ? applyBlockedText(plan.reason) : "Save the Optimized weights to this portfolio's Holdings"}>
              <button type="button" disabled={applied || !plan.ok} onClick={onOpenApply} className="text-sm font-semibold px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90 disabled:opacity-50">Apply to portfolio</button>
            </Tooltip>
          </div>
        </div>
        {portfolio.cashWeight > 0 && (
          <Tooltip block label="Move this share of the portfolio's cash into the holdings, keeping the Optimized proportions. Updates the table, Export CSV and Apply to portfolio. No re-run needed.">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
                {`Cash to deploy: ${cashDeployPct}% · cash ${portfolio.cashWeight.toFixed(1)}% → ${cashAfter.toFixed(1)}%`}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={cashDeployPct}
                onChange={(event) => onCashDeployChange(Number(event.target.value))}
                className="w-full accent-[var(--color-primary)]"
              />
            </div>
          </Tooltip>
        )}
        {applied && <p className="text-sm text-brand-positive mb-3">Applied. Holdings now use the Optimized weights. Run again to compare against them.</p>}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {dollarRows === null ? (
              <>
                <thead><tr><th className={TH}>Ticker</th><th className={`${TH} text-right`}>Current</th><th className={`${TH} text-right`}>Optimized</th><th className={`${TH} text-right`}>Change</th></tr></thead>
                <tbody>{rows.map((row) => {
                  const changeText = formatChangePp(row.change)
                  return <tr key={row.ticker}><TickerCell row={row} /><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.current)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.target)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td></tr>
                })}{portfolio.cashWeight > 0 && <WeightCashRow cashWeight={portfolio.cashWeight} cashAfter={cashAfter} />}</tbody>
              </>
            ) : (
              <>
                <thead><tr><th className={TH}>Ticker</th><th className={`${TH} text-right`}>Price</th><th className={`${TH} text-right`}>Current shares</th><th className={`${TH} text-right`}>Current value</th><th className={`${TH} text-right`}>Current</th><th className={`${TH} text-right`}>Optimized shares</th><th className={`${TH} text-right`}>Optimized value</th><th className={`${TH} text-right`}>Optimized</th><th className={`${TH} text-right`}>Trade shares</th><th className={`${TH} text-right`}>Trade $</th><th className={`${TH} text-right`}>Change</th></tr></thead>
                <tbody>{dollarRows.map((row) => {
                  const changeText = formatChangePp(row.change)
                  const tradeSharesText = formatSignedShares(row.tradeShares)
                  const tradeMoneyText = formatSignedMoney(row.tradeValue)
                  return <tr key={row.ticker}><TickerCell row={row} /><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatPrice(row.price)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatShares(row.currentShares)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(row.currentValue)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.current)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatShares(row.targetShares)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(row.targetValue)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(row.target)}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(tradeSharesText)}`}>{tradeSharesText}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(tradeMoneyText)}`}>{tradeMoneyText}</td><td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td></tr>
                })}{portfolio.cashWeight > 0 && split !== null && <DollarCashRow cashWeight={portfolio.cashWeight} cashAfter={cashAfter} beforeDollars={split.cashBeforeDollars} afterDollars={split.cashAfterDollars} />}</tbody>
              </>
            )}
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">{tradeBasisNote(basis, split === null ? 0 : split.cashBeforeDollars - split.cashAfterDollars)}</p>
        {applyError !== null && <p className="mt-3 text-sm text-brand-negative">{applyError}</p>}
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h3 className="text-sm font-semibold mb-3">In-sample backtest: not a forecast</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Current</p>
            <MetricTiles items={metricItems(response.metrics.current, response.rf, response.rf_source)} />
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Optimized ({modeLabel(response.mode)})</p>
            <MetricTiles items={metricItems(response.metrics.optimized, response.rf, response.rf_source)} />
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
            <ExpandableChart title="Return: Current vs Optimized">
              {(expanded) => <OptimizeChart rows={curveRows(response.curves)} hasBenchmark={response.curves.benchmark !== null} size={expanded ? 'expanded' : 'inline'} />}
            </ExpandableChart>
          </Suspense>
        </div>
      </div>
    </div>
  )
}

function WeightCashRow({ cashWeight, cashAfter }: { cashWeight: number; cashAfter: number }): JSX.Element {
  const changeText = formatChangePp((cashAfter - cashWeight) / 100)
  return (
    <tr>
      <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>Cash</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(cashWeight / 100)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(cashAfter / 100)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td>
    </tr>
  )
}

function DollarCashRow({ cashWeight, cashAfter, beforeDollars, afterDollars }: { cashWeight: number; cashAfter: number; beforeDollars: number; afterDollars: number }): JSX.Element {
  const tradeMoneyText = formatSignedMoney(afterDollars - beforeDollars)
  const changeText = formatChangePp((cashAfter - cashWeight) / 100)
  return (
    <tr>
      <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>Cash</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>—</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>—</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(beforeDollars)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(cashWeight / 100)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>—</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatMoney(afterDollars)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatWeight(cashAfter / 100)}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>—</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(tradeMoneyText)}`}>{tradeMoneyText}</td>
      <td className={`${TD} text-right tabular-nums whitespace-nowrap ${changeColor(changeText)}`}>{changeText}</td>
    </tr>
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
