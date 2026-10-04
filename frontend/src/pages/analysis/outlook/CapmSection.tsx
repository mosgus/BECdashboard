import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { capmPortfolio, getUniverse } from '../../../api/client'
import type { CapmResponse } from '../../../api/client'
import { CapmGuide } from './CapmGuide'
import { HelpButton } from '../../../components/GuidePanel'
import { ExpandableChart } from '../../../components/ExpandableChart'
import { DownloadIcon } from '../../../components/DownloadIcon'
import { Tooltip } from '../../../components/Tooltip'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { downloadTextFile } from '../../../lib/download'
import { formatPrice, formatShares } from '../../../lib/format'
import {
  DEFAULT_CAPM_SETTINGS,
  allViewsZero,
  applyGlobalBounds,
  buildCapmRequest,
  calChartData,
  capmApplyLines,
  capmApplyPlan,
  capmCsv,
  capmCsvFilename,
  capmRows,
  capmSummary,
  capmTradeRows,
  defaultHoldingInput,
  defaultHoldingInputs,
  defaultTargetValue,
  formatBeta,
  formatReturn,
  formatView,
  parseTargetValue,
  sameCapmRun,
  statItems,
  varItems,
  viewEffect,
} from '../../../lib/capm'
import type { CapmInputs, CapmItem, CapmRun, CapmSettings } from '../../../lib/capm'
import {
  applyBlockedText,
  canOptimize,
  formatChangePp,
  formatMoney,
  formatSignedMoney,
  formatSignedShares,
  formatWeight,
  tradeBasis,
  tradeBasisNote,
} from '../../../lib/optimize'
import type { ApplyPlan, TradeBasis } from '../../../lib/optimize'
import type { Portfolio } from '../../../lib/portfolio'
import { isLegacyPortfolio, listPortfolios, savePortfolio } from '../../../lib/portfolioStore'

const CapmChart = lazy(() => import('../../../components/CapmChart'))
const TH =
  'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC_TH = `${TH} text-right tabular-nums whitespace-nowrap`
const NUMERIC_TD = `${TD} text-right tabular-nums whitespace-nowrap`
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: CapmResponse; run: CapmRun; basis: TradeBasis; applied: boolean }
type UniverseState =
  { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null>; tickers: string[] }

function color(value: string): string {
  return value.startsWith('+')
    ? 'text-brand-positive'
    : value.startsWith('-')
      ? 'text-brand-negative'
      : 'text-[var(--color-muted)]'
}

function Tiles({ items, className }: { items: CapmItem[]; className: string }): JSX.Element {
  return (
    <dl className={className}>
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-center"
        >
          <dt className="text-xs text-[var(--color-muted)]">
            <Tooltip label={item.tooltip}>
              <span>{item.label}</span>
            </Tooltip>
          </dt>
          <dd className="mt-0.5 text-base font-bold">{item.value}</dd>
          {item.detail !== undefined && <dd className="text-xs text-[var(--color-muted)]">{item.detail}</dd>}
        </div>
      ))}
    </dl>
  )
}

