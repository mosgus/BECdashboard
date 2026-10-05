import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getSignals, getUniverse, performancePortfolio } from '../../../api/client'
import type { PerformanceRequest, PerformanceResponse, TickerSignals } from '../../../api/client'
import { SignalBadge } from '../../../components/SignalBadge'
import { Tooltip } from '../../../components/Tooltip'
import { downloadTextFile } from '../../../lib/download'
import { tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import {
  buildPerformanceRequest,
  performanceChartData,
  performanceCsv,
  performanceRows,
  performanceSummary,
  samePerformanceRequest,
  SIGNAL_COLUMNS,
  signalGrid,
} from '../../../lib/performance'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'

const StressChart = lazy(() => import('../../../components/StressChart'))

type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: PerformanceResponse; request: PerformanceRequest; basis: TradeBasis }
type UniverseState = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null> }
type SignalsState = { status: 'loading' } | { status: 'ready'; signals: TickerSignals[] } | { status: 'error' }

const tone = {
  positive: 'text-brand-positive',
  negative: 'text-brand-negative',
  default: '',
  muted: 'text-[var(--color-muted)]',
} as const

export function PerformanceSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [run, setRun] = useState<RunState>({ status: 'idle' })
  const [universe, setUniverse] = useState<UniverseState>({ status: 'loading' })
  const [signals, setSignals] = useState<SignalsState>({ status: 'loading' })
  const mountedRef = useRef(true)
  const autoRunRef = useRef(false)
  const initialTickersRef = useRef(portfolio?.positions.map((position) => position.ticker) ?? [])

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

  useEffect(() => {
    let cancelled = false
    void getSignals(initialTickersRef.current)
      .then((response) => {
        if (!cancelled) setSignals({ status: 'ready', signals: response.signals })
      })
      .catch(() => {
        if (!cancelled) setSignals({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = useCallback((): void => {
    if (portfolio === null) return
    if (universe.status !== 'ready') return
    const nextBasis = tradeBasis(portfolio, universe.lastClose)
    const request = buildPerformanceRequest(portfolio, { start, end }, nextBasis)
    if (!request.ok) {
      setRun({ status: 'error', message: request.message })
      return
    }
    setRun({ status: 'running' })
    void performancePortfolio(request.request)
      .then((response) => {
        if (mountedRef.current) setRun({ status: 'ready', response, request: request.request, basis: nextBasis })
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          setRun({
            status: 'error',
            message: error instanceof Error ? error.message : 'The performance request failed.',
          })
        }
      })
  }, [end, portfolio, setRun, start, universe])

  useEffect(() => {
    if (universe.status === 'ready' && !autoRunRef.current) {
      autoRunRef.current = true
      submit()
    }
  }, [submit, universe.status])

  if (portfolio === null) return null

  const basis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(portfolio, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const built = buildPerformanceRequest(portfolio, { start, end }, basis)

  const rows =
    signals.status === 'ready'
      ? signalGrid(
          portfolio.positions.map((position) => position.ticker),
          signals.signals,
        )
      : []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-[var(--color-muted)]">
          Start (optional)
          <Tooltip label="First day of the window. Leave empty for one year before the end date.">
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
            />
          </Tooltip>
        </label>
        <label className="text-xs font-medium text-[var(--color-muted)]">
          End (optional)
          <Tooltip label="Last day of the window. Leave empty for the latest stored prices.">
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
            />
          </Tooltip>
        </label>
        <Tooltip label="Recompute performance for these dates with the current holdings">
          <button
            type="button"
            onClick={submit}
            disabled={run.status === 'running' || universe.status === 'loading'}
            className="inline-flex rounded-[var(--radius-btn)] bg-btn-action px-4 py-2 text-sm font-semibold text-btn-action-text disabled:opacity-50"
          >
            Load Analytics
          </button>
        </Tooltip>
        <Tooltip label="Today's holdings bought at the start of the window and held, not your actual trade history.">
          <span className="rounded-full border border-brand-border px-2 py-1 text-xs text-[var(--color-muted)]">
            Buy &amp; hold
          </span>
        </Tooltip>
      </div>

      {run.status === 'running' && <p className="text-xs text-[var(--color-muted)]">Computing analytics…</p>}
      {run.status === 'error' && <p className="text-brand-negative">{run.message}</p>}
      {run.status === 'ready' && (
        <>
          <div className="space-y-1 text-xs text-[var(--color-muted)]">
            <p>{performanceSummary(run.response)}</p>
            {run.response.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {(!built.ok || !samePerformanceRequest(built.request, run.request)) && (
              <p>Dates or holdings have changed since this run. Click Load Analytics to update.</p>
            )}
          </div>
          <PerformanceResults response={run.response} />
        </>
      )}

      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Exit Signals</h2>
        {signals.status === 'error' ? (
          <p className="text-xs text-[var(--color-muted)]">Signals unavailable.</p>
        ) : (
          <>
            <div className="grid grid-cols-[5rem_1fr_1fr_1fr] gap-2 border-b border-brand-border pb-1">
              <span />
              {SIGNAL_COLUMNS.map(([key, label]) => (
                <span key={key} className="text-xs font-semibold text-[var(--color-muted)]">
                  {label}
                </span>
              ))}
            </div>
            {rows.map((row) => (
              <div key={row.ticker} className="grid grid-cols-[5rem_1fr_1fr_1fr] items-center gap-2 py-1">
                <Tooltip label={`Open ${row.ticker}'s chart and indicators`}>
                  <Link
                    to={`/ticker/${row.ticker}`}
                    className="font-mono text-xs font-semibold text-brand-primary hover:underline"
                  >
                    {row.ticker}
                  </Link>
                </Tooltip>
                {row.cells.map((cell, index) => (
                  <div key={SIGNAL_COLUMNS[index][0]}>
                    <SignalBadge state={cell.state} />
                    {cell.lastTrigger !== null && (
                      <span className="ml-1.5 text-[11px] text-[var(--color-muted)]">{cell.lastTrigger}</span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  )
}

function PerformanceResults({ response }: { response: PerformanceResponse }): JSX.Element {
  return (
    <>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Portfolio vs Benchmark ({response.market_ticker})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-brand-border text-[var(--color-muted)]">
              <tr>
                <th className="py-2 text-left font-medium">Metric</th>
                <th className="py-2 text-right font-medium">Portfolio</th>
                <th className="py-2 text-right font-medium">{response.market_ticker}</th>
                <th className="py-2 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              {performanceRows(response).map((row) => (
                <tr key={row.label} className="border-b border-brand-border">
                  <td className="py-2">
                    <Tooltip label={row.tooltip}>
                      <span>{row.label}</span>
                    </Tooltip>
                  </td>
                  <td className={`py-2 text-right tabular-nums font-semibold ${tone[row.portfolioTone]}`}>
                    {row.portfolio}
                  </td>
                  <td className="py-2 text-right tabular-nums text-[var(--color-muted)]">{row.benchmark}</td>
                  <td
                    className={`py-2 text-right tabular-nums ${row.diffTone === 'muted' ? '' : 'font-bold'} ${tone[row.diffTone]}`}
                  >
                    {row.diff}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Today&apos;s holdings bought at the start of the window and left to drift; cash stays flat. Sharpe and alpha
          subtract the risk-free rate shown above.
        </p>
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Equity Curve</h2>
          <Tooltip label={`Download the portfolio and ${response.market_ticker} curves as a CSV file`}>
            <button
              type="button"
              onClick={() => downloadTextFile('equity_curve.csv', performanceCsv(response), 'text/csv')}
              className="text-xs font-semibold text-brand-primary hover:underline"
            >
              Download CSV
            </button>
          </Tooltip>
        </div>
        <Suspense fallback={<p className="text-xs text-[var(--color-muted)]">Loading chart…</p>}>
          <StressChart data={performanceChartData(response)} marketTicker={response.market_ticker} />
        </Suspense>
      </section>
    </>
  )
}
