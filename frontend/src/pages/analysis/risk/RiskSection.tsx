import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { getUniverse, riskPortfolio } from '../../../api/client'
import type { RiskRequest, RiskResponse } from '../../../api/client'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { Tooltip } from '../../../components/Tooltip'
import { cashDollars } from '../../../lib/monteCarlo'
import { formatMoney, tradeBasis } from '../../../lib/optimize'
import type { MetricItem, TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import {
  DEFAULT_RISK_SETTINGS,
  DEFAULT_SHOCK_TEXT,
  buildRiskRequest,
  formatSigned,
  parseShock,
  riskRows,
  riskSummary,
  riskTiles,
  sameRiskRequest,
  shockLabel,
  shockImpact,
} from '../../../lib/risk'
import type { RiskSettings } from '../../../lib/risk'
import { useParams } from 'react-router-dom'
import type { Portfolio } from '../../../lib/portfolio'

const TH =
  'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: RiskResponse; request: RiskRequest; basis: TradeBasis }
type UniverseState =
  { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null>; tickers: string[] }

export function Tiles({ items }: { items: MetricItem[] }): JSX.Element {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        </div>
      ))}
    </dl>
  )
}

export function RiskSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [settings, setSettings] = useState<RiskSettings>(DEFAULT_RISK_SETTINGS)
  const [shockText, setShockText] = useState(DEFAULT_SHOCK_TEXT)
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
  const basis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(current, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const built = buildRiskRequest(current, settings, basis)
  const marketTickers = Array.from(
    new Set([settings.marketTicker, ...(universe.status === 'ready' ? universe.tickers : [])]),
  ).sort()
  const shock = parseShock(shockText)

  function submit(): void {
    if (universe.status !== 'ready') return
    const nextBasis = tradeBasis(current, universe.lastClose)
    const request = buildRiskRequest(current, settings, nextBasis)
    if (!request.ok) {
      setRun({ status: 'error', message: request.message })
      return
    }
    setRun({ status: 'running' })
    void riskPortfolio(request.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: request.request, basis: nextBasis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({ status: 'error', message: error instanceof Error ? error.message : 'The risk request failed.' })
      })
  }

  return (
    <div className="space-y-5">
      <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-4 text-sm font-semibold">Risk settings</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <LookbackPicker
            lookbackDays={settings.lookbackDays}
            onChange={(lookbackDays) => setSettings({ ...settings, lookbackDays })}
            customTooltip="Measure risk from daily returns since a start date you choose"
            optionTooltip={(option) => `Measure risk over the last ${option.label}`}
          />
          <Field label="Market ticker" tip="The benchmark used to estimate beta and market-move effects.">
            <select
              value={settings.marketTicker}
              onChange={(event) => setSettings({ ...settings, marketTicker: event.target.value })}
              className="w-full rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
            >
              {(universe.status === 'loading' ? ['SPY'] : marketTickers).map((ticker) => (
                <option key={ticker}>{ticker}</option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={run.status === 'running' || universe.status === 'loading' || current.positions.length === 0}
          className="mt-4 inline-flex px-4 py-3 text-sm rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text font-semibold disabled:opacity-50"
        >
          {run.status === 'running' ? 'Measuring risk…' : 'Measure risk'}
        </button>
        {run.status === 'error' && <p className="mt-3 text-sm text-brand-negative">{run.message}</p>}
      </div>
      {run.status === 'ready' && (
        <Results
          response={run.response}
          changed={!built.ok || !sameRiskRequest(built.request, run.request)}
          shockText={shockText}
          shock={shock}
          basis={run.basis}
          portfolio={current}
          onShockChange={setShockText}
        />
      )}
    </div>
  )
}

function Results({
  response,
  changed,
  shockText,
  shock,
  basis,
  portfolio,
  onShockChange,
}: {
  response: RiskResponse
  changed: boolean
  shockText: string
  shock: ReturnType<typeof parseShock>
  basis: TradeBasis
  portfolio: Portfolio
  onShockChange: (text: string) => void
}): JSX.Element {
  const impact = shock.ok ? shockImpact(response, shock.value) : null
  const shockError = shock.ok ? null : shock.message
  const shockValue = shock.ok ? shock.value : null
  return (
    <>
      <div className="text-sm text-[var(--color-muted)]">
        <p>{riskSummary(response)}</p>
        {response.warnings.map((warning) => (
          <p key={warning} className="mt-1">
            {warning}
          </p>
        ))}
        {changed && (
          <p className="mt-2 text-brand-negative">
            Settings have changed since this run. Run it again to update the results.
          </p>
        )}
      </div>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Portfolio risk</h2>
        <Tiles items={riskTiles(response)} />
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold">Where the risk comes from</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Ticker</th>
              <th className={`${TH} text-right`}>Weight</th>
              <th className={`${TH} text-right`}>Volatility</th>
              <th className={`${TH} text-right`}>Beta</th>
              <th className={`${TH} text-right`}>Share of risk</th>
              <th className={`${TH} text-right`}>Risk ÷ weight</th>
              <th className={`${TH} text-right`}>{shockLabel(response.market_ticker, shock)}</th>
            </tr>
          </thead>
          <tbody>
            {riskRows(response).map((row) => (
              <tr key={row.ticker}>
                <td className={TD}>{row.ticker}</td>
                <td className={NUMERIC}>{(row.weight * 100).toFixed(1)}%</td>
                <td className={NUMERIC}>{(row.vol * 100).toFixed(1)}%</td>
                <td className={NUMERIC}>{row.beta.toFixed(2)}</td>
                <td className={NUMERIC}>{row.riskShare === null ? '—' : `${(row.riskShare * 100).toFixed(1)}%`}</td>
                <td
                  className={`${NUMERIC} ${row.ratio !== null && row.ratio > 1 ? 'text-brand-negative' : 'text-[var(--color-muted)]'}`}
                >
                  {row.ratio === null ? '—' : `${row.ratio.toFixed(2)}×`}
                </td>
                <td className={NUMERIC}>{impact === null ? '—' : formatSigned(impact.byTicker[row.ticker])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Weight is each holding&apos;s share of the invested money (cash excluded). Share of risk is its contribution to
          the portfolio&apos;s volatility; the shares add up to 100%. Risk ÷ weight above 1 means the holding adds more
          risk than its size suggests.
        </p>
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Market move</h2>
        <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]" htmlFor="risk-shock">
          Move (%)
        </label>
        <input
          id="risk-shock"
          inputMode="decimal"
          value={shockText}
          onChange={(event) => onShockChange(event.target.value)}
          className="w-full max-w-xs rounded-[var(--radius-btn)] border border-brand-border px-3 py-2 text-sm bg-brand-surface text-foreground"
        />
        {shockError !== null ? (
          <p className="mt-2 text-sm text-brand-negative">{shockError}</p>
        ) : (
          <p className="mt-2 text-sm">
            If {response.market_ticker} moves {formatSigned(shockValue!)}, the portfolio moves about{' '}
            {formatSigned(impact!.portfolio)}
            {basis.kind === 'dollar'
              ? ` (about ${formatMoney((impact!.portfolio / 100) * (basis.investedValue + cashDollars(portfolio, basis)))})`
              : ''}
          </p>
        )}
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Linear estimate from beta. In real sell-offs, correlations rise and losses are usually larger than beta alone
          suggests.
        </p>
      </section>
    </>
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
