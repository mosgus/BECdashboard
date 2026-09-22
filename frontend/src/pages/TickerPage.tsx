import { lazy, Suspense, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, getHistory, getSignals } from '../api/client'
import type { PriceBar, SignalOut, TickerSignals } from '../api/client'
import { SignalBadge } from '../components/SignalBadge'
import { Tooltip } from '../components/Tooltip'
import { formatPrice } from '../lib/format'

const TickerChart = lazy(() => import('../components/TickerChart'))

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'error'; statusCode: number | null }
  | { status: 'ready'; data: T }

const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  sma_cross: 'Bullish when the 20-day SMA crosses above the 50-day SMA. Bearish when it crosses below.',
  rsi_threshold: 'Overbought above 70 (potential pullback), oversold below 30 (potential rebound).',
  macd_cross: 'Bullish when the MACD line crosses above its signal line. Bearish when below.',
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

    return () => {
      cancelled = true
    }
  }, [symbol])

  const bars = history.status === 'ready' ? history.data : []
  // History is intentionally fetched once: date controls filter this stored response immediately.
  // Adding server-side start/end parameters later requires a backend contract.
  const filteredBars = bars.filter((bar) => bar.date >= start && bar.date <= end)
  const chartBars = filteredBars.filter((bar) => bar.adj_close !== null)
  const signalData = signals.status === 'ready' ? signals.data : null
  const unknownTicker =
    ((history.status === 'ready' && bars.length === 0) ||
      (history.status === 'error' && history.statusCode === 404)) &&
    signals.status === 'ready' &&
    (signalData === null || signalData.signals.length === 0)
  const newestBarDate = bars.length > 0 ? bars[bars.length - 1].date : null

  return (
    <main className="max-w-[80rem] mx-auto px-4 py-6 space-y-5">
      <div>
        <Link to={fromPath} className="text-sm text-[var(--color-muted)] hover:text-foreground">
          ← {backLabel}
        </Link>
        <h1 className="font-heading font-bold text-3xl text-brand-primary mt-2">{symbol}</h1>
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
          <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4 flex flex-wrap gap-4">
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
          </section>

          <section className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-4">
            {history.status === 'loading' && <p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}
            {history.status === 'ready' && chartBars.length === 0 && <p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">No stored data in this date range.</p>}
            {history.status === 'ready' && chartBars.length > 0 && (
              <Suspense fallback={<p className="h-[22rem] flex items-center justify-center text-sm text-[var(--color-muted)]">Loading chart…</p>}>
                <TickerChart bars={filteredBars} />
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
                    <div key={signal.signal} className="px-4 py-4 flex flex-wrap items-start gap-4">
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
