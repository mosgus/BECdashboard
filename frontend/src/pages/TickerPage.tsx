import { lazy, Suspense, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, getHistory, getIndicators, getSignals } from '../api/client'
import type { IndicatorsResponse, PriceBar, SignalOut, TickerSignals } from '../api/client'
import HelpSidebar from '../components/HelpSidebar'
import { SignalBadge } from '../components/SignalBadge'
import { Tooltip } from '../components/Tooltip'
import { formatPrice } from '../lib/format'
import { INDICATOR_GROUPS, SIGNAL_DESCRIPTIONS } from '../lib/indicators'

const SeriesChart = lazy(() => import('../components/SeriesChart'))

const ALWAYS_ON_INDICATORS = ['sma', 'rsi', 'macd', 'adx', 'stochastic', 'obv'] as const

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; statusCode: number | null }
  | { status: 'ready'; data: T }

const INDICATOR_TOOLTIPS: Record<string, string> = {
  adx: 'Trend strength from 0 to 100. High means a strong trend in either direction, not a bullish one.',
  obv: 'On-balance volume — cumulative volume added on up days and subtracted on down days.',
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function isoOneYearAgo(): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() - 1)
  return date.toISOString().slice(0, 10)
}

function valueLabel(signal: SignalOut): string | null {
  if (signal.value === null) return null
  if (signal.signal === 'rsi_threshold') return `RSI ${signal.value.toFixed(2)}`
  if (signal.signal === 'macd_cross') return `Histogram ${signal.value.toFixed(4)}`
  return null
}

