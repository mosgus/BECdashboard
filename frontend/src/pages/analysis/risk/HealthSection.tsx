import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getUniverse, riskPortfolio } from '../../../api/client'
import type { RiskRequest, RiskResponse } from '../../../api/client'
import { LookbackPicker } from '../../../components/LookbackPicker'
import { Tooltip } from '../../../components/Tooltip'
import { healthCards, healthChartData, healthRows, mitigations } from '../../../lib/health'
import { tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import { buildRiskRequest, DEFAULT_RISK_SETTINGS, riskSummary, sameRiskRequest } from '../../../lib/risk'

const RiskContributionChart = lazy(() => import('../../../components/RiskContributionChart'))

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: RiskResponse; request: RiskRequest; basis: TradeBasis }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }

const TH =
  'border-b border-brand-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)] whitespace-nowrap'
const TD = 'border-b border-brand-border px-3 py-2.5'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`

export function HealthSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [lookbackDays, setLookbackDays] = useState(DEFAULT_RISK_SETTINGS.lookbackDays)
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const mountedRef = useRef(true)
  const autoRunRef = useRef(false)

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

  const submit = useCallback((): void => {
    if (portfolio === null || universe.status !== 'ready') return
    const basis = tradeBasis(portfolio, universe.lastClose)
    const built = buildRiskRequest(portfolio, { lookbackDays, marketTicker: 'SPY' }, basis)
    if (!built.ok) {
      setRun({ status: 'error', message: built.message })
      return
    }
    setRun({ status: 'running' })
    void riskPortfolio(built.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: built.request, basis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current)
          setRun({ status: 'error', message: error instanceof Error ? error.message : 'The risk request failed.' })
      })
  }, [lookbackDays, portfolio, universe])

  useEffect(() => {
    if (universe.status === 'ready' && !autoRunRef.current) {
      autoRunRef.current = true
      submit()
    }
  }, [submit, universe.status])

  if (portfolio === null) return null
  const basis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(portfolio, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const built = buildRiskRequest(portfolio, { lookbackDays, marketTicker: 'SPY' }, basis)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <LookbackPicker
          lookbackDays={lookbackDays}
          onChange={setLookbackDays}
          customTooltip="Measure risk from daily returns since a start date you choose"
          optionTooltip={(option) => `Measure risk over the last ${option.label}`}
        />
        <Tooltip label="Measure risk again with this lookback and the current holdings">
          <button
            type="button"
            onClick={submit}
            disabled={run.status === 'running' || universe.status === 'loading'}
            className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            {run.status === 'running' ? 'Computing health metrics…' : 'Recompute'}
          </button>
        </Tooltip>
      </div>

      {run.status === 'running' && <p className="text-xs text-[var(--color-muted)]">Computing health metrics…</p>}
      {run.status === 'error' && <p className="text-brand-negative">{run.message}</p>}
      {run.status === 'ready' && (
        <>
          <div className="space-y-1 text-xs text-[var(--color-muted)]">
            <p>{riskSummary(run.response)}</p>
            {run.response.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {(!built.ok || !sameRiskRequest(built.request, run.request)) && (
              <p>Lookback or holdings have changed since this run. Click Recompute to update.</p>
            )}
          </div>
          <HealthResults response={run.response} portfolioId={portfolio.id} />
        </>
      )}
    </div>
  )
}

function HealthResults({ response, portfolioId }: { response: RiskResponse; portfolioId: string }): JSX.Element {
  const rows = healthRows(response)
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {healthCards(response).map((card) => (
          <div
            key={card.label}
            className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4"
          >
            <div className="text-xs text-[var(--color-muted)]">
              <Tooltip label={card.tooltip}>
                <span>{card.label}</span>
              </Tooltip>
            </div>
            <div className="mt-1 text-xl font-bold">{card.value}</div>
          </div>
        ))}
      </div>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-4 text-sm font-semibold">
          <Tooltip label="Share of the portfolio's variance each holding drives: RC = w × (Σw) / (w′Σw). They add up to 100%. A bar much longer than its faded weight bar means the holding is riskier than its size.">
            <span>Risk Contributions</span>
          </Tooltip>
        </h2>
        <Suspense fallback={<p className="py-4 text-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
          <RiskContributionChart data={healthChartData(rows)} />
        </Suspense>
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold">Risk Contribution Detail</h2>
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className={TH}>Ticker</th>
              <Header label="Weight" tip="Share of the invested money." />
              <Header label="RC" tip="Share of portfolio variance this holding drives." />
              <Header
                label="MCTR"
                tip="Marginal contribution to risk: how much portfolio volatility rises per unit of extra weight in this holding."
              />
              <Header label="Vol" tip="This holding's own annualised volatility." />
              <Header label="Beta" tip={`How much this holding moves per 1% move in ${response.market_ticker}.`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ticker}>
                <td className={TD}>
                  <Tooltip label={`Open ${row.ticker}'s chart and indicators`}>
                    <Link to={`/ticker/${row.ticker}`} className="font-medium text-brand-primary hover:underline">
                      {row.ticker}
                    </Link>
                  </Tooltip>
                </td>
                <td className={NUMERIC}>{(row.weight * 100).toFixed(1)}%</td>
                <td className={NUMERIC}>{row.rc === null ? '—' : `${(row.rc * 100).toFixed(1)}%`}</td>
                <td className={NUMERIC}>{row.mctr === null ? '—' : row.mctr.toFixed(4)}</td>
                <td className={NUMERIC}>{(row.vol * 100).toFixed(1)}%</td>
                <td className={NUMERIC}>{row.beta.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Risk Mitigation Recommendations</h2>
          <span className="rounded-full border border-brand-border px-2 py-0.5 text-[11px] text-[var(--color-muted)]">
            Rules of thumb
          </span>
        </div>
        {mitigations(response, portfolioId).map((item) => (
          <MitigationBox key={item.title} item={item} />
        ))}
        <p className="text-xs text-[var(--color-muted)]">
          Rules of thumb, not calculations: concentration flags above HHI 0.08 / 0.15, beta above 1.1 / 1.3, volatility
          above 20% / 25%. Not investment advice.
        </p>
      </section>
    </>
  )
}

function Header({ label, tip }: { label: string; tip: string }): JSX.Element {
  return (
    <th className={`${TH} text-right`}>
      <Tooltip label={tip}>
        <span>{label}</span>
      </Tooltip>
    </th>
  )
}

function MitigationBox({ item }: { item: ReturnType<typeof mitigations>[number] }): JSX.Element {
  const colors = {
    high: 'border-red-500/40 bg-red-500/10',
    medium: 'border-amber-500/40 bg-amber-500/10',
    low: 'border-green-500/40 bg-green-500/10',
  }
  return (
    <div className={`rounded-[var(--radius-btn)] border px-4 py-3 text-xs text-foreground ${colors[item.severity]}`}>
      <p className="font-semibold">{item.title}</p>
      <p className="mt-1">{item.body}</p>
      {item.action && <p className="mt-1 font-medium">{item.action}</p>}
      {item.link && (
        <Tooltip label={`Open ${item.link.label.replace(' →', '')}`}>
          <Link to={item.link.to} className="mt-1 inline-block font-semibold underline">
            {item.link.label}
          </Link>
        </Tooltip>
      )}
    </div>
  )
}
