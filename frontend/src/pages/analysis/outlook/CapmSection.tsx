import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { capmPortfolio, getUniverse } from '../../../api/client'
import type { CapmResponse } from '../../../api/client'
import { Tooltip } from '../../../components/Tooltip'
import {
  DEFAULT_CAPM_SETTINGS,
  applyGlobalBounds,
  buildCapmRequest,
  capmRows,
  capmSummary,
  defaultHoldingInput,
  defaultHoldingInputs,
  formatBeta,
  formatReturn,
  formatView,
  sameCapmRun,
  statItems,
  varItems,
} from '../../../lib/capm'
import type { CapmInputs, CapmItem, CapmRun, CapmSettings } from '../../../lib/capm'
import { LOOKBACK_OPTIONS, canOptimize, formatChangePp, formatWeight, tradeBasis } from '../../../lib/optimize'
import type { Portfolio } from '../../../lib/portfolio'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'

const TH = 'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC_TH = `${TH} text-right tabular-nums whitespace-nowrap`
const NUMERIC_TD = `${TD} text-right tabular-nums whitespace-nowrap`

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: CapmResponse; run: CapmRun }

type UniverseState =
  | { status: 'loading' }
  | { status: 'ready'; lastClose: Map<string, number | null>; tickers: string[] }

function color(value: string): string {
  if (value.startsWith('+')) return 'text-brand-positive'
  if (value.startsWith('-')) return 'text-brand-negative'
  return 'text-[var(--color-muted)]'
}

function Tiles({ items, className }: { items: CapmItem[]; className: string }): JSX.Element {
  return (
    <dl className={className}>
      {items.map((item) => (
        <div key={item.label} className="rounded-[var(--radius-card)] border border-brand-border bg-brand-surface p-3 text-center">
          <dt className="text-xs text-[var(--color-muted)]">
            <Tooltip label={item.tooltip}>
              <span>{item.label}</span>
            </Tooltip>
          </dt>
          <dd className="mt-0.5 text-base font-bold">{item.value}</dd>
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
  const [inputs, setInputs] = useState<CapmInputs>(() => portfolio ? defaultHoldingInputs(portfolio) : {})
  const [minimum, setMinimum] = useState('0')
  const [maximum, setMaximum] = useState('100')
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
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
        if (!cancelled) {
          setUniverse({
            status: 'ready',
            lastClose: new Map(entries.map((entry) => [entry.ticker, entry.last_close])),
            tickers: entries.map((entry) => entry.ticker).sort(),
          })
        }
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
  const tickers = Array.from(new Set([
    settings.marketTicker,
    ...(universe.status === 'ready' ? universe.tickers : []),
  ])).sort()
  const runnable = canOptimize(current)
  const live = { settings, inputs }

  function update(ticker: string, values: Partial<CapmInputs[string]>): void {
    setInputs((previous) => ({
      ...previous,
      [ticker]: { ...(previous[ticker] ?? defaultHoldingInput()), ...values },
    }))
  }

  function submit(): void {
    if (universe.status !== 'ready') return

    const built = buildCapmRequest(current, settings, inputs, tradeBasis(current, universe.lastClose))
    if (!built.ok) {
      setRun({ status: 'error', message: built.message })
      return
    }

    const saved = { settings: { ...settings }, inputs: structuredClone(inputs) }
    setRun({ status: 'running' })
    void capmPortfolio(built.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, run: saved })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          setRun({
            status: 'error',
            message: error instanceof Error ? error.message : 'The CAPM request failed.',
          })
        }
      })
  }

  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="text-sm font-semibold mb-2">CAPM optimization settings</h2>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Forward-looking: uses CAPM expected returns and your views, not a historical backtest. Results are model-based projections, not guarantees.
        </p>
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Lookback</label>
            <div className="grid grid-cols-4 gap-2">
              {LOOKBACK_OPTIONS.map((option) => (
                <Tooltip
                  block
                  key={option.days}
                  label={`Estimate betas and covariances from the last ${option.days / 365} ${option.days / 365 === 1 ? 'year' : 'years'} of daily prices`}
                >
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, lookbackDays: option.days })}
                    className={`w-full py-2 text-xs font-medium rounded-[var(--radius-btn)] ${settings.lookbackDays === option.days ? 'bg-btn-action text-btn-action-text' : 'border border-brand-border text-[var(--color-muted)] hover:bg-brand-border hover:text-foreground'}`}
                  >
                    {option.label}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
          <Field label="Risk-free rate (%)" tip="Annual risk-free rate in percent. Leave blank to use the live 3-month Treasury bill yield.">
            <input
              inputMode="decimal"
              placeholder="Live"
              value={settings.rfPct}
              onChange={(event) => setSettings({ ...settings, rfPct: event.target.value })}
              className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            />
          </Field>
          <Field label="Market risk premium (%)" tip="Market risk premium: how much more than the risk-free rate the market is expected to return each year, in percent">
            <input
              inputMode="decimal"
              value={settings.mrpPct}
              onChange={(event) => setSettings({ ...settings, mrpPct: event.target.value })}
              className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            />
          </Field>
          <Field label="Market ticker" tip="The index or fund that betas are measured against. Only Universe tickers can be chosen.">
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
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-4">
          <Field label="Min % for all" tip="Minimum weight to give every holding that isn't frozen when you press Apply to all">
            <input
              inputMode="decimal"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              className="w-24 rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            />
          </Field>
          <Field label="Max % for all" tip="Maximum weight to give every holding that isn't frozen when you press Apply to all">
            <input
              inputMode="decimal"
              value={maximum}
              onChange={(event) => setMaximum(event.target.value)}
              className="w-24 rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            />
          </Field>
          <Tooltip label="Copy these limits to every holding that isn't frozen">
            <button
              type="button"
              onClick={() => setInputs(applyGlobalBounds(inputs, minimum, maximum))}
              className="border border-brand-border rounded-[var(--radius-btn)] px-3 py-2 text-xs hover:bg-brand-border"
            >
              Apply to all
            </button>
          </Tooltip>
        </div>
        <HoldingsTable portfolio={current} inputs={inputs} onUpdate={update} />
        <Tooltip
          block
          label={universe.status === 'loading' ? 'Loading the latest prices' : !runnable ? 'Needs at least 2 holdings to optimize' : 'Find the highest-Sharpe mix using CAPM expected returns and your views'}
        >
          <button
            type="button"
            onClick={submit}
            disabled={!runnable || universe.status === 'loading' || run.status === 'running'}
            className="w-full mt-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
          >
            {run.status === 'running' ? 'Optimizing…' : 'Run CAPM optimizer'}
          </button>
        </Tooltip>
        {run.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{run.message}</p>}
      </div>
      {run.status === 'ready' && (
        <Results
          response={run.response}
          changed={!sameCapmRun(live, run.run)}
          cash={current.cashWeight}
        />
      )}
    </div>
  )
}

