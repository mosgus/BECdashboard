import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useParams } from 'react-router-dom'
import { getUniverse, stressPortfolio } from '../../../api/client'
import type { StressRequest, StressResponse } from '../../../api/client'
import { Tooltip } from '../../../components/Tooltip'
import { cashDollars } from '../../../lib/monteCarlo'
import { formatMoney, tradeBasis } from '../../../lib/optimize'
import type { TradeBasis } from '../../../lib/optimize'
import { isLegacyPortfolio, listPortfolios } from '../../../lib/portfolioStore'
import type { Portfolio } from '../../../lib/portfolio'
import { formatSigned } from '../../../lib/risk'
import {
  STRESS_PRESETS,
  buildStressRequest,
  parseWindow,
  sameStressRequest,
  stressChartData,
  stressRows,
  stressSummary,
  stressTiles,
} from '../../../lib/stress'
import { Tiles } from './RiskSection'

const StressChart = lazy(() => import('../../../components/StressChart'))
const TH =
  'text-left font-medium text-[11px] tracking-wide uppercase text-[var(--color-muted)] px-3 py-2 border-b border-brand-border whitespace-nowrap'
const TD = 'px-3 py-2.5 border-b border-brand-border'
const NUMERIC = `${TD} text-right tabular-nums whitespace-nowrap`
type Run =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | { status: 'ready'; response: StressResponse; request: StressRequest; basis: TradeBasis }
type Universe = { status: 'loading' } | { status: 'ready'; lastClose: Map<string, number | null>; tickers: string[] }

