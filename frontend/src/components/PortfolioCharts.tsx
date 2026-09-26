import { lazy, Suspense, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ApiError, getPortfolioSeries } from '../api/client'
import type { PortfolioSeriesResponse, SignalOut } from '../api/client'
import { INDICATOR_GROUPS, SIGNAL_DESCRIPTIONS } from '../lib/indicators'
import type { Portfolio } from '../lib/portfolio'
import { PORTFOLIO_ALWAYS_ON, PORTFOLIO_INDICATOR_KEYS, chartMode, defaultStart, flatFillRange, formatDollars, scaleFactor, scaleSeries } from '../lib/portfolioChart'
import { SignalBadge } from './SignalBadge'
import { Tooltip } from './Tooltip'

const SeriesChart = lazy(() => import('./SeriesChart'))

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; data: PortfolioSeriesResponse }

function signalReading(signal: SignalOut): string | null {
  return signal.signal === 'rsi_threshold' && signal.value !== null ? `RSI ${signal.value.toFixed(2)}` : null
}

export function PortfolioCharts({ portfolio }: { portfolio: Portfolio }): JSX.Element | null {
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [enabledIndicators, setEnabledIndicators] = useState<Set<string>>(new Set())
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const tickerKey = portfolio.positions.map((position) => position.ticker).join(',')
  const weightKey = portfolio.positions.map((position) => String(position.weight)).join(',')
  const include = Array.from(new Set([...PORTFOLIO_ALWAYS_ON, ...enabledIndicators])).sort()
  const includeKey = include.join(',')

  useEffect(() => {
    if (tickerKey === '') return
    let cancelled = false
    void getPortfolioSeries(tickerKey.split(','), weightKey.split(',').map(Number), portfolio.cashWeight, includeKey.split(','))
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error })
      })
    return () => {
      cancelled = true
    }
  }, [tickerKey, weightKey, portfolio.cashWeight, includeKey])

  if (portfolio.positions.length === 0) return null
  if (state.status === 'loading') return <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4"><p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p></section>
  if (state.status === 'error') {
    const message = state.error instanceof ApiError && state.error.status === 404
      ? "A holding has no stored price history, so the portfolio can't be charted."
      : 'The portfolio chart could not be loaded.'
    return <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4"><p className="text-sm text-brand-negative">{message}</p></section>
  }

  const { data } = state
  const effectiveStart = start ?? defaultStart(new Date())
  const effectiveEnd = end ?? data.dates.at(-1) ?? ''
  const visibleIndices = data.dates.flatMap((date, index) => date >= effectiveStart && date <= effectiveEnd ? [index] : [])
  const firstVisibleIndex = visibleIndices[0]
  const mode = chartMode(portfolio, data.holdings)
  const k = firstVisibleIndex === undefined ? 1 : scaleFactor(mode, data.value, firstVisibleIndex)
  const points = visibleIndices.map((index) => ({ date: data.dates[index], value: data.value[index] * k }))
  const indicators = { ticker: 'PORTFOLIO', dates: data.dates, series: scaleSeries(data.series, k) }
  const shaded = flatFillRange(data.holdings, effectiveStart, effectiveEnd) ?? undefined
  const firstVisibleDate = points[0]?.date
  const lastDate = data.dates.at(-1)

  function toggleIndicator(key: string): void {
    setEnabledIndicators((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-5 mt-5">
      <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
        <div className="flex flex-col items-start gap-y-4 pb-4 mb-4 border-b border-brand-border">
          <div className="flex flex-wrap gap-4">
            <label className="text-xs font-medium text-[var(--color-muted)]">
              Start
              <Tooltip label="Limit the chart to this date range. Before a holding's first stored price, it is held flat.">
                <input type="date" value={start ?? effectiveStart} min={data.dates[0]} max={effectiveEnd} onChange={(event) => setStart(event.target.value)} className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground" />
              </Tooltip>
            </label>
            <label className="text-xs font-medium text-[var(--color-muted)]">
              End
              <Tooltip label="Limit the chart to this date range">
                <input type="date" value={end ?? effectiveEnd} min={effectiveStart} max={data.dates.at(-1)} onChange={(event) => setEnd(event.target.value)} className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground" />
              </Tooltip>
            </label>
          </div>
          <div className="flex-1 min-w-64">
            <span className="text-xs font-medium text-[var(--color-muted)]">Indicators</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
              {INDICATOR_GROUPS.filter((group) => (PORTFOLIO_INDICATOR_KEYS as readonly string[]).includes(group.key)).map((group) => (
                <Tooltip key={group.key} label="Draw this indicator on the chart">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={enabledIndicators.has(group.key)} onChange={() => toggleIndicator(group.key)} className="accent-[var(--color-primary)]" />
                    {group.label}
                  </label>
                </Tooltip>
              ))}
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-3">ATR, Donchian, ADX, Stochastic and OBV need a single security's high, low or volume, so they aren't drawn for a portfolio.</p>
          </div>
        </div>
        {points.length === 0 ? <p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">No stored data in this date range.</p> : (
          <>
            <div className="text-xs text-[var(--color-muted)] mb-3">
              {mode.kind === 'dollar'
                ? <>Dollars at the last close ({lastDate}), from today's share counts held unchanged. No rebalancing.</>
                : <>Index, 100 on {firstVisibleDate}. Built from today's weights held unchanged. No rebalancing.</>}
              {mode.kind === 'index' && mode.reason === 'shares-mismatch' && <p>Share counts don't match the declared weights within 0.5 points, so this is shown as an index rather than dollars.</p>}
              {mode.kind === 'index' && mode.reason === 'no-shares' && <p>Add a share count to every holding to see this in dollars.</p>}
            </div>
            <Suspense fallback={<p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
              <SeriesChart title="Portfolio — Value & Moving Averages" valueName="Portfolio" points={points} indicators={indicators} shaded={shaded} formatValue={mode.kind === 'dollar' ? formatDollars : (value) => value.toFixed(2)} valueAxisWidth={mode.kind === 'dollar' ? 64 : 56} />
            </Suspense>
          </>
        )}
      </section>

      {data.signals.length > 0 && (
        <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border">
            <h2 className="text-sm font-semibold"><Tooltip label="Computed from the portfolio line's closing values. State reflects the most recent crossover or threshold event."><span>Signal States</span></Tooltip></h2>
          </div>
          <div className="divide-y divide-brand-border">
            {data.signals.map((signal) => {
              const reading = signalReading(signal)
              return <div key={signal.signal} className="px-4 py-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] items-start gap-x-4 gap-y-2">
                <div className="min-w-48 max-w-md"><p className="text-sm font-semibold">{signal.label}</p><p className="text-xs text-[var(--color-muted)] mt-1">{SIGNAL_DESCRIPTIONS[signal.signal] ?? ''}</p></div>
                <div className="space-y-1"><SignalBadge state={signal.state} />{reading !== null && <p className="text-xs text-[var(--color-muted)]">{reading}</p>}{signal.last_trigger_date !== null && <p className="text-xs text-[var(--color-muted)]">Last trigger {signal.last_trigger_date}</p>}</div>
              </div>
            })}
          </div>
        </section>
      )}
    </div>
  )
}