export function CapmSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [settings, setSettings] = useState<CapmSettings>(DEFAULT_CAPM_SETTINGS)
  const [inputs, setInputs] = useState<CapmInputs>(() => (portfolio ? defaultHoldingInputs(portfolio) : {}))
  const [minimum, setMinimum] = useState('0')
  const [maximum, setMaximum] = useState('100')
  const [targetText, setTargetText] = useState<string | null>(null)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
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
          setUniverse({
            status: 'ready',
            lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])),
            tickers: entries.map((entry) => entry.ticker).sort(),
          })
      })
      .catch(() => {
        if (!cancelled) setUniverse({ status: 'ready', lastClose: new Map(), tickers: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (portfolio === null) return null
  const current = portfolio
  const liveBasis =
    universe.status === 'ready'
      ? tradeBasis(current, universe.lastClose)
      : ({ kind: 'weights', reason: 'no-shares' } as TradeBasis)
  const targetResult = parseTargetValue(targetText ?? defaultTargetValue(liveBasis))
  const targetValue = targetResult.ok ? targetResult.value : null
  const tickers = Array.from(
    new Set([settings.marketTicker, ...(universe.status === 'ready' ? universe.tickers : [])]),
  ).sort()
  const plan =
    run.status === 'ready'
      ? capmApplyPlan(current, run.response, universe.status === 'ready' ? universe.lastClose : new Map())
      : null
  function update(ticker: string, values: Partial<CapmInputs[string]>): void {
    setInputs((previous) => ({ ...previous, [ticker]: { ...(previous[ticker] ?? defaultHoldingInput()), ...values } }))
  }
  function submit(): void {
    if (universe.status !== 'ready') return
    const basis = tradeBasis(current, universe.lastClose)
    const built = buildCapmRequest(current, settings, inputs, basis)
    if (!built.ok) {
      setRun({ status: 'error', message: built.message })
      return
    }
    const saved = { settings: { ...settings }, inputs: structuredClone(inputs) }
    setApplyError(null)
    setRun({ status: 'running' })
    void capmPortfolio(built.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, run: saved, basis, applied: false })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({ status: 'error', message: error instanceof Error ? error.message : 'The CAPM request failed.' })
      })
  }
  function confirm(): void {
    if (run.status !== 'ready' || plan === null || !plan.ok) return
    savePortfolio(plan.portfolio)
    const saved = listPortfolios().find((candidate) => candidate.id === current.id)
    if (saved === undefined || isLegacyPortfolio(saved) || saved.updatedAt === current.updatedAt)
      setApplyError("Couldn't save to this browser's storage. Nothing was changed.")
    else {
      setRun({ ...run, applied: true })
      setApplyError(null)
    }
    setApplyOpen(false)
  }
  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h2 className="text-sm font-semibold">CAPM optimization settings</h2>
          <HelpButton
            tooltip="What CAPM optimization does and how each setting works"
            onClick={() => setGuideOpen(true)}
          />
        </div>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Forward-looking: uses CAPM expected returns and your views, not a historical backtest. Results are model-based
          projections, not guarantees.
        </p>
        <div className="space-y-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <LookbackPicker
              lookbackDays={settings.lookbackDays}
              onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
              optionTooltip={(option) =>
                `Estimate betas and covariances from the last ${option.days / 365} ${option.days === 365 ? 'year' : 'years'} of daily prices`
              }
              customTooltip="Estimate betas and covariances from a start date you choose"
            />
            <Field
              label="Risk-free rate (%)"
              tip="Annual risk-free rate in percent. Leave blank to use the live 3-month Treasury bill yield."
            >
              <input
                inputMode="decimal"
                placeholder="Live"
                value={settings.rfPct}
                onChange={(event) => setSettings({ ...settings, rfPct: event.target.value })}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              />
            </Field>
            <Field
              label="Market risk premium (%)"
              tip="Market risk premium: how much more than the risk-free rate the market is expected to return each year, in percent"
            >
              <input
                inputMode="decimal"
                value={settings.mrpPct}
                onChange={(event) => setSettings({ ...settings, mrpPct: event.target.value })}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              />
            </Field>
            <Field
              label="Market ticker"
              tip="The index or fund that betas are measured against. Only Universe tickers can be chosen."
            >
              <select
                disabled={universe.status === 'loading'}
                value={settings.marketTicker}
                onChange={(event) => setSettings({ ...settings, marketTicker: event.target.value })}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              >
                {(universe.status === 'loading' ? ['SPY'] : tickers).map((ticker) => (
                  <option key={ticker}>{ticker}</option>
                ))}
              </select>
            </Field>
            <div>
              <Field
                label="Target value ($)"
                tip="Portfolio value to size trades and dollar VaR. Defaults to what your holdings are worth now. Changing it doesn't change the optimization, so there's no need to run again."
              >
                <input
                  inputMode="decimal"
                  value={targetText ?? defaultTargetValue(liveBasis)}
                  onChange={(event) => setTargetText(event.target.value)}
                  className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
                />
              </Field>
              {!targetResult.ok && <p className="text-xs text-brand-negative">{targetResult.message}</p>}
            </div>
          </div>
          <div className="ml-auto grid grid-cols-[6rem_6rem_auto] items-end gap-3">
            <Field
              label="Min % for all"
              tip="Minimum weight to give every holding that isn't frozen when you press Apply to all"
            >
              <input
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              />
            </Field>
            <Field
              label="Max % for all"
              tip="Maximum weight to give every holding that isn't frozen when you press Apply to all"
            >
              <input
                inputMode="decimal"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
                className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
              />
            </Field>
            <Tooltip label="Copy these limits to every holding that isn't frozen">
              <button
                type="button"
                onClick={() => setInputs(applyGlobalBounds(inputs, minimum, maximum))}
                className="self-end border border-brand-border rounded-[var(--radius-btn)] px-3 py-2 text-xs hover:bg-brand-border"
              >
                Apply to all
              </button>
            </Tooltip>
          </div>
        </div>
        <HoldingsTable portfolio={current} inputs={inputs} mrpPct={settings.mrpPct} onUpdate={update} />
        <Tooltip
          block
          label={
            universe.status === 'loading'
              ? 'Loading the latest prices'
              : !canOptimize(current)
                ? 'Needs at least 2 holdings to optimize'
                : 'Find the highest-Sharpe mix using CAPM expected returns and your views'
          }
        >
          <button
            type="button"
            onClick={submit}
            disabled={!canOptimize(current) || universe.status === 'loading' || run.status === 'running'}
            className="inline-flex mt-4 px-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
          >
            {run.status === 'running' ? 'Optimizing…' : 'Run CAPM optimizer'}
          </button>
        </Tooltip>
        {run.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{run.message}</p>}
      </div>
      {run.status === 'ready' && (
        <Results
          response={run.response}
          changed={!sameCapmRun({ settings, inputs }, run.run)}
          cash={current.cashWeight}
          basis={run.basis}
          targetValue={targetValue}
          portfolio={current}
          plan={plan!}
          applied={run.applied}
          applyError={applyError}
          onOpenApply={() => setApplyOpen(true)}
        />
      )}
      {applyOpen && run.status === 'ready' && plan !== null && plan.ok && (
        <div
          className="fixed inset-0 bg-overlay flex items-center justify-center px-4 z-[110]"
          onClick={(event) => {
            if (event.target === event.currentTarget) setApplyOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="apply-portfolio-heading"
            className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 w-full max-w-sm shadow-xl"
          >
            <h2 id="apply-portfolio-heading" className="font-heading font-bold text-lg text-foreground mb-2">
              Apply to {current.name}?
            </h2>
            <div className="space-y-2 mb-4">
              {capmApplyLines(plan, run.basis, targetValue).map((line) => (
                <p key={line} className="text-sm text-[var(--color-muted)] leading-relaxed">
                  {line}
                </p>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setApplyOpen(false)}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                className="text-sm font-medium px-4 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text hover:opacity-90"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
      {guideOpen && <CapmGuide onClose={() => setGuideOpen(false)} />}
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
function HoldingsTable({
  portfolio,
  inputs,
  mrpPct,
  onUpdate,
}: {
  portfolio: Portfolio
  inputs: CapmInputs
  mrpPct: string
  onUpdate: (ticker: string, values: Partial<CapmInputs[string]>) => void
}): JSX.Element {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['Ticker', 'Freeze', 'View', 'Min %', 'Max %'].map((label) => (
              <th key={label} className={TH}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {portfolio.positions.map((position) => {
            const input = inputs[position.ticker] ?? defaultHoldingInput()
            return (
              <tr key={position.ticker}>
                <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>{position.ticker}</td>
                <td className={TD}>
                  <Tooltip
                    label={`Keep ${position.ticker} at its current weight. The optimizer moves only the other holdings.`}
                  >
                    <input
                      type="checkbox"
                      checked={input.freeze}
                      onChange={(event) => onUpdate(position.ticker, { freeze: event.target.checked })}
                    />
                  </Tooltip>
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <Tooltip
                      label={`Your view on ${position.ticker}: how undervalued you think it is. It adds market risk premium × view to its expected return; the grey figure shows how much per year.`}
                    >
                      <input
                        type="range"
                        min={-50}
                        max={100}
                        step={5}
                        value={input.viewPct}
                        onChange={(event) => onUpdate(position.ticker, { viewPct: Number(event.target.value) })}
                        className="w-32 accent-[var(--color-primary)]"
                      />
                    </Tooltip>
                    <span
                      className={`w-12 text-right font-mono ${input.viewPct > 0 ? 'text-brand-positive' : input.viewPct < 0 ? 'text-brand-negative' : 'text-[var(--color-muted)]'}`}
                    >
                      {formatView(input.viewPct / 100)}
                    </span>
                    <span className="w-20 text-right font-mono text-xs text-[var(--color-muted)]">{viewEffect(input.viewPct, mrpPct) ?? ''}</span>
                  </div>
                </td>
                <td className={TD}>
                  <Tooltip label={`Lowest weight the optimizer may give ${position.ticker}, in percent`}>
                    <input
                      disabled={input.freeze}
                      inputMode="decimal"
                      value={input.minPct}
                      onChange={(event) => onUpdate(position.ticker, { minPct: event.target.value })}
                      className="w-16 rounded border border-brand-border px-2 py-1 text-sm bg-brand-surface text-foreground disabled:opacity-50"
                    />
                  </Tooltip>
                </td>
                <td className={TD}>
                  <Tooltip label={`Highest weight the optimizer may give ${position.ticker}, in percent`}>
                    <input
                      disabled={input.freeze}
                      inputMode="decimal"
                      value={input.maxPct}
                      onChange={(event) => onUpdate(position.ticker, { maxPct: event.target.value })}
                      className="w-16 rounded border border-brand-border px-2 py-1 text-sm bg-brand-surface text-foreground disabled:opacity-50"
                    />
                  </Tooltip>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
function Results({
  response,
  changed,
  cash,
  basis,
  targetValue,
  portfolio,
  plan,
  applied,
  applyError,
  onOpenApply,
}: {
  response: CapmResponse
  changed: boolean
  cash: number
  basis: TradeBasis
  targetValue: number | null
  portfolio: Portfolio
  plan: ApplyPlan
  applied: boolean
  applyError: string | null
  onOpenApply: () => void
}): JSX.Element {
  const dollarBasis = basis.kind === 'dollar' ? basis : null
  const trades = dollarBasis !== null && targetValue !== null ? capmTradeRows(response, dollarBasis, targetValue) : null
  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-2">
        <p className="text-sm">{capmSummary(response)}</p>
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
        {allViewsZero(response) && (
          <p className="text-sm text-[var(--color-muted)]">
            Every view is 0%, so these weights come from CAPM alone. They favour holdings whose price moves mostly with
            the market, not holdings expected to beat it.
          </p>
        )}
        <p className="text-sm text-[var(--color-muted)]">
          Invested holdings only.{cash > 0 && ` Cash (${cash.toFixed(1)}%) is left out and stays as it is.`}
        </p>
      </div>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="text-sm font-semibold mb-3">Expected portfolio statistics</h2>
        <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Current</p>
        <Tiles items={statItems(response, 'current')} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />
        <p className="text-xs font-medium text-[var(--color-muted)] mb-2 mt-4">Target</p>
        <Tiles items={statItems(response)} className="grid grid-cols-2 gap-3 sm:grid-cols-4" />
      </div>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <Tooltip label="Parametric 95% Value at Risk from a normal model of the Target weights' returns">
          <h2 className="text-sm font-semibold mb-3">Value at Risk (95%)</h2>
        </Tooltip>
        <Tiles items={varItems(response, targetValue)} className="grid grid-cols-2 gap-3 sm:grid-cols-5" />
      </div>
      <WeightsCard
        response={response}
        basis={basis}
        targetValue={targetValue}
        portfolio={portfolio}
        plan={plan}
        applied={applied}
        applyError={applyError}
        onOpenApply={onOpenApply}
      />
      {trades !== null && (
        <TradesCard rows={trades} targetValue={targetValue!} investedValue={dollarBasis!.investedValue} />
      )}
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="text-sm font-semibold mb-2">Risk vs return: Capital Allocation Line</h2>
        <p className="text-xs text-[var(--color-muted)] mb-3">
          Each holding's expected return (with your views) against its volatility. The dashed line runs from the
          risk-free rate through the Target portfolio. Model projections, not guarantees.
        </p>
        <Suspense
          fallback={
            <div className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">
              Loading chart…
            </div>
          }
        >
          <ExpandableChart title="Risk vs return: Capital Allocation Line">
            {(expanded) => <CapmChart data={calChartData(response)} size={expanded ? 'expanded' : 'inline'} />}
          </ExpandableChart>
        </Suspense>
      </div>
    </div>
  )
}
function WeightsCard({
  response,
  basis,
  targetValue,
  portfolio,
  plan,
  applied,
  applyError,
  onOpenApply,
}: {
  response: CapmResponse
  basis: TradeBasis
  targetValue: number | null
  portfolio: Portfolio
  plan: ApplyPlan
  applied: boolean
  applyError: string | null
  onOpenApply: () => void
}): JSX.Element {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold">Weights and CAPM details</h2>
        <div className="flex gap-2">
          <Tooltip label="Download the CAPM results as a CSV, with share and dollar trades when they're shown">
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  capmCsvFilename(portfolio.name, new Date()),
                  capmCsv(response, basis, targetValue),
                  'text/csv;charset=utf-8',
                )
              }
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-[var(--radius-btn)] bg-brand-surface border border-brand-border hover:bg-brand-border"
            >
              <DownloadIcon />
              Export CSV
            </button>
          </Tooltip>
          <Tooltip
            label={
              applied
                ? 'Already applied. Run again to optimize the new weights.'
                : !plan.ok
                  ? applyBlockedText(plan.reason)
                  : "Save the Target weights to this portfolio's Holdings"
            }
          >
            <button
              type="button"
              onClick={onOpenApply}
              disabled={applied || !plan.ok}
              className="text-sm font-medium px-3 py-2 rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text disabled:opacity-50"
            >
              Apply to portfolio
            </button>
          </Tooltip>
        </div>
      </div>
      {applied && (
        <p className="text-sm text-brand-positive mb-3">
          Applied. Holdings now use the Target weights. Run again to compare against them.
        </p>
      )}
      {applyError !== null && <p className="text-sm text-brand-negative mb-3">{applyError}</p>}
      <WeightsTable response={response} />
      {basis.kind === 'weights' && <p className="text-xs text-[var(--color-muted)] mt-3">{tradeBasisNote(basis)}</p>}
    </div>
  )
}
function WeightsTable({ response }: { response: CapmResponse }): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={TH}>Ticker</th>
            {['Beta', 'CAPM E[R]', 'View', 'E[R] with view', 'Volatility', 'Current', 'Target', 'Change'].map(
              (label) => (
                <th key={label} className={NUMERIC_TH}>
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {capmRows(response).map((row) => {
            const change = formatChangePp(row.change)
            return (
              <tr key={row.ticker}>
                <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>
                  {row.ticker}
                  {row.pinned && (
                    <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">pinned</span>
                  )}
                  {row.frozen && !row.pinned && (
                    <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">frozen</span>
                  )}
                </td>
                <td className={NUMERIC_TD}>{formatBeta(row.beta)}</td>
                <td className={NUMERIC_TD}>{formatReturn(row.capmReturn)}</td>
                <td className={NUMERIC_TD}>{formatView(row.view)}</td>
                <td className={NUMERIC_TD}>{formatReturn(row.expectedReturn)}</td>
                <td className={NUMERIC_TD}>{formatReturn(row.vol)}</td>
                <td className={NUMERIC_TD}>{formatWeight(row.current)}</td>
                <td className={NUMERIC_TD}>{formatWeight(row.target)}</td>
                <td className={`${NUMERIC_TD} ${color(change)}`}>{change}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
function TradesCard({
  rows,
  targetValue,
  investedValue,
}: {
  rows: ReturnType<typeof capmTradeRows>
  targetValue: number
  investedValue: number
}): JSX.Element {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
      <h2 className="text-sm font-semibold mb-3">Trades</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                'Ticker',
                'Price',
                'Current shares',
                'Current value',
                'Current',
                'Target shares',
                'Target value',
                'Target',
                'Trade shares',
                'Trade $',
              ].map((label, index) => (
                <th key={label} className={index === 0 ? TH : NUMERIC_TH}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker}>
                <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>
                  {row.ticker}
                  {row.pinned && (
                    <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">pinned</span>
                  )}
                  {row.frozen && !row.pinned && (
                    <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">frozen</span>
                  )}
                </td>
                <td className={NUMERIC_TD}>{formatPrice(row.price)}</td>
                <td className={NUMERIC_TD}>{formatShares(row.currentShares)}</td>
                <td className={NUMERIC_TD}>{formatMoney(row.currentValue)}</td>
                <td className={NUMERIC_TD}>{formatWeight(row.current)}</td>
                <td className={NUMERIC_TD}>{formatShares(row.targetShares)}</td>
                <td className={NUMERIC_TD}>{formatMoney(row.targetValue)}</td>
                <td className={NUMERIC_TD}>{formatWeight(row.target)}</td>
                <td className={`${NUMERIC_TD} ${color(formatSignedShares(row.tradeShares))}`}>
                  {formatSignedShares(row.tradeShares)}
                </td>
                <td className={`${NUMERIC_TD} ${color(formatSignedMoney(row.tradeValue))}`}>
                  {formatSignedMoney(row.tradeValue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--color-muted)] mt-3">
        Trades use each holding's last stored close and fractional shares, sized to a Target value of{' '}
        {formatMoney(targetValue)}. Current values total {formatMoney(investedValue)}; any difference is money added or
        withdrawn. Cash is left as it is.
      </p>
    </div>
  )
}