export function StressSection(): JSX.Element | null {
  const { portfolioId } = useParams()
  const found = listPortfolios().find((item) => item.id === portfolioId)
  const portfolio = found === undefined || isLegacyPortfolio(found) ? null : found
  const preset = STRESS_PRESETS[0]
  const [startText, setStartText] = useState(preset.start),
    [endText, setEndText] = useState(preset.end),
    [marketTicker, setMarketTicker] = useState('SPY'),
    [selected, setSelected] = useState(preset.id),
    [run, setRun] = useState<Run>({ status: 'idle' }),
    [universe, setUniverse] = useState<Universe>({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    void getUniverse()
      .then((entries) => {
        if (!cancelled)
          setUniverse({
            status: 'ready',
            lastClose: new Map(entries.map((e) => [e.ticker, e.last_close])),
            tickers: entries.map((e) => e.ticker).sort(),
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
  const basis: TradeBasis =
    universe.status === 'ready' ? tradeBasis(portfolio, universe.lastClose) : { kind: 'weights', reason: 'no-shares' }
  const window = parseWindow(startText, endText)
  const built = window.ok ? buildStressRequest(portfolio, window, marketTicker, basis) : window
  const tickers = Array.from(new Set([marketTicker, ...(universe.status === 'ready' ? universe.tickers : [])])).sort()
  const submit = () => {
    if (universe.status !== 'ready') return
    const nextWindow = parseWindow(startText, endText)
    if (!nextWindow.ok) return setRun({ status: 'error', message: nextWindow.message })
    const request = buildStressRequest(portfolio, nextWindow, marketTicker, tradeBasis(portfolio, universe.lastClose))
    if (!request.ok) return setRun({ status: 'error', message: request.message })
    setRun({ status: 'running' })
    void stressPortfolio(request.request)
      .then((response) => {
        if (mounted.current) setRun({ status: 'ready', response, request: request.request, basis })
      })
      .catch((error: unknown) => {
        if (mounted.current)
          setRun({ status: 'error', message: error instanceof Error ? error.message : 'The stress request failed.' })
      })
  }
  return (
    <div className="space-y-5">
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-4 text-sm font-semibold">Stress test settings</h2>
        <div className="flex flex-wrap gap-1">
          {STRESS_PRESETS.map((p) => (
            <Tooltip key={p.id} label={`${p.description} ${p.start} → ${p.end}`}>
              <button
                type="button"
                onClick={() => {
                  setStartText(p.start)
                  setEndText(p.end)
                  setSelected(p.id)
                }}
                className={`px-3 py-2 text-xs rounded-[var(--radius-btn)] ${selected === p.id ? 'bg-btn-action text-btn-action-text' : 'border border-brand-border text-[var(--color-muted)]'}`}
              >
                {p.name}
              </button>
            </Tooltip>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-xs text-[var(--color-muted)]">
            Start
            <input
              type="date"
              value={startText}
              onChange={(e) => {
                setStartText(e.target.value)
                setSelected('')
              }}
              className="mt-1 block w-full rounded border border-brand-border bg-brand-surface p-2 text-foreground"
            />
          </label>
          <label className="text-xs text-[var(--color-muted)]">
            End
            <input
              type="date"
              value={endText}
              onChange={(e) => {
                setEndText(e.target.value)
                setSelected('')
              }}
              className="mt-1 block w-full rounded border border-brand-border bg-brand-surface p-2 text-foreground"
            />
          </label>
          <label className="text-xs text-[var(--color-muted)]">
            Market ticker
            <select
              value={marketTicker}
              onChange={(e) => setMarketTicker(e.target.value)}
              className="mt-1 block w-full rounded border border-brand-border bg-brand-surface p-2 text-foreground"
            >
              {(universe.status === 'loading' ? ['SPY'] : tickers).map((ticker) => (
                <option key={ticker}>{ticker}</option>
              ))}
            </select>
          </label>
        </div>
        {!window.ok && <p className="mt-2 text-sm text-brand-negative">{window.message}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={run.status === 'running' || universe.status === 'loading'}
          className="mt-4 px-4 py-3 text-sm font-semibold rounded-[var(--radius-btn)] bg-btn-action text-btn-action-text disabled:opacity-50"
        >
          {run.status === 'running' ? 'Running…' : 'Run stress test'}
        </button>
        {run.status === 'error' && <p className="mt-2 text-sm text-brand-negative">{run.message}</p>}
      </section>
      {run.status === 'ready' && (
        <Results
          response={run.response}
          basis={run.basis}
          portfolio={portfolio}
          changed={!built.ok || !sameStressRequest(built.request, run.request)}
        />
      )}
    </div>
  )
}

function Results({
  response,
  basis,
  portfolio,
  changed,
}: {
  response: StressResponse
  basis: TradeBasis
  portfolio: Portfolio
  changed: boolean
}): JSX.Element {
  const matching = STRESS_PRESETS.find((p) => p.start === response.start && p.end === response.end)
  const total = basis.kind === 'dollar' ? basis.investedValue + cashDollars(portfolio, basis) : null
  return (
    <>
      <div className="text-sm text-[var(--color-muted)]">
        <p>
          {matching ? `${matching.name} · ` : ''}
          {stressSummary(response)}
        </p>
        {response.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        {changed && (
          <p className="mt-2 text-brand-negative">
            Settings have changed since this run. Run it again to update the results.
          </p>
        )}
      </div>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Result</h2>
        <Tiles items={stressTiles(response)} />
        {total !== null && (
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            On today&apos;s {formatMoney(total)}, that is about {formatMoney(response.portfolio_return * total)}.
          </p>
        )}
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <h2 className="mb-3 text-sm font-semibold">Path</h2>
        <Suspense fallback={<div className="h-[22rem]" />}>
          <StressChart data={stressChartData(response)} marketTicker={response.market_ticker} />
        </Suspense>
      </section>
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 overflow-x-auto">
        <h2 className="mb-3 text-sm font-semibold">By holding</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Ticker</th>
              <th className={`${TH} text-right`}>Weight</th>
              <th className={`${TH} text-right`}>Return</th>
              <th className={`${TH} text-right`}>Contribution</th>
            </tr>
          </thead>
          <tbody>
            {stressRows(response).map((row) => (
              <tr key={row.ticker}>
                <td className={TD}>{row.ticker}</td>
                <td className={NUMERIC}>{(row.weight * 100).toFixed(1)}%</td>
                <td className={NUMERIC}>
                  {row.assetReturn === null ? 'No prices' : formatSigned(row.assetReturn * 100)}
                </td>
                <td
                  className={`${NUMERIC} ${row.contribution !== null && row.contribution < 0 ? 'text-brand-negative' : ''}`}
                >
                  {row.contribution === null ? 'No prices' : formatSigned(row.contribution * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Contribution is weight × return; contributions add up to the portfolio return. Holdings bought and held from
          the start of the window, not rebalanced. Past windows show how today&apos;s holdings behaved then, not how
          they will behave next time.
        </p>
      </section>
    </>
  )
}