export function TickerPage(): JSX.Element {
  const { symbol: rawSymbol = '' } = useParams()
  const [searchParams] = useSearchParams()
  const symbol = rawSymbol.toUpperCase()
  const fromPath = searchParams.get('from') || '/universe'
  const backLabel = fromPath.startsWith('/portfolios') ? 'Portfolio' : 'Universe'
  const [start, setStart] = useState(isoOneYearAgo)
  const [end, setEnd] = useState(isoToday)
  const [history, setHistory] = useState<LoadState<PriceBar[]>>({ status: 'loading' })
  const [signals, setSignals] = useState<LoadState<TickerSignals | null>>({ status: 'loading' })
  const [enabledIndicators, setEnabledIndicators] = useState<Set<string>>(new Set())
  const [indicators, setIndicators] = useState<LoadState<IndicatorsResponse>>({ status: 'loading' })
  const indicatorKey = Array.from(new Set([...ALWAYS_ON_INDICATORS, ...enabledIndicators])).sort().join(',')

  useEffect(() => {
    if (symbol === '') return
    let cancelled = false

    void getHistory(symbol)
      .then((response) => {
        if (!cancelled) setHistory({ status: 'ready', data: response.bars })
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistory({ status: 'error', statusCode: error instanceof ApiError ? error.status : null })
      })

    void getSignals([symbol])
      .then((response) => {
        if (!cancelled) {
          setSignals({ status: 'ready', data: response.signals[0] ?? null })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setSignals({ status: 'error', statusCode: error instanceof ApiError ? error.status : null })
      })

    void getIndicators(symbol, indicatorKey.split(','))
      .then((response) => {
        if (!cancelled) setIndicators({ status: 'ready', data: response })
      })
      .catch((error: unknown) => {
        if (!cancelled) setIndicators({ status: 'error', statusCode: error instanceof ApiError ? error.status : null })
      })

    return () => {
      cancelled = true
    }
  }, [symbol, indicatorKey])

  const bars = history.status === 'ready' ? history.data : []
  // History is intentionally fetched once: date controls filter this stored response immediately.
  // Adding server-side start/end parameters later requires a backend contract.
  const filteredBars = bars.filter((bar) => bar.date >= start && bar.date <= end)
  const chartPoints = filteredBars.flatMap((bar) => (bar.adj_close === null ? [] : [{ date: bar.date, value: bar.adj_close }]))
  const signalData = signals.status === 'ready' ? signals.data : null
  const indicatorData = indicators.status === 'ready' ? indicators.data : undefined
  const unknownTicker =
    ((history.status === 'ready' && bars.length === 0) ||
      (history.status === 'error' && history.statusCode === 404)) &&
    signals.status === 'ready' &&
    (signalData === null || signalData.signals.length === 0)
  const newestBarDate = bars.length > 0 ? bars[bars.length - 1].date : null

  function toggleIndicator(key: string): void {
    setEnabledIndicators((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <main className="max-w-[80rem] mx-auto px-4 py-6 space-y-5">
      <div>
        <Link to={fromPath} className="text-sm text-[var(--color-muted)] hover:text-foreground">
          ← {backLabel}
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <h1 className="font-heading font-bold text-3xl text-brand-primary">{symbol}</h1>
          <HelpSidebar />
        </div>
        {newestBarDate !== null && <p className="text-sm text-[var(--color-muted)] mt-1">As of {newestBarDate}</p>}
      </div>

      {history.status === 'error' && <p className="text-sm text-brand-negative">The chart could not be loaded.</p>}
      {signals.status === 'error' && <p className="text-sm text-brand-negative">Signals could not be loaded.</p>}

      {unknownTicker ? (
        <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-8 text-center">
          <p className="text-sm text-[var(--color-muted)]">No stored data for {symbol}.</p>
          <Link to="/universe" className="inline-block text-sm text-brand-primary hover:underline mt-3">
            Back to Universe
          </Link>
        </div>
      ) : (
        <>
          <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
            <div className="flex flex-col items-start gap-y-4 pb-4 mb-4 border-b border-brand-border">
              <div className="flex flex-wrap gap-4">
                <label className="text-xs font-medium text-[var(--color-muted)]">
                  Start
                  <Tooltip label="Limit the chart to this date range">
                    <input
                      type="date"
                      value={start}
                      onChange={(event) => setStart(event.target.value)}
                      className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
                    />
                  </Tooltip>
                </label>
                <label className="text-xs font-medium text-[var(--color-muted)]">
                  End
                  <Tooltip label="Limit the chart to this date range">
                    <input
                      type="date"
                      value={end}
                      onChange={(event) => setEnd(event.target.value)}
                      className="block mt-1 text-sm px-3 py-2 rounded-[var(--radius-btn)] border border-brand-border bg-brand-surface text-foreground"
                    />
                  </Tooltip>
                </label>
              </div>
              <div className="flex-1 min-w-64">
                <Tooltip label="Draw this indicator on the chart">
                  <span className="text-xs font-medium text-[var(--color-muted)]">Indicators</span>
                </Tooltip>
                <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
                  {INDICATOR_GROUPS.filter((group) => !['adx', 'stochastic', 'obv'].includes(group.key)).map((group) => (
                    <Tooltip key={group.key} label={INDICATOR_TOOLTIPS[group.key] ?? 'Draw this indicator on the chart'}>
                      <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabledIndicators.has(group.key)}
                          onChange={() => toggleIndicator(group.key)}
                          className="accent-[var(--color-primary)]"
                        />
                        {group.label}
                      </label>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>
            {history.status === 'loading' && <p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}
            {history.status === 'ready' && chartPoints.length === 0 && <p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">No stored data in this date range.</p>}
            {history.status === 'ready' && chartPoints.length > 0 && (
              <Suspense fallback={<p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
                <SeriesChart title={`${symbol} — Price & Moving Averages`} valueName="Price" points={chartPoints} indicators={indicatorData} />
              </Suspense>
            )}
          </section>

          <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
            <h2 className="text-sm font-semibold">
              <Tooltip label="Average true range — typical daily price movement. Higher means wider swings.">
                <span>ATR (14)</span>
              </Tooltip>
            </h2>
            <p className="text-xl font-semibold tabular-nums mt-2">{formatPrice(signalData?.atr ?? null)}</p>
            <p className="text-xs text-[var(--color-muted)] mt-1">14-day average of true range (Wilder EWM smoothing).</p>
          </section>

          {signalData !== null && signalData.signals.length > 0 && (
            <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-brand-border">
                <h2 className="text-sm font-semibold">
                  <Tooltip label="Computed from stored closing prices. State reflects the most recent crossover or threshold event.">
                    <span>Signal States</span>
                  </Tooltip>
                </h2>
              </div>
              <div className="divide-y divide-brand-border">
                {signalData.signals.map((signal) => {
                  const reading = valueLabel(signal)
                  return (
                    <div key={signal.signal} className="px-4 py-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_12rem] items-start gap-x-4 gap-y-2">
                      <div className="min-w-48 max-w-md">
                        <p className="text-sm font-semibold">{signal.label}</p>
                        <p className="text-xs text-[var(--color-muted)] mt-1">{SIGNAL_DESCRIPTIONS[signal.signal] ?? ''}</p>
                      </div>
                      <div className="space-y-1">
                        <SignalBadge state={signal.state} />
                        {reading !== null && <p className="text-xs text-[var(--color-muted)]">{reading}</p>}
                        {signal.last_trigger_date !== null && <p className="text-xs text-[var(--color-muted)]">Last trigger {signal.last_trigger_date}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  )
}