function Field({ label, tip, children }: { label: string; tip: string; children: JSX.Element }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</label>
      <Tooltip block label={tip}>{children}</Tooltip>
    </div>
  )
}

function HoldingsTable({ portfolio, inputs, onUpdate }: { portfolio: Portfolio; inputs: CapmInputs; onUpdate: (ticker: string, values: Partial<CapmInputs[string]>) => void }): JSX.Element {
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['Ticker', 'Freeze', 'View', 'Min %', 'Max %'].map((label) => (
              <th key={label} className={TH}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {portfolio.positions.map((position) => {
            const input = inputs[position.ticker] ?? defaultHoldingInput()
            return (
              <tr key={position.ticker}>
                <td className={TD}>{position.ticker}</td>
                <td className={TD}>
                  <Tooltip label={`Keep ${position.ticker} at its current weight. The optimizer moves only the other holdings.`}>
                    <input
                      type="checkbox"
                      checked={input.freeze}
                      onChange={(event) => onUpdate(position.ticker, { freeze: event.target.checked })}
                    />
                  </Tooltip>
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <Tooltip label={`Your view on ${position.ticker}: how undervalued you think it is. Each +10% adds 10% of the market risk premium to its expected return.`}>
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

function Results({ response, changed, cash }: { response: CapmResponse; changed: boolean; cash: number }): JSX.Element {
  return (
    <>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-2">
        <p className="text-sm">{capmSummary(response)}</p>
        {changed && <p className="text-sm text-[var(--color-muted)]">Settings have changed since this run. Run it again to update the results.</p>}
        {response.warnings.map((warning) => (
          <p key={warning} className="text-sm text-[var(--color-muted)]">{warning}</p>
        ))}
        <p className="text-sm text-[var(--color-muted)]">
          Invested holdings only.{cash > 0 && ` Cash (${cash.toFixed(1)}%) is left out and stays as it is.`}
        </p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
          <h2 className="text-sm font-semibold mb-3">Expected portfolio statistics</h2>
          <Tiles items={statItems(response)} className="grid grid-cols-2 gap-3" />
        </div>
        <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
          <Tooltip label="Parametric 95% Value at Risk from a normal model of the Target weights' returns">
            <h2 className="text-sm font-semibold mb-3">Value at Risk (95%)</h2>
          </Tooltip>
          <Tiles items={varItems(response)} className="grid grid-cols-2 gap-3 sm:grid-cols-3" />
        </div>
      </div>
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="text-sm font-semibold mb-3">Weights and CAPM details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Ticker</th>
                {['Beta', 'CAPM E[R]', 'View', 'E[R] with view', 'Volatility', 'Current', 'Target', 'Change'].map((label) => (
                  <th key={label} className={NUMERIC_TH}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {capmRows(response).map((row) => {
                const change = formatChangePp(row.change)
                return (
                  <tr key={row.ticker}>
                    <td className={`${TD} font-mono text-xs font-semibold whitespace-nowrap`}>
                      {row.ticker}
                      {row.pinned && <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">pinned</span>}
                      {row.frozen && !row.pinned && <span className="ml-2 text-[10px] font-sans font-normal text-[var(--color-muted)]">frozen</span>}
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
      </div>
    </>
  )
}
